'use client'

export { BucketcodeProvider, useTransferClient, type BucketcodeProviderProps } from './provider.js'
export { useSyncCodeInput, type SyncCodeInput, type SyncCodeInputProps } from './use-sync-code-input.js'
export { useSendTransfer, type SendSnapshotOptions, type SendTransfer } from './use-send-transfer.js'
export { useReceiveTransfer, type ReceiveTransfer } from './use-receive-transfer.js'
export type { AsyncStatus } from './async-task.js'

/**
 * Re-exported so an application does not need a second bucketcode dependency
 * just to branch on a failure.
 */
export { isTransferError, TransferError } from '@bucketcode/protocol'
export type { CreatedTransfer, TransferErrorCode, TransferKind, TransferMetadata } from '@bucketcode/protocol'
