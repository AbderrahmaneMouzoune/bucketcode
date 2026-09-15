import { gunzipSync, gzipSync } from 'node:zlib'

import { S3ndError } from '@s3nd/protocol'
import type { SnapshotEnvelope } from './types.js'

/** Bumped only if the envelope shape itself changes, never for your own data. */
export const ENVELOPE_VERSION = 1

/**
 * What the marker field was called before this package was renamed to s3nd.
 * Read-only: nothing writes it any more.
 *
 * A snapshot is data sitting in someone's bucket, not code they can re-run, so
 * the rename must not make an existing one unreadable.
 */
const LEGACY_MARKER = 'bucketcode'

const GZIP_MAGIC = [0x1f, 0x8b]

/** JSON, then gzip unless asked otherwise. A snapshot is mostly repetitive text. */
export function encodeSnapshot(envelope: SnapshotEnvelope, compress: boolean): Uint8Array {
  let json: string

  try {
    json = JSON.stringify(envelope)
  } catch (error) {
    throw new S3ndError(
      'INVALID_SNAPSHOT',
      `Snapshot data is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    )
  }

  if (json === undefined) {
    throw new S3ndError('INVALID_SNAPSHOT', 'Snapshot data is not JSON-serializable.')
  }

  const bytes = Buffer.from(json, 'utf8')
  return compress ? gzipSync(bytes) : bytes
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 1 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]
}

/**
 * Reads a snapshot back. Compression is detected rather than assumed, so an
 * uncompressed snapshot — or one written by an older version — still loads.
 */
export function decodeSnapshot(bytes: Uint8Array): SnapshotEnvelope {
  let json: string

  try {
    json = Buffer.from(isGzip(bytes) ? gunzipSync(bytes) : bytes).toString('utf8')
  } catch (error) {
    throw new S3ndError('INVALID_SNAPSHOT', 'Stored snapshot is not readable: decompression failed.', {
      cause: error,
    })
  }

  let envelope: unknown

  try {
    envelope = JSON.parse(json)
  } catch (error) {
    throw new S3ndError('INVALID_SNAPSHOT', 'Stored snapshot is not readable: invalid JSON.', { cause: error })
  }

  if (typeof envelope !== 'object' || envelope === null) {
    throw new S3ndError(
      'INVALID_SNAPSHOT',
      'Stored object is not a s3nd snapshot. Was it written by something other than putSnapshot()?',
    )
  }

  const marker =
    's3nd' in envelope ? (envelope as SnapshotEnvelope).s3nd : (envelope as Record<string, unknown>)[LEGACY_MARKER]

  if (typeof marker !== 'number') {
    throw new S3ndError(
      'INVALID_SNAPSHOT',
      'Stored object is not a s3nd snapshot. Was it written by something other than putSnapshot()?',
    )
  }

  // One shape from here on, whichever marker it arrived under.
  const candidate = { ...(envelope as SnapshotEnvelope), s3nd: marker }

  if (candidate.s3nd > ENVELOPE_VERSION) {
    throw new S3ndError(
      'INVALID_SNAPSHOT',
      `Snapshot uses envelope format ${candidate.s3nd}, but this version of s3nd only understands ${ENVELOPE_VERSION}. Upgrade the package.`,
    )
  }

  return candidate
}
