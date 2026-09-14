export { Bucket, createBucket } from './bucket.js'
export { createTransferHandler } from './handler.js'
export type { TransferHandler, TransferHandlerConfig } from './handler.js'

/**
 * Re-exported from `@bucketcode/protocol`, which owns them: they are shared
 * with the React package and the CLI, and forwarding rather than redefining is
 * what keeps `instanceof BucketCodeError` true across package boundaries.
 *
 * They were part of bucketcode@0.1.0's surface, so they stay on it.
 */
export {
  BucketCodeError,
  createSyncCode,
  createSyncCodes,
  isBucketCodeError,
  normalizeSyncCode,
  syncCodeAlphabets,
  type BucketCodeErrorCode,
} from '@bucketcode/protocol'

export type {
  BucketConfig,
  BucketCredentials,
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
