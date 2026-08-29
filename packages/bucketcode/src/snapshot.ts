import { gunzipSync, gzipSync } from 'node:zlib'

import { BucketCodeError } from './errors.js'
import type { SnapshotEnvelope } from './types.js'

/** Bumped only if the envelope shape itself changes, never for your own data. */
export const ENVELOPE_VERSION = 1

const GZIP_MAGIC = [0x1f, 0x8b]

/** JSON, then gzip unless asked otherwise. A snapshot is mostly repetitive text. */
export function encodeSnapshot(envelope: SnapshotEnvelope, compress: boolean): Uint8Array {
  let json: string

  try {
    json = JSON.stringify(envelope)
  } catch (error) {
    throw new BucketCodeError(
      'INVALID_SNAPSHOT',
      `Snapshot data is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}.`,
      { cause: error },
    )
  }

  if (json === undefined) {
    throw new BucketCodeError('INVALID_SNAPSHOT', 'Snapshot data is not JSON-serializable.')
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
    throw new BucketCodeError('INVALID_SNAPSHOT', 'Stored snapshot is not readable: decompression failed.', {
      cause: error,
    })
  }

  let envelope: unknown

  try {
    envelope = JSON.parse(json)
  } catch (error) {
    throw new BucketCodeError('INVALID_SNAPSHOT', 'Stored snapshot is not readable: invalid JSON.', { cause: error })
  }

  if (typeof envelope !== 'object' || envelope === null || !('bucketcode' in envelope)) {
    throw new BucketCodeError(
      'INVALID_SNAPSHOT',
      'Stored object is not a bucketcode snapshot. Was it written by something other than putSnapshot()?',
    )
  }

  const candidate = envelope as SnapshotEnvelope

  if (candidate.bucketcode > ENVELOPE_VERSION) {
    throw new BucketCodeError(
      'INVALID_SNAPSHOT',
      `Snapshot uses envelope format ${candidate.bucketcode}, but this version of bucketcode only understands ${ENVELOPE_VERSION}. Upgrade the package.`,
    )
  }

  return candidate
}
