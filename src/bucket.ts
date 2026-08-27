import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { normalizeBody } from './body.js'
import { createS3Client, resolveConfig } from './config.js'
import { BucketCodeError } from './errors.js'
import { assertValidKey, encodeKey, generateKey, joinKey, normalizePrefix, sanitizeFilename } from './key.js'
import { DEFAULT_CONTENT_TYPE, lookupContentType } from './mime.js'
import type { BucketConfig, GetUrlOptions, ResolvedConfig, UploadBody, UploadOptions, UploadResult } from './types.js'

/** S3 caps `DeleteObjects` at 1000 keys per request. */
const DELETE_BATCH_SIZE = 1000
/** SigV4 caps presigned URL lifetime at 7 days. */
const MAX_EXPIRES_IN = 604_800
const DEFAULT_EXPIRES_IN = 3600

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size))
  }

  return batches
}

/**
 * Server-side bucket handle. Credentials never leave the server: every method
 * talks to S3 directly, so no CORS configuration and no browser-side signing.
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
   * Uploads a body to the bucket in a single `PutObject` request.
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

    const name = options.key ?? generateKey(filename)
    assertValidKey(name)

    const key = joinKey(normalizePrefix(options.prefix) ?? this.config.prefix, name)
    assertValidKey(key)

    const contentType =
      options.contentType ??
      normalized.contentType ??
      lookupContentType(name) ??
      (filename ? lookupContentType(filename) : undefined) ??
      DEFAULT_CONTENT_TYPE

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: normalized.body,
      ContentType: contentType,
      ContentLength: size,
      CacheControl: options.cacheControl,
      ContentDisposition: options.contentDisposition,
      Metadata: options.metadata,
      ACL: options.acl,
    })

    try {
      const response = await this.client.send(command, { abortSignal: options.signal })

      return {
        bucket: this.bucket,
        key,
        contentType,
        size,
        etag: response.ETag?.replace(/"/g, ''),
        url: this.publicUrlFor(key),
      }
    } catch (error) {
      throw new BucketCodeError(
        'UPLOAD_FAILED',
        `Failed to upload "${key}" to bucket "${this.bucket}": ${describe(error)}`,
        { cause: error },
      )
    }
  }

  /**
   * Returns a URL for an object: the public one when `publicUrl` is configured,
   * a presigned GET otherwise. Use `signed` to force either behaviour.
   */
  async getUrl(key: string, options: GetUrlOptions = {}): Promise<string> {
    assertValidKey(key)

    const wantsSigned = options.signed ?? this.config.publicUrl == null

    if (!wantsSigned) {
      const url = this.publicUrlFor(key)
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
      Key: key,
      ResponseContentDisposition: contentDispositionFor(options.download),
    })

    try {
      return await getSignedUrl(this.client, command, { expiresIn })
    } catch (error) {
      throw new BucketCodeError('URL_FAILED', `Failed to sign a URL for "${key}": ${describe(error)}`, { cause: error })
    }
  }

  /**
   * Deletes one or many objects. Deleting a key that does not exist is not an
   * error — S3 treats it as a no-op, and so does this method.
   */
  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key]
    if (keys.length === 0) return

    for (const candidate of keys) {
      assertValidKey(candidate)
    }

    if (keys.length === 1) {
      const only = keys[0]!

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

    for (const batch of chunk(keys, DELETE_BATCH_SIZE)) {
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

  private publicUrlFor(key: string): string | undefined {
    return this.config.publicUrl ? `${this.config.publicUrl}/${encodeKey(key)}` : undefined
  }
}

function contentDispositionFor(download: boolean | string | undefined): string | undefined {
  if (!download) return undefined
  if (download === true) return 'attachment'

  return `attachment; filename="${sanitizeFilename(download)}"`
}

/** Creates a bucket handle. Cheap: the S3 client is built on first request. */
export function createBucket(config: BucketConfig = {}): Bucket {
  return new Bucket(config)
}
