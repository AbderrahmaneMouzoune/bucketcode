'use client'

import type { CreatedTransfer } from '@bucketcode/protocol'
import { useCallback } from 'react'

import { useAsyncTask, type AsyncStatus } from './async-task.js'
import { useTransferClient } from './provider.js'

export interface SendSnapshotOptions {
  /** Your schema version, so a restoring device can refuse data it cannot read. */
  version?: number
  /** Free label for this device, e.g. "Pixel 8". */
  device?: string
}

export interface SendTransfer {
  /** Stores application state and returns the transfer, or `null` on failure. */
  send: (data: unknown, options?: SendSnapshotOptions) => Promise<CreatedTransfer | null>
  /** Stores a file — a `File` straight off an `<input type="file">` works. */
  sendFile: (file: File | Blob, filename?: string) => Promise<CreatedTransfer | null>
  /** The created transfer: `transfer.code` is what the user carries across. */
  transfer: CreatedTransfer | null
  status: AsyncStatus
  isPending: boolean
  error: Error | null
  reset: () => void
}

/**
 * The sending device: hand it state or a file, get back the code to show.
 *
 * ```tsx
 * const { send, transfer, isPending } = useSendTransfer()
 *
 * <button onClick={() => send(await exportDatabase(), { version: 3 })} disabled={isPending}>
 *   Move to another device
 * </button>
 * {transfer && <Code value={transfer.code} />}
 * ```
 */
export function useSendTransfer(): SendTransfer {
  const client = useTransferClient()
  const { data, status, error, run, reset } = useAsyncTask<CreatedTransfer>()

  const send = useCallback(
    (data: unknown, options: SendSnapshotOptions = {}) =>
      run((signal) => client.createSnapshot({ data, version: options.version, device: options.device, signal })),
    [client, run],
  )

  const sendFile = useCallback(
    (file: File | Blob, filename?: string) =>
      run((signal) =>
        client.createFile({
          body: file,
          // A Blob has no name; a File does. Fall back to something rather than
          // storing a transfer nobody can identify.
          filename: filename ?? (file instanceof File ? file.name : 'file'),
          contentType: file.type || undefined,
          signal,
        }),
      ),
    [client, run],
  )

  return { send, sendFile, transfer: data, status, isPending: status === 'pending', error, reset }
}
