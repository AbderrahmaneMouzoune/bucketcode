import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'

import { normalizeBody } from './body.js'
import { createS3Client, resolveConfig } from './config.js'
import { BucketCodeError } from './errors.js'
import { assertValidKey, encodeKey, generateKey, joinKey, normalizePrefix, sanitizeFilename } from './key.js'
import { DEFAULT_CONTENT_TYPE, lookupContentType } from './mime.js'
import { decodeSnapshot, encodeSnapshot, ENVELOPE_VERSION } from './snapshot.js'
import type {
  BucketConfig,
  GetOptions,
  GetSnapshotOptions,
  GetUrlOptions,
  PutOptions,
  PutSnapshotOptions,
  ResolvedConfig,
  Snapshot,
  SnapshotEnvelope,
  SnapshotResult,
  StoredFile,
  UploadBody,
  UploadOptions,
  UploadResult,
} from './types.js'

/** S3 caps `DeleteObjects` at 1000 keys per request. */
const DELETE_BATCH_SIZE = 1000
/** SigV4 caps presigned URL lifetime at 7 days. */
const MAX_EXPIRES_IN = 604_800
const DEFAULT_EXPIRES_IN = 3600
/** User metadata must be US-ASCII, so the original filename is stored encoded. */
const FILENAME_METADATA_KEY = 'filename'
const SNAPSHOT_CONTENT_TYPE = 'application/json'
const COMPRESSED_SNAPSHOT_CONTENT_TYPE = 'application/gzip'

/** The AWS SDK adds these helpers to the body of a `GetObject` response. */
type SdkStream = Readable & {
  transformToByteArray(): Promise<Uint8Array>
  transformToString(encoding?: string): Promise<string>
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** S3 answers a failed IfMatch/IfNoneMatch with 412, or 409 under a race. */
function isPreconditionFailure(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  const status = candidate?.$metadata?.httpStatusCode

  return (
    status === 412 ||
    status === 409 ||
    candidate?.name === 'PreconditionFailed' ||
    candidate?.name === 'ConditionalRequestConflict'
  )
}

/**
 * S3 wants the quoted entity-tag form, while every ETag this package hands back
 * has its quotes stripped. Accept either so `ifMatch: result.etag` just works.
 */
function quoteEtag(etag: string): string {
  return /^(?:W\/)?".*"$/.test(etag) ? etag : `"${etag}"`
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return (
    candidate?.name === 'NoSuchKey' || candidate?.name === 'NotFound' || candidate?.$metadata?.httpStatusCode === 404
  )
}

function decodeMetadataValue(value: string | undefined): string | undefined {
  if (value == null) return undefined

  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }

  return batches
}

function contentDispositionFor(download: boolean | string | undefined): string | undefined {
  if (!download) return undefined
  if (download === true) return 'attachment'

  return `attachment; filename="${sanitizeFilename(download)}"`
}

/**
 * Server-side bucket handle. Credentials never leave the server: every method
 * talks to S3 directly, so no CORS configuration and no browser-side signing.
 *
 * Every method speaks the same key — the one `upload()` returns. The configured
 * `prefix` is an internal namespace, applied on the way in and out.
 */
export class Bucket {
  readonly bucket: string

  private readonly config: ResolvedConfig
  private s3: S3Client | undefined

  constructor(config: BucketConfig = {}) {
    this.config = resolveConfig(config)
    this.bucket = this.config.bucket
  }

  /** Underlying `S3Client`, created on first use. */
  get client(): S3Client {
    this.s3 ??= createS3Client(this.config)
    return this.s3
  }

  /**
   * Uploads a body to the bucket in a single `PutObject` request. Writing to a
   * key that already exists replaces it — S3 has no distinct "update" call.
   *
   * Note that the payload transits through your server, so it is bound by your
   * runtime's request limit (6 MB on synchronous Lambda, 4.5 MB on Vercel
   * serverless functions). Multipart upload for large files is planned for v0.2.
   */
  async upload(body: UploadBody, options: UploadOptions = {}): Promise<UploadResult> {
    const normalized = await normalizeBody(body, options.contentLength)
    const size = normalized.contentLength ?? options.contentLength
    const filename = options.filename ?? normalized.filename

    if (this.config.maxSize != null && size != null && size > this.config.maxSize) {
      throw new BucketCodeError(
        'FILE_TOO_LARGE',
        `Upload is ${size} bytes, which exceeds the configured maxSize of ${this.config.maxSize} bytes.`,
      )
    }

    const key = options.key ?? generateKey(filename)
    const path = this.resolvePath(key, options.prefix)

    const contentType =
      options.contentType ??
      normalized.contentType ??
      lookupContentType(key) ??
      (filename ? lookupContentType(filename) : undefined) ??
      DEFAULT_CONTENT_TYPE

    // Keeping the original filename lets get() hand it back, which is what you
    // need to build a Content-Disposition when serving the file later.
    const metadata = { ...options.metadata }
    if (filename && metadata[FILENAME_METADATA_KEY] == null) {
      metadata[FILENAME_METADATA_KEY] = encodeURIComponent(filename)
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: path,
      Body: normalized.body,
      ContentType: contentType,
      ContentLength: size,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
      Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      ACL: options.acl,
      IfMatch: options.ifMatch ? quoteEtag(options.ifMatch) : undefined,
      IfNoneMatch: options.ifAbsent ? '*' : undefined,
    })

