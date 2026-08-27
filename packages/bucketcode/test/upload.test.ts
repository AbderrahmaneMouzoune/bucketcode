import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import type { BucketCodeError } from '../src/errors.js'
import { clearBucketEnv, createStubClient } from './helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('upload', () => {
  it('sends a single PutObject and reports the result', async () => {
    const { client, calls } = createStubClient({ ETag: '"d41d8cd9"' })
    const bucket = createBucket({ bucket: 'assets', client })

    const result = await bucket.upload(Buffer.from('hello'), { key: 'greeting.txt' })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command.constructor.name).toBe('PutObjectCommand')
    expect(calls[0]!.command.input).toMatchObject({
      Bucket: 'assets',
      Key: 'greeting.txt',
      ContentType: 'text/plain; charset=utf-8',
      ContentLength: 5,
    })
    expect(result).toMatchObject({
      bucket: 'assets',
      key: 'greeting.txt',
      size: 5,
      etag: 'd41d8cd9',
    })
    expect(result.url).toBeUndefined()
  })

  it('generates a key from a File and keeps its content type', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const result = await bucket.upload(new File([new Uint8Array([1, 2, 3])], 'Mon avatar.png', { type: 'image/png' }))

    expect(result.key).toMatch(/^[0-9a-f-]{36}-Mon-avatar\.png$/)
    expect(calls[0]!.command.input.ContentType).toBe('image/png')
  })

  it('applies the bucket prefix to the object, not to the returned key', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', prefix: 'uploads', client })

    const result = await bucket.upload('x', { key: 'a.txt' })

    expect(calls[0]!.command.input.Key).toBe('uploads/a.txt')
    // The key round-trips: it is what you hand back to get/getUrl/delete.
    expect(result.key).toBe('a.txt')
    expect(result.path).toBe('uploads/a.txt')
  })

  it('lets a per-upload prefix win', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', prefix: 'uploads', client })

    const result = await bucket.upload('x', { key: 'a.txt', prefix: 'tenant-42/avatars' })

    expect(calls[0]!.command.input.Key).toBe('tenant-42/avatars/a.txt')
    expect(result.path).toBe('tenant-42/avatars/a.txt')
  })

  it('stores the original filename as metadata', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload(new File(['x'], 'Rapport été.pdf', { type: 'application/pdf' }))

    expect(calls[0]!.command.input.Metadata).toEqual({ filename: encodeURIComponent('Rapport été.pdf') })
  })

  it('does not invent metadata when there is no filename', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload('x', { key: 'a.txt' })

    expect(calls[0]!.command.input.Metadata).toBeUndefined()
  })

  it('guesses the content type from the key extension', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload(Buffer.from('%PDF'), { key: 'docs/invoice.pdf' })

    expect(calls[0]!.command.input.ContentType).toBe('application/pdf')
  })

  it('falls back to the filename, then to octet-stream', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload(Buffer.from('x'), { filename: 'photo.webp' })
    await bucket.upload(Buffer.from('x'), { key: 'blob' })

    expect(calls[0]!.command.input.ContentType).toBe('image/webp')
    expect(calls[1]!.command.input.ContentType).toBe('application/octet-stream')
  })

  it('honours an explicit content type over everything else', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload(new File(['x'], 'a.png', { type: 'image/png' }), { contentType: 'image/avif' })

    expect(calls[0]!.command.input.ContentType).toBe('image/avif')
  })

  it('forwards the optional S3 metadata', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload('x', {
      key: 'a.txt',
      cacheControl: 'public, max-age=31536000, immutable',
      contentDisposition: 'inline',
      metadata: { userId: '42' },
    })

    expect(calls[0]!.command.input).toMatchObject({
      CacheControl: 'public, max-age=31536000, immutable',
      ContentDisposition: 'inline',
      Metadata: { userId: '42' },
    })
  })

  it('returns a public URL when one is configured', async () => {
    const { client } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', publicUrl: 'https://cdn.example.com', client })

    const result = await bucket.upload('x', { key: 'mon dossier/a.txt' })

    expect(result.url).toBe('https://cdn.example.com/mon%20dossier/a.txt')
  })

  it('rejects a body above maxSize without hitting the network', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', maxSize: 4, client })

    const error = (await bucket.upload(Buffer.alloc(5)).catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('FILE_TOO_LARGE')
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an invalid key without hitting the network', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.upload('x', { key: '../secrets.env' })).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })

  it('uploads a stream when its length is known', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const stream = Readable.from([Buffer.from('abc')])
    await bucket.upload(stream, { key: 'a.bin', contentLength: 3 })

    expect(calls[0]!.command.input.Body).toBe(stream)
    expect(calls[0]!.command.input.ContentLength).toBe(3)
  })

  it('refuses a stream of unknown length', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.upload(Readable.from([Buffer.from('abc')]), { key: 'a.bin' })).rejects.toMatchObject({
      code: 'MISSING_CONTENT_LENGTH',
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards an abort signal', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })
    const controller = new AbortController()

    await bucket.upload('x', { key: 'a.txt', signal: controller.signal })

    expect(calls[0]!.options?.abortSignal).toBe(controller.signal)
  })

  it('wraps transport failures, keeping the original error as cause', async () => {
    const cause = new Error('NoSuchBucket')
    const { client } = createStubClient({}, cause)
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.upload('x', { key: 'a.txt' }).catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('UPLOAD_FAILED')
    expect(error.message).toContain('NoSuchBucket')
    expect(error.cause).toBe(cause)
  })
})
