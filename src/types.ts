import type { ObjectCannedACL, S3Client } from '@aws-sdk/client-s3'
import type { Readable } from 'node:stream'

/**
 * Everything `upload()` accepts. Streams are part of the signature from v0.1
 * so adding multipart support later is not a breaking change — see the
 * `contentLength` note in `UploadOptions`.
 */
export type UploadBody =
  | string
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | Readable
  | ReadableStream

export interface BucketCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
}

export interface BucketConfig {
  /** Bucket name. Falls back to `BUCKETCODE_BUCKET` or `S3_BUCKET`. */
  bucket?: string
  /** Region. Falls back to `BUCKETCODE_REGION`, `AWS_REGION`, `AWS_DEFAULT_REGION`. */
  region?: string
  /**
   * Static credentials. Omit to use the AWS default provider chain
   * (env vars, shared config, instance/task role).
   */
  credentials?: BucketCredentials
  /**
   * Custom endpoint for S3-compatible storage (R2, MinIO, Scaleway, Wasabi…).
   * Falls back to `BUCKETCODE_ENDPOINT` or `S3_ENDPOINT`.
   */
  endpoint?: string
  /** Defaults to `true` when a custom `endpoint` is set, `false` otherwise. */
  forcePathStyle?: boolean
  /**
   * Public base URL (CDN or public bucket). When set, `upload()` returns a
   * ready-to-use `url` and `getUrl()` returns an unsigned URL by default.
   * Falls back to `BUCKETCODE_PUBLIC_URL` or `S3_PUBLIC_URL`.
   */
  publicUrl?: string
  /** Prefix prepended to every key, e.g. `"uploads"` or `"tenant-42/avatars"`. */
  prefix?: string
  /** Rejects uploads above this size, in bytes, before any network call. */
  maxSize?: number
  /** Bring your own `S3Client` (custom retry strategy, request handler, tests). */
  client?: S3Client
}

export interface ResolvedConfig {
  bucket: string
  region?: string
  credentials?: BucketCredentials
  endpoint?: string
  forcePathStyle: boolean
  publicUrl?: string
  prefix?: string
  maxSize?: number
  client?: S3Client
}

export interface UploadOptions {
  /** Object key. When omitted, a UUID-based key is generated. */
  key?: string
  /** Prefix for this upload only. Overrides the bucket-level `prefix`. */
  prefix?: string
  /** Used to build the generated key and to guess the content type. */
  filename?: string
  /** Overrides the detected content type. */
  contentType?: string
  /**
   * Byte size of the body. Required for streams: a single `PutObject` cannot
   * use chunked encoding. Ignored for buffers, strings and blobs, whose size
   * is already known.
   */
  contentLength?: number
  cacheControl?: string
  contentDisposition?: string
  metadata?: Record<string, string>
  /** Canned ACL. Most modern buckets block ACLs — prefer a bucket policy. */
  acl?: ObjectCannedACL
  signal?: AbortSignal
}

export interface UploadResult {
  bucket: string
  /** Final key, including any prefix. */
  key: string
  contentType: string
  /** Byte size, when known. */
  size?: number
  /** ETag without the surrounding quotes. */
  etag?: string
  /** Only set when `publicUrl` is configured — otherwise use `getUrl()`. */
  url?: string
}

export interface GetUrlOptions {
  /** Lifetime of a signed URL, in seconds. Default `3600`, max `604800` (7 days). */
  expiresIn?: number
  /**
   * Force signed (`true`) or public (`false`). Defaults to public when
   * `publicUrl` is configured, signed otherwise.
   */
  signed?: boolean
  /**
   * Ask the browser to download instead of render. Pass a string to set the
   * filename. Signed URLs only.
   */
  download?: boolean | string
}
