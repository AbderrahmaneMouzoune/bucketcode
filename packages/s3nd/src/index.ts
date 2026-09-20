export { Bucket, createBucket } from './bucket.js'
export { createTransferHandler } from './handler.js'
export type { TransferHandler, TransferHandlerConfig } from './handler.js'

/**
 * Re-exported from `@s3nd/protocol`, which owns them: they are shared
 * with the React package and the CLI, and forwarding rather than redefining is
 * what keeps `instanceof S3ndError` true across package boundaries.
 *
 * They were part of s3nd@0.1.0's surface, so they stay on it.
 */
export {
  S3ndError,
  createSyncCode,
  createSyncCodes,
  isS3ndError,
  normalizeSyncCode,
  syncCodeAlphabets,
  type S3ndErrorCode,
} from '@s3nd/protocol'

export type {
  BucketConfig,
  BucketCredentials,
  DeleteOptions,
  GetOptions,
  GetSnapshotOptions,
  GetUrlOptions,
  PutOptions,
  PutSnapshotOptions,
  Snapshot,
  SnapshotEnvelope,
  SnapshotResult,
  StoredFile,
  SyncCodeOptions,
  SyncCodes,
  UploadBody,
  UploadOptions,
  UploadResult,
} from './types.js'