    try {
      const response = await this.client.send(command, { abortSignal: options.signal })

      return {
        bucket: this.bucket,
        key,
        path,
        contentType,
        size,
        etag: response.ETag?.replace(/"/g, ''),
        url: this.publicUrlFor(path),
      }
    } catch (error) {
      if ((options.ifMatch != null || options.ifAbsent) && isPreconditionFailure(error)) {
        throw new BucketCodeError(
          'PRECONDITION_FAILED',
          options.ifAbsent
            ? `"${path}" already exists in bucket "${this.bucket}".`
            : `"${path}" changed in bucket "${this.bucket}" since the ETag you passed as ifMatch. Read it again before writing.`,
          { cause: error },
        )
      }

      throw new BucketCodeError(
        'UPLOAD_FAILED',
        `Failed to upload "${path}" to bucket "${this.bucket}": ${describe(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Stores the file for an identifier, creating it or replacing what is already
   * there. One object per id: `put(id, …)` then `get(id)` round-trips.
   */
  async put(id: string, body: UploadBody, options: PutOptions = {}): Promise<UploadResult> {
    return this.upload(body, { ...options, key: id })
  }

  /**
   * Stores a snapshot of an application's local state — the shape a local-first
   * app needs to move an IndexedDB database from one device to another.
   *
   * The value is wrapped in a self-describing envelope (app, schema version,
   * device, timestamps), serialized as JSON and gzipped, so what lands in the
   * bucket says what it is and what wrote it.
   */
  async putSnapshot(key: string, data: unknown, options: PutSnapshotOptions = {}): Promise<SnapshotResult> {
    const createdAt = new Date()
    const expiresAt = options.expiresIn != null ? new Date(createdAt.getTime() + options.expiresIn * 1000) : undefined

    if (options.expiresIn != null && (!Number.isFinite(options.expiresIn) || options.expiresIn <= 0)) {
      throw new BucketCodeError('INVALID_SNAPSHOT', '`expiresIn` must be a positive number of seconds.')
    }

    const compress = options.compress ?? true

    const envelope: SnapshotEnvelope = {
      bucketcode: ENVELOPE_VERSION,
      app: options.app,
      version: options.version,
      device: options.device,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt?.toISOString(),
      data,
    }

    const result = await this.upload(encodeSnapshot(envelope, compress), {
      key,
      prefix: options.prefix,
      contentType: compress ? COMPRESSED_SNAPSHOT_CONTENT_TYPE : SNAPSHOT_CONTENT_TYPE,
      cacheControl: 'private, no-store',
      ifMatch: options.ifMatch,
      ifAbsent: options.ifAbsent,
      signal: options.signal,
    })

    return {
      bucket: result.bucket,
      key: result.key,
      path: result.path,
      etag: result.etag,
      size: result.size,
      compressed: compress,
      createdAt,
      expiresAt,
    }
  }

  /**
   * Reads a snapshot back, or `null` when there is none — including one that
   * has passed its `expiresAt`, which is never handed over even if the object
   * is still sitting in the bucket.
   */
  async getSnapshot<T = unknown>(key: string, options: GetSnapshotOptions = {}): Promise<Snapshot<T> | null> {
    const file = await this.get(key, { prefix: options.prefix, signal: options.signal })
    if (!file) return null

    const envelope = decodeSnapshot(await file.bytes())
    const expiresAt = envelope.expiresAt ? new Date(envelope.expiresAt) : undefined

    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      return null
    }

    if (options.maxVersion != null && envelope.version != null && envelope.version > options.maxVersion) {
      throw new BucketCodeError(
        'SNAPSHOT_TOO_NEW',
        `Snapshot is at schema version ${envelope.version}, but this device only understands ${options.maxVersion}. Update the application before restoring.`,
      )
    }

    return {
      bucket: file.bucket,
      key: file.key,
      path: file.path,
      data: envelope.data as T,
      app: envelope.app,
      version: envelope.version,
      device: envelope.device,
      createdAt: new Date(envelope.createdAt),
      expiresAt,
      etag: file.etag,
      size: file.size,
    }
  }

  /**
   * Reads an object back: its bytes and everything S3 knows about it.
   * Returns `null` when the key does not exist, so a missing file is a value to
   * branch on rather than an exception to catch.
   *
   * The body is a stream that can only be consumed once — use `body`, `bytes()`
   * or `text()`, exactly one of them.
   */
  async get(key: string, options: GetOptions = {}): Promise<StoredFile | null> {
    const path = this.resolvePath(key, options.prefix)

    let response
    try {
      response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: path }), {
        abortSignal: options.signal,
      })
    } catch (error) {
      if (isNotFound(error)) return null

      throw new BucketCodeError(
        'GET_FAILED',
        `Failed to read "${path}" from bucket "${this.bucket}": ${describe(error)}`,
        { cause: error },
      )
    }

    const body = response.Body as SdkStream | undefined

    if (!body) {
      throw new BucketCodeError('GET_FAILED', `S3 returned no body for "${path}" in bucket "${this.bucket}".`)
    }

    const metadata = response.Metadata ?? {}

    return {
      bucket: this.bucket,
      key,
      path,
      contentType: response.ContentType ?? DEFAULT_CONTENT_TYPE,
      filename: decodeMetadataValue(metadata[FILENAME_METADATA_KEY]),
      size: response.ContentLength,
      etag: response.ETag?.replace(/"/g, ''),
      lastModified: response.LastModified,
      metadata,
      body,
      bytes: () => body.transformToByteArray(),
      text: () => body.transformToString(),
    }
  }

  /**
   * Returns a URL for an object: the public one when `publicUrl` is configured,
   * a presigned GET otherwise. Use `signed` to force either behaviour.
   */
  async getUrl(key: string, options: GetUrlOptions = {}): Promise<string> {
    const path = this.resolvePath(key)
    const wantsSigned = options.signed ?? this.config.publicUrl == null

    if (!wantsSigned) {
      const url = this.publicUrlFor(path)
      if (!url) {
        throw new BucketCodeError(
          'URL_FAILED',
          'A public URL was requested but no `publicUrl` is configured. Set it on createBucket(), or drop `signed: false`.',
        )
      }

      return url
    }

    const expiresIn = options.expiresIn ?? DEFAULT_EXPIRES_IN

    if (!Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > MAX_EXPIRES_IN) {
      throw new BucketCodeError('URL_FAILED', `\`expiresIn\` must be between 1 and ${MAX_EXPIRES_IN} seconds.`)
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: path,
      ResponseContentDisposition: contentDispositionFor(options.download),
    })

