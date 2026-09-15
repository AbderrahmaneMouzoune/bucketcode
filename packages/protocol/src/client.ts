import { parseTransferErrorBody, TransferError } from './transfer-error.js'
import { FILENAME_HEADER } from './types.js'
import type { CreatedTransfer, CreateSnapshotBody, TransferMetadata } from './types.js'

export interface TransferClientConfig {
  /**
   * Where the transfer routes live, e.g. `https://drop.example.com/api/transfers`
   * or a same-origin `/api/transfers`.
   */
  baseUrl: string
  /** Sent on every request — an API key, a session cookie header, a bearer token. */
  headers?: Record<string, string>
  /** Swap the implementation in tests, or to add retries. Defaults to global `fetch`. */
  fetch?: typeof globalThis.fetch
}

/** Uploading structured state: it comes back inline from `read()`. */
export interface CreateSnapshotInput extends CreateSnapshotBody {
  signal?: AbortSignal
}

/** Uploading opaque bytes: they come back from `readBytes()`. */
export interface CreateFileInput {
  /**
   * `Uint8Array` is spelled out alongside `BodyInit` on purpose: it is the
   * obvious thing to hand this method, and the DOM lib only admits it under a
   * narrower `ArrayBuffer` parameter than `TextEncoder` or `readFile` produce.
   */
  body: BodyInit | Uint8Array
  filename: string
  contentType?: string
  signal?: AbortSignal
}

export interface TransferClient {
  /** Stores application state and returns the code to carry to the other device. */
  createSnapshot(input: CreateSnapshotInput): Promise<CreatedTransfer>
  /** Stores a file and returns its code. */
  createFile(input: CreateFileInput): Promise<CreatedTransfer>
  /** What a code points at, or `null` when it is unknown or expired. */
  read(code: string, options?: { signal?: AbortSignal }): Promise<TransferMetadata | null>
  /** The bytes behind a code, or `null` when it is unknown or expired. */
  readBytes(code: string, options?: { signal?: AbortSignal }): Promise<Uint8Array | null>
  /** Burns a code. Deleting one that is already gone is not an error. */
  remove(code: string, options?: { signal?: AbortSignal }): Promise<void>
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * Turns a non-2xx response into a `TransferError`, preferring the documented
 * error body and falling back to the status when the server is not one of ours.
 */
async function toTransferError(response: Response): Promise<TransferError> {
  let payload: unknown

  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  const parsed = parseTransferErrorBody(payload)

  if (parsed) {
    return new TransferError(parsed.code, parsed.message, { status: response.status })
  }

  return new TransferError(
    response.status === 401 || response.status === 403 ? 'UNAUTHORIZED' : 'INTERNAL',
    `The server answered ${response.status} ${response.statusText || ''}`.trim() + '.',
    { status: response.status },
  )
}

/**
 * A client for the s3nd transfer protocol. Zero server dependencies: it
 * is `fetch` and nothing else, so it bundles for a browser, a worker, the CLI
 * or React Native alike.
 */
export function createTransferClient(config: TransferClientConfig): TransferClient {
  const doFetch = config.fetch ?? globalThis.fetch
  const baseHeaders = config.headers ?? {}

  if (typeof doFetch !== 'function') {
    throw new TransferError(
      'INTERNAL',
      'No fetch implementation available. Pass one as `fetch` on createTransferClient().',
    )
  }

  async function send(path: string, init: RequestInit): Promise<Response> {
    const response = await doFetch(joinUrl(config.baseUrl, path), {
      ...init,
      headers: { ...baseHeaders, ...(init.headers as Record<string, string> | undefined) },
    })

    if (!response.ok) throw await toTransferError(response)

    return response
  }

  /** 404 is a value here, not an error: an unknown code is an ordinary outcome. */
  async function sendAllowingMissing(path: string, init: RequestInit): Promise<Response | null> {
    try {
      return await send(path, init)
    } catch (error) {
      if (error instanceof TransferError && error.code === 'NOT_FOUND') return null
      throw error
    }
  }

  return {
    async createSnapshot(input) {
      const body: CreateSnapshotBody = { data: input.data, version: input.version, device: input.device }

      const response = await send('', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: input.signal,
      })

      return (await response.json()) as CreatedTransfer
    },

    async createFile(input) {
      const response = await send('', {
        method: 'POST',
        headers: {
          'content-type': input.contentType ?? 'application/octet-stream',
          [FILENAME_HEADER]: encodeURIComponent(input.filename),
        },
        body: input.body as BodyInit,
        signal: input.signal,
      })

      return (await response.json()) as CreatedTransfer
    },

    async read(code, options = {}) {
      const response = await sendAllowingMissing(`/${encodeURIComponent(code)}`, {
        method: 'GET',
        signal: options.signal,
      })

      return response ? ((await response.json()) as TransferMetadata) : null
    },

    async readBytes(code, options = {}) {
      const response = await sendAllowingMissing(`/${encodeURIComponent(code)}/raw`, {
        method: 'GET',
        signal: options.signal,
      })

      return response ? new Uint8Array(await response.arrayBuffer()) : null
    },

    async remove(code, options = {}) {
      await sendAllowingMissing(`/${encodeURIComponent(code)}`, { method: 'DELETE', signal: options.signal })
    },
  }
}
