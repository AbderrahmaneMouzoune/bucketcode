'use client'

import type { TransferMetadata } from '@s3nd/protocol'
import { useCallback, useState } from 'react'

import { useAsyncTask, type AsyncStatus } from './async-task.js'
import { useTransferClient } from './provider.js'

export interface ReceiveTransfer<T = unknown> {
  /**
   * Fetches what a code points at, without applying anything — so the interface
   * can show the user what is about to replace their data.
   */
  load: (code: string) => Promise<TransferMetadata | null>
  /** The bytes behind a file transfer. Snapshots carry their state in `transfer.data`. */
  loadBytes: (code: string) => Promise<Uint8Array | null>
  /** Burns the code. Worth doing once a restore succeeded; expiry is the backstop. */
  burn: (code: string) => Promise<void>
  transfer: TransferMetadata | null
  /** The snapshot's state, already typed. Undefined for a file transfer. */
  data: T | undefined
  /** True when the server answered, and there was nothing behind that code. */
  notFound: boolean
  status: AsyncStatus
  isPending: boolean
  error: Error | null
  reset: () => void
}

/**
 * The receiving device: look a code up, show what it holds, then let the
 * application decide whether to apply it.
 *
 * Applying is deliberately not here — only your code knows its own object
 * stores. What this gives you is everything needed to ask the user first.
 *
 * ```tsx
 * const { load, transfer, data, notFound } = useReceiveTransfer<DatabaseDump>()
 *
 * await load(code)
 * {notFound && <p>Unknown or expired code.</p>}
 * {transfer && <p>From {transfer.device}, {formatDate(transfer.createdAt)}</p>}
 * ```
 */
export function useReceiveTransfer<T = unknown>(): ReceiveTransfer<T> {
  const client = useTransferClient()
  const { data, status, error, run, reset: resetTask } = useAsyncTask<TransferMetadata | null>()
  const [notFound, setNotFound] = useState(false)

  const load = useCallback(
    async (code: string) => {
      setNotFound(false)
      const result = await run((signal) => client.read(code, { signal }))
      // `read` resolves to null for a code that is unknown or expired — the two
      // are deliberately indistinguishable — and to null on failure too, which
      // `status` tells apart.
      setNotFound(result === null)

      return result
    },
    [client, run],
  )

  const loadBytes = useCallback((code: string) => client.readBytes(code), [client])

  const burn = useCallback((code: string) => client.remove(code), [client])

  const reset = useCallback(() => {
    setNotFound(false)
    resetTask()
  }, [resetTask])

  return {
    load,
    loadBytes,
    burn,
    transfer: data ?? null,
    data: (data?.data as T | undefined) ?? undefined,
    notFound: notFound && status === 'success',
    status,
    isPending: status === 'pending',
    error,
    reset,
  }
}
