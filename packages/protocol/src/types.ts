/**
 * The wire contract between a s3nd server and anything that talks to it —
 * a browser, the CLI, another service.
 *
 * It is deliberately small and framework-free. `createTransferHandler()` is one
 * implementation of this contract, but the point of writing it down is that it
 * is not the only possible one: a Rails or Go backend that answers these four
 * routes works with every s3nd client, and the CLI pointed at `--remote`
 * cannot tell the difference.
 *
 * Nothing in this directory may import the AWS SDK. That is what keeps the
 * contract and its client safe to bundle for a browser.
 */

/** Bumped only when the routes or payloads below change shape. */
export const PROTOCOL_VERSION = 1

/** Header a raw upload uses to carry the original filename. */
export const FILENAME_HEADER = 'x-s3nd-filename'

/**
 * What sits behind a code.
 *
 * `snapshot` is structured application state — JSON, handed back inline,
 * which is what a local-first app restoring an IndexedDB database wants.
 * `file` is opaque bytes, fetched separately from `/:code/raw`.
 */
export type TransferKind = 'snapshot' | 'file'

/**
 * Stable error codes. A client branches on these rather than on status codes
 * or message text.
 *
 * `NOT_FOUND` deliberately covers an expired code as well as one that never
 * existed: telling them apart would let someone probe which codes have been
 * used.
 */
export type TransferErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_SYNC_CODE'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'CODE_TAKEN'
  | 'SNAPSHOT_TOO_NEW'
  | 'TOO_LARGE'
  | 'INTERNAL'

/** The body of every non-2xx response. */
export interface TransferErrorBody {
  error: {
    code: TransferErrorCode
    message: string
  }
}

/** 201 body of `POST /`. */
export interface CreatedTransfer {
  code: string
  kind: TransferKind
  createdAt: string
  /** ISO date, absent when the transfer does not expire. */
  expiresAt?: string
  /** Stored size in bytes, after compression for snapshots. */
  size?: number
}

/** 200 body of `GET /:code`. */
export interface TransferMetadata {
  code: string
  kind: TransferKind
  createdAt: string
  expiresAt?: string
  /** Free label for the device that wrote it. */
  device?: string
  /** The writing application's name. */
  app?: string
  /** The writing application's schema version. */
  version?: number
  size?: number
  /** Only for `kind: 'file'`. */
  filename?: string
  /** Only for `kind: 'file'`. */
  contentType?: string
  /** Only for `kind: 'snapshot'` — the state, inline. */
  data?: unknown
}

/** Body of `POST /` when creating a snapshot (`Content-Type: application/json`). */
export interface CreateSnapshotBody {
  data: unknown
  /** Your schema version, so a restoring device can refuse data it cannot read. */
  version?: number
  device?: string
}

/** The HTTP status each error code answers with. */
export const TRANSFER_ERROR_STATUS: Record<TransferErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_SYNC_CODE: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CODE_TAKEN: 409,
  SNAPSHOT_TOO_NEW: 409,
  TOO_LARGE: 413,
  INTERNAL: 500,
}
