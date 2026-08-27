import type { Readable } from 'node:stream'

import { BucketCodeError } from './errors.js'
import { DEFAULT_CONTENT_TYPE } from './mime.js'
import type { UploadBody } from './types.js'

export interface NormalizedBody {
  body: Uint8Array | Readable | ReadableStream
  /** Undefined only for streams whose length the caller did not provide. */
  contentLength?: number
  contentType?: string
  filename?: string
}

interface BlobLike {
  size: number
  type?: string
  name?: string
  arrayBuffer(): Promise<ArrayBuffer>
}

function isBlobLike(value: unknown): value is BlobLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as BlobLike).arrayBuffer === 'function' &&
    typeof (value as BlobLike).size === 'number'
  )
}

function isNodeReadable(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && typeof (value as Readable).pipe === 'function'
}

function isWebStream(value: unknown): value is ReadableStream {
  return typeof value === 'object' && value !== null && typeof (value as ReadableStream).getReader === 'function'
}

function assertStreamLength(contentLength: number | undefined): number {
  if (typeof contentLength !== 'number' || !Number.isFinite(contentLength) || contentLength < 0) {
    throw new BucketCodeError(
      'MISSING_CONTENT_LENGTH',
      'Uploading a stream requires an explicit `contentLength` (in bytes): a single PutObject ' +
        'request cannot use chunked encoding. Pass `contentLength`, or buffer the stream first. ' +
        'Multipart upload — which streams without knowing the size upfront — is planned for v0.2.',
    )
  }

  return contentLength
}

/**
 * Turns any accepted body into something `PutObjectCommand` understands, and
 * reports back whatever metadata the body itself carries (size, type, name).
 */
export async function normalizeBody(input: UploadBody, contentLength?: number): Promise<NormalizedBody> {
  if (input == null) {
    throw new BucketCodeError('INVALID_BODY', 'Upload body is required.')
  }

  if (typeof input === 'string') {
    const body = Buffer.from(input, 'utf8')
    return { body, contentLength: body.byteLength, contentType: 'text/plain; charset=utf-8' }
  }

  if (input instanceof Uint8Array) {
    return { body: input, contentLength: input.byteLength }
  }

  if (input instanceof ArrayBuffer) {
    const body = new Uint8Array(input)
    return { body, contentLength: body.byteLength }
  }

  if (ArrayBuffer.isView(input)) {
    const body = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    return { body, contentLength: body.byteLength }
  }

  if (isBlobLike(input)) {
    // A `File` coming out of `request.formData()` already sits in memory, so
    // buffering it costs nothing and gives us an exact content length.
    const body = new Uint8Array(await input.arrayBuffer())
    const type = input.type && input.type !== DEFAULT_CONTENT_TYPE ? input.type : undefined

    return { body, contentLength: body.byteLength, contentType: type, filename: input.name }
  }

  if (isNodeReadable(input) || isWebStream(input)) {
    return { body: input, contentLength: assertStreamLength(contentLength) }
  }

  throw new BucketCodeError(
    'INVALID_BODY',
    'Unsupported upload body. Expected a string, Buffer, Uint8Array, ArrayBuffer, Blob/File, ' +
      `Node Readable or web ReadableStream, received ${typeof input}.`,
  )
}
