import type { TransferErrorBody, TransferErrorCode } from './types.js'

/**
 * What every protocol client throws. Separate from `BucketCodeError` on
 * purpose: that one means "something went wrong talking to S3", this one means
 * "the server answered, and said no".
 */
export class TransferError extends Error {
  readonly code: TransferErrorCode
  /** HTTP status the server answered with, when there was a response at all. */
  readonly status: number | undefined

  constructor(code: TransferErrorCode, message: string, options?: { status?: number; cause?: unknown }) {
    super(message, options)
    this.name = 'TransferError'
    this.code = code
    this.status = options?.status

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, TransferError)
    }
  }
}

export function isTransferError(error: unknown): error is TransferError {
  return error instanceof TransferError
}

/** Narrows an unknown payload to the documented error body, when it is one. */
export function parseTransferErrorBody(payload: unknown): TransferErrorBody['error'] | undefined {
  if (typeof payload !== 'object' || payload === null || !('error' in payload)) return undefined

  const error = (payload as TransferErrorBody).error
  if (typeof error !== 'object' || error === null) return undefined
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return undefined

  return error
}
