import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from './bucket.js'
import type { BucketCodeError } from './errors.js'
import { clearBucketEnv, createStubClient, notFoundError, s3Body } from './test-helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('Bucket.get', () => {
  it('returns the object with its content type, size, etag, metadata and decoded filename', async () => {
    const lastModified = new Date('2026-08-27T10:00:00Z')
    const { client, calls } = createStubClient({
      Body: s3Body('hello'),
      ContentType: 'text/plain',
      ContentLength: 5,
      ETag: '"d41d8cd9"',
      LastModified: lastModified,
      Metadata: { filename: encodeURIComponent('Rapport été.pdf'), userid: '42' },
    })
    const bucket = createBucket({ bucket: 'assets', client })

    const file = await bucket.get('XK5892')

    expect(calls[0]!.command.constructor.name).toBe('GetObjectCommand')
    expect(calls[0]!.command.input).toMatchObject({ Bucket: 'assets', Key: 'XK5892' })
    expect(file).toMatchObject({
      bucket: 'assets',
      key: 'XK5892',
      path: 'XK5892',
      contentType: 'text/plain',
      filename: 'Rapport été.pdf',
      size: 5,
      etag: 'd41d8cd9',
      lastModified,
      metadata: { userid: '42', filename: encodeURIComponent('Rapport été.pdf') },
    })
  })

  it('reads the body as text', async () => {
    const bucket = createBucket({ bucket: 'assets', client: createStubClient({ Body: s3Body('hello') }).client })

    const file = await bucket.get('XK5892')

    expect(await file!.text()).toBe('hello')
  })

  it('reads the body as bytes', async () => {
    const bucket = createBucket({ bucket: 'assets', client: createStubClient({ Body: s3Body('hi') }).client })

    const file = await bucket.get('XK5892')

    expect(Buffer.from(await file!.bytes()).toString('utf8')).toBe('hi')
  })

  it('returns null when the key does not exist', async () => {
    const { client } = createStubClient({}, notFoundError())
    const bucket = createBucket({ bucket: 'assets', client })

    expect(await bucket.get('XK5892')).toBeNull()
  })

  it('falls back to octet-stream when S3 reports no content type', async () => {
    const bucket = createBucket({ bucket: 'assets', client: createStubClient({ Body: s3Body('x') }).client })

    const file = await bucket.get('XK5892')

    expect(file!.contentType).toBe('application/octet-stream')
    expect(file!.filename).toBeUndefined()
  })

  it('leaves the filename metadata untouched when it is not decodable', async () => {
    const { client } = createStubClient({ Body: s3Body('x'), Metadata: { filename: 'rapport%.pdf' } })
    const bucket = createBucket({ bucket: 'assets', client })

    expect((await bucket.get('XK5892'))!.filename).toBe('rapport%.pdf')
  })

  it('throws GET_FAILED when S3 fails for a reason other than a missing key', async () => {
    const cause = Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } })
    const { client } = createStubClient({}, cause)
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.get('XK5892').catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('GET_FAILED')
    expect(error.cause).toBe(cause)
  })

  it('throws GET_FAILED when S3 answers without a body', async () => {
    const { client } = createStubClient({ ContentType: 'text/plain' })
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.get('XK5892')).rejects.toMatchObject({ code: 'GET_FAILED' })
  })

  it('throws INVALID_KEY without sending a request when the key is invalid', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.get('../secrets.env')).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards the abort signal to the client', async () => {
    const { client, calls } = createStubClient({ Body: s3Body('x') })
    const bucket = createBucket({ bucket: 'assets', client })
    const controller = new AbortController()

    await bucket.get('XK5892', { signal: controller.signal })

    expect(calls[0]!.options?.abortSignal).toBe(controller.signal)
  })
})
