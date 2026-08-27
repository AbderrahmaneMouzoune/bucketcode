/**
 * Every error thrown by bucketcode is a `BucketCodeError` carrying a stable
 * `code`, so callers can branch on it without string-matching messages.
 */
export type BucketCodeErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_KEY'
  | 'INVALID_BODY'
  | 'MISSING_CONTENT_LENGTH'
  | 'FILE_TOO_LARGE'
  | 'UPLOAD_FAILED'
  | 'GET_FAILED'
  | 'DELETE_FAILED'
  | 'URL_FAILED'
  | 'PRECONDITION_FAILED'
  | 'INVALID_SNAPSHOT'
  | 'INVALID_SYNC_CODE'
  | 'SNAPSHOT_TOO_NEW'

export class BucketCodeError extends Error {
  readonly code: BucketCodeErrorCode

  constructor(code: BucketCodeErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'BucketCodeError'
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, BucketCodeError)
    }
  }
}

export function isBucketCodeError(error: unknown): error is BucketCodeError {
  return error instanceof BucketCodeError
}
