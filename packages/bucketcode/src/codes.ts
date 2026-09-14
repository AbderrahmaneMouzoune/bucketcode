/**
 * Sync codes on their own, with no path to the AWS SDK — so the input that
 * repairs what a user typed can run in the browser, before any network call.
 *
 * ```ts
 * import { normalizeSyncCode } from 'bucketcode/codes'
 * ```
 */
export { createSyncCode, createSyncCodes, normalizeSyncCode, syncCodeAlphabets } from './sync-code.js'
export { BucketCodeError, isBucketCodeError, type BucketCodeErrorCode } from './errors.js'
export type { SyncCodeOptions, SyncCodes } from './types-codes.js'
