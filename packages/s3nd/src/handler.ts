import { Readable } from 'node:stream'

import type { Bucket } from './bucket.js'
import { S3ndError, isS3ndError } from '@s3nd/protocol'
import { FILENAME_HEADER, TRANSFER_ERROR_STATUS } from '@s3nd/protocol'
import type { CreatedTransfer, CreateSnapshotBody, TransferErrorCode, TransferMetadata } from '@s3nd/protocol'

/** Marks a stored object as opaque bytes rather than a snapshot envelope. */
const KIND_METADATA_KEY = 's3nd-kind'
/** Files carry their expiry here; snapshots carry it inside their envelope. */
const EXPIRES_METADATA_KEY = 's3nd-expires-at'
const DEFAULT_BASE_PATH = '/api/transfers'
const DEFAULT_EXPIRES_IN = 3600
/** A fresh code is 40 bits — a collision needs bad luck, not many retries. */
const CODE_ATTEMPTS = 5

export interface TransferHandlerConfig {
  /** The bucket every transfer is stored in. */
  bucket: Bucket
  /**
   * Where these routes are mounted, so `/:code` can be read off the URL.
   * Defaults to `/api/transfers`.
   */
  basePath?: string
  /** Recorded on every snapshot, and handed back by `GET /:code`. */
  app?: string
  /**
   * Newest schema version this deployment understands. A snapshot written by a
   * newer build answers `SNAPSHOT_TOO_NEW` instead of being handed over.
   */
  maxVersion?: number
  /**
   * Lifetime of a transfer in seconds. Defaults to one hour. Pass `null` for
   * transfers that do not expire.
   *
   * Expiry is enforced on read; removing the object itself is an S3 lifecycle
   * rule's job. `s3nd doctor` checks whether you have one.
   */
  expiresIn?: number | null
  /**
   * Called before anything else. Return `false` for a plain 401, or a `Response`
   * to answer with your own. Without it every route is public — which is what
   * you want for a personal drop box behind a proxy, and not what you want
   * otherwise.
   */
  authorize?: (request: Request) => boolean | Response | Promise<boolean | Response>
  /**
   * How `GET /:code/raw` serves bytes. `stream` pipes them through your server;
   * `redirect` answers 302 with a presigned URL so they never transit it.
   */
  raw?: 'stream' | 'redirect'
}

export interface TransferHandler {
  /** Handles any request to the mounted routes. */
  (request: Request): Promise<Response>
  /** Named exports, so a Next route handler is a one-liner. */
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
  DELETE: (request: Request) => Promise<Response>
}

function fail(code: TransferErrorCode, message: string): Response {
  return Response.json({ error: { code, message } }, { status: TRANSFER_ERROR_STATUS[code] })
}

/** Every S3ndError that means something to a client gets its own code. */
function fromS3ndError(error: S3ndError): Response {
  switch (error.code) {
    case 'FILE_TOO_LARGE':
      return fail('TOO_LARGE', error.message)
    case 'INVALID_SYNC_CODE':
      return fail('INVALID_SYNC_CODE', error.message)
    case 'SNAPSHOT_TOO_NEW':
      return fail('SNAPSHOT_TOO_NEW', error.message)
    case 'PRECONDITION_FAILED':
      return fail('CODE_TAKEN', error.message)
    case 'INVALID_KEY':
      return fail('INVALID_SYNC_CODE', error.message)
    default:
      return fail('INTERNAL', error.message)
  }
}

/** The content type the client actually committed to, if it committed to one. */
function declaredContentType(request: Request): string | undefined {
  const declared = request.headers.get('content-type')?.split(';')[0]?.trim()

  return declared && declared !== 'application/octet-stream' ? declared : undefined
}