    try {
      return await getSignedUrl(this.client, command, { expiresIn })
    } catch (error) {
      throw new BucketCodeError('URL_FAILED', `Failed to sign a URL for "${path}": ${describe(error)}`, {
        cause: error,
      })
    }
  }

  /**
   * Deletes one or many objects. Deleting a key that does not exist is not an
   * error — S3 treats it as a no-op, and so does this method.
   */
  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    if (keys.length === 0) return

    const paths = keys.map((candidate) => this.resolvePath(candidate))

    if (paths.length === 1) {
      const only = paths[0]!

      try {
        await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: only }))
        return
      } catch (error) {
        throw new BucketCodeError(
          'DELETE_FAILED',
          `Failed to delete "${only}" from bucket "${this.bucket}": ${describe(error)}`,
          { cause: error },
        )
      }
    }

    for (const batch of chunk(paths, DELETE_BATCH_SIZE)) {
      let failures: string[] = []

      try {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
          }),
        )

        failures = (response.Errors ?? []).map((entry) => `${entry.Key ?? '?'} (${entry.Code ?? 'unknown'})`)
      } catch (error) {
        throw new BucketCodeError(
          'DELETE_FAILED',
          `Failed to delete ${batch.length} objects from bucket "${this.bucket}": ${describe(error)}`,
          { cause: error },
        )
      }

      if (failures.length > 0) {
        throw new BucketCodeError(
          'DELETE_FAILED',
          `Failed to delete ${failures.length} object(s) from bucket "${this.bucket}": ${failures.join(', ')}.`,
        )
      }
    }
  }

  /**
   * Releases the HTTP sockets of the client bucketcode created. A client you
   * passed in yourself is left alone — it is yours to close.
   */
  destroy(): void {
    if (this.config.client) return

    this.s3?.destroy()
    this.s3 = undefined
  }

  /** Validates a caller-supplied key and turns it into a full object key. */
  private resolvePath(key: string, prefix?: string): string {
    assertValidKey(key)

    const path = joinKey(normalizePrefix(prefix) ?? this.config.prefix, key)
    assertValidKey(path)

    return path
  }

  private publicUrlFor(path: string): string | undefined {
    return this.config.publicUrl ? `${this.config.publicUrl}/${encodeKey(path)}` : undefined
  }
}

/** Creates a bucket handle. Cheap: the S3 client is built on first request. */
export function createBucket(config: BucketConfig = {}): Bucket {
  return new Bucket(config)
}
