/**
 * Every error thrown by s3nd is a `S3ndError` carrying a stable
 * `code`, so callers can branch on it without string-matching messages.
 */
export type S3ndErrorCode =
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

export class S3ndError extends Error {
  readonly code: S3ndErrorCode

  constructor(code: S3ndErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'S3ndError'
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, S3ndError)
    }
  }
}

export function isS3ndError(error: unknown): error is S3ndError {
  return error instanceof S3ndError
}
