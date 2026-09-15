/**
 * The shared vocabulary of every s3nd piece: the wire contract between a
 * server and its clients, a client that speaks it, and the sync codes that
 * travel over it.
 *
 * It holds one invariant — nothing here may import a storage client — which is
 * what lets `@s3nd/react`, the CLI and a browser bundle share this code
 * without any of them pulling the AWS SDK behind it.
 *
 * A sync code belongs here rather than in `s3nd` because it *is* part of
 * the contract: its alphabet and the rules for reading back what someone typed
 * are what the two devices have to agree on.
 */
export { createTransferClient } from './client.js'
export { isTransferError, parseTransferErrorBody, TransferError } from './transfer-error.js'
export { S3ndError, isS3ndError, type S3ndErrorCode } from './s3nd-error.js'
export { createSyncCode, createSyncCodes, normalizeSyncCode, syncCodeAlphabets } from './sync-code.js'
export { FILENAME_HEADER, PROTOCOL_VERSION, TRANSFER_ERROR_STATUS } from './types.js'
export type {
  CreatedTransfer,
  CreateSnapshotBody,
  TransferErrorBody,
  TransferErrorCode,
  TransferKind,
  TransferMetadata,
} from './types.js'
export type { CreateFileInput, CreateSnapshotInput, TransferClient, TransferClientConfig } from './client.js'
export type { SyncCodeOptions, SyncCodes } from './types-codes.js'
