import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import { clearBucketEnv, createStubClient, s3Body } from './helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

/** The whole point of put/get: one identifier, one file. */
describe('one file per identifier', () => {
  it('stores the file at the identifier', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const result = await bucket.put('XK5892', new File(['v1'], 'rapport.pdf', { type: 'application/pdf' }))

    expect(calls[0]!.command.input).toMatchObject({ Key: 'XK5892', ContentType: 'application/pdf' })
    expect(result.key).toBe('XK5892')
  })

  it('replaces the file on the second put, same identifier', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.put('XK5892', new File(['v1'], 'brouillon.txt', { type: 'text/plain' }))
    await bucket.put('XK5892', new File(['v2 longer'], 'final.pdf', { type: 'application/pdf' }))

    expect(calls.map((call) => call.command.input.Key)).toEqual(['XK5892', 'XK5892'])
    expect(calls[1]!.command.input.ContentType).toBe('application/pdf')
    expect(calls[1]!.command.input.Metadata).toEqual({ filename: 'final.pdf' })
  })

  it('round-trips the identifier through get, getUrl and delete under a prefix', async () => {
    const { client, calls } = createStubClient({ Body: s3Body('v1'), ContentType: 'application/pdf' })
    const bucket = createBucket({ bucket: 'assets', prefix: 'files', publicUrl: 'https://cdn.example.com', client })

    const uploaded = await bucket.put('XK5892', 'v1')
    const file = await bucket.get(uploaded.key)
    const url = await bucket.getUrl(uploaded.key)
    await bucket.delete(uploaded.key)

    // The caller only ever handles "XK5892"; the prefix stays internal.
    expect(uploaded.key).toBe('XK5892')
    expect(uploaded.path).toBe('files/XK5892')
    expect(file!.key).toBe('XK5892')
    expect(url).toBe('https://cdn.example.com/files/XK5892')
    expect(calls.map((call) => call.command.input.Key)).toEqual(['files/XK5892', 'files/XK5892', 'files/XK5892'])
  })

  it('forwards upload options', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.put('XK5892', Buffer.from('x'), {
      contentType: 'image/png',
      cacheControl: 'no-store',
      metadata: { ownerId: '42' },
    })

    expect(calls[0]!.command.input).toMatchObject({
      ContentType: 'image/png',
      CacheControl: 'no-store',
      Metadata: { ownerId: '42' },
    })
  })

  it('enforces maxSize like upload does', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', maxSize: 4, client })

    await expect(bucket.put('XK5892', Buffer.alloc(5))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an identifier that is not a usable key', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.put('../XK5892', 'x')).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })
})