function decodeHeaderValue(value: string | null): string | undefined {
  if (value == null || value.length === 0) return undefined

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** The AWS SDK hands back a Node stream; `Response` wants a web one. */
function toWebStream(body: unknown): ReadableStream {
  if (typeof (body as ReadableStream)?.getReader === 'function') return body as ReadableStream

  return Readable.toWeb(body as Readable) as ReadableStream
}

function discard(body: unknown): void {
  const stream = body as { destroy?: () => void; cancel?: () => void }
  stream?.destroy?.()
  stream?.cancel?.()
}

/**
 * Serves the s3nd transfer protocol over anything with `Request` and
 * `Response` — a Next route handler, Hono, `Bun.serve`, Deno, a worker.
 *
 * ```ts
 * // app/api/transfers/[[...route]]/route.ts
 * export const { GET, POST, DELETE } = createTransferHandler({ bucket: store() })
 * ```
 */
export function createTransferHandler(config: TransferHandlerConfig): TransferHandler {
  const { bucket } = config
  const basePath = `/${(config.basePath ?? DEFAULT_BASE_PATH).replace(/^\/+|\/+$/g, '')}`
  const expiresIn = config.expiresIn === null ? undefined : (config.expiresIn ?? DEFAULT_EXPIRES_IN)
  const rawMode = config.raw ?? 'stream'

  /** Everything after the mount point: `[]`, `[code]` or `[code, 'raw']`. */
  function segmentsOf(request: Request): string[] | null {
    const { pathname } = new URL(request.url)
    if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null

    return pathname
      .slice(basePath.length)
      .split('/')
      .filter((segment) => segment.length > 0)
      .map(decodeURIComponent)
  }

  function normalize(raw: string): string {
    return bucket.codes.normalize(raw)
  }

  /** Writes under a fresh code, retrying the rare collision with another one. */
  async function claimCode(write: (code: string) => Promise<CreatedTransfer>): Promise<CreatedTransfer> {
    let last: unknown

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      try {
        return await write(bucket.codes.create())
      } catch (error) {
        if (!isS3ndError(error) || error.code !== 'PRECONDITION_FAILED') throw error
        last = error
      }
    }

    throw last instanceof Error
      ? new S3ndError('PRECONDITION_FAILED', `Could not find a free code in ${CODE_ATTEMPTS} attempts.`)
      : last
  }

  async function createSnapshot(request: Request): Promise<Response> {
    let body: CreateSnapshotBody

    try {
      body = (await request.json()) as CreateSnapshotBody
    } catch {
      return fail('INVALID_REQUEST', 'Request body is not valid JSON.')
    }

    if (typeof body !== 'object' || body === null || !('data' in body)) {
      return fail('INVALID_REQUEST', 'Request body must be an object with a `data` property.')
    }

    const created = await claimCode(async (code) => {
      const result = await bucket.putSnapshot(code, body.data, {
        app: config.app,
        version: body.version,
        device: body.device ?? request.headers.get('user-agent') ?? undefined,
        expiresIn,
        ifAbsent: true,
      })

      return {
        code,
        kind: 'snapshot' as const,
        createdAt: result.createdAt.toISOString(),
        expiresAt: result.expiresAt?.toISOString(),
        size: result.size,
      }
    })

    return Response.json(created, { status: 201 })
  }

  async function createFile(request: Request): Promise<Response> {
    const filename = decodeHeaderValue(request.headers.get(FILENAME_HEADER)) ?? 'file'
    const bytes = new Uint8Array(await request.arrayBuffer())

    if (bytes.byteLength === 0) {
      return fail('INVALID_REQUEST', 'Request body is empty.')
    }

    const createdAt = new Date()
    const expiresAt = expiresIn != null ? new Date(createdAt.getTime() + expiresIn * 1000) : undefined

    const created = await claimCode(async (code) => {
      const result = await bucket.put(code, bytes, {
        filename,
        // A generic octet-stream means the client did not know; let upload()
        // infer from the filename rather than freezing in the placeholder.
        contentType: declaredContentType(request),
        cacheControl: 'private, no-store',
        metadata: {
          [KIND_METADATA_KEY]: 'file',
          ...(expiresAt ? { [EXPIRES_METADATA_KEY]: expiresAt.toISOString() } : {}),
        },
        ifAbsent: true,
      })

      return {
        code,
        kind: 'file' as const,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt?.toISOString(),
        size: result.size,
      }
    })

    return Response.json(created, { status: 201 })
  }

  async function read(code: string): Promise<Response> {
    const file = await bucket.get(code)
    if (!file) return fail('NOT_FOUND', 'Unknown or expired code.')

    if (file.metadata[KIND_METADATA_KEY] === 'file') {
      // The body is a live socket and this route does not serve bytes.
      discard(file.body)

      const expiresAt = file.metadata[EXPIRES_METADATA_KEY]
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
        return fail('NOT_FOUND', 'Unknown or expired code.')
      }

      const metadata: TransferMetadata = {
        code,
        kind: 'file',
        createdAt: (file.lastModified ?? new Date()).toISOString(),
        expiresAt,
        size: file.size,
        filename: file.filename,
        contentType: file.contentType,
      }

      return Response.json(metadata)
    }

    // Not a file, so it is a snapshot: re-read it through the envelope, which
    // is what applies expiry and the version check.
    const snapshot = await bucket.getSnapshot(code, { maxVersion: config.maxVersion })
    if (!snapshot) return fail('NOT_FOUND', 'Unknown or expired code.')

    const metadata: TransferMetadata = {
      code,
      kind: 'snapshot',
      createdAt: snapshot.createdAt.toISOString(),
      expiresAt: snapshot.expiresAt?.toISOString(),
      device: snapshot.device,
      app: snapshot.app,
      version: snapshot.version,
      size: snapshot.size,
      data: snapshot.data,
    }

    return Response.json(metadata)
  }

  async function readRaw(code: string): Promise<Response> {
    if (rawMode === 'redirect') {
      const url = await bucket.getUrl(code, { download: true })
      return Response.redirect(url, 302)
    }

    const file = await bucket.get(code)
    if (!file) return fail('NOT_FOUND', 'Unknown or expired code.')

    const expiresAt = file.metadata[EXPIRES_METADATA_KEY]
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      discard(file.body)
      return fail('NOT_FOUND', 'Unknown or expired code.')
    }

    const headers = new Headers({ 'content-type': file.contentType, 'cache-control': 'private, no-store' })
    if (file.size != null) headers.set('content-length', String(file.size))
    if (file.filename) {
      headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
    }

    return new Response(toWebStream(file.body), { headers })
  }

  async function route(request: Request): Promise<Response> {
    const segments = segmentsOf(request)
    if (segments === null) return fail('NOT_FOUND', 'No transfer route matches this path.')

    if (config.authorize) {
      const allowed = await config.authorize(request)
      if (allowed instanceof Response) return allowed
      if (!allowed) return fail('UNAUTHORIZED', 'Not authorized.')
    }

    const [rawCode, tail, ...rest] = segments

    if (rest.length > 0) return fail('NOT_FOUND', 'No transfer route matches this path.')

    if (rawCode === undefined) {
      if (request.method !== 'POST') return fail('INVALID_REQUEST', `${request.method} is not allowed here.`)

      return (request.headers.get('content-type') ?? '').includes('application/json')
        ? createSnapshot(request)
        : createFile(request)
    }

    let code: string
    try {
      code = normalize(rawCode)
    } catch (error) {
      if (isS3ndError(error)) return fromS3ndError(error)
      throw error
    }

    if (tail === 'raw') {
      if (request.method !== 'GET') return fail('INVALID_REQUEST', `${request.method} is not allowed here.`)
      return readRaw(code)
    }

    if (tail !== undefined) return fail('NOT_FOUND', 'No transfer route matches this path.')

    if (request.method === 'GET') return read(code)

    if (request.method === 'DELETE') {
      await bucket.delete(code)
      return new Response(null, { status: 204 })
    }

    return fail('INVALID_REQUEST', `${request.method} is not allowed here.`)
  }

  const handler = async (request: Request): Promise<Response> => {
    try {
      return await route(request)
    } catch (error) {
      if (isS3ndError(error)) return fromS3ndError(error)

      throw error
    }
  }

  return Object.assign(handler, { GET: handler, POST: handler, DELETE: handler })
}
