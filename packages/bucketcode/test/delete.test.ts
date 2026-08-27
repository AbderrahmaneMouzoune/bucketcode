import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import type { BucketCodeError } from '../src/errors.js'
import { clearBucketEnv, createStubClient } from './helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('delete', () => {
  it('deletes a single object', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete('uploads/a.txt')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command.constructor.name).toBe('DeleteObjectCommand')
    expect(calls[0]!.command.input).toMatchObject({ Bucket: 'assets', Key: 'uploads/a.txt' })
  })

  it('batches several objects into one request', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete(['a.txt', 'b.txt'])

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command.constructor.name).toBe('DeleteObjectsCommand')
    expect(calls[0]!.command.input.Delete.Objects).toEqual([{ Key: 'a.txt' }, { Key: 'b.txt' }])
  })

  it('splits batches at the 1000-key limit', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete(Array.from({ length: 1001 }, (_, index) => `a-${index}.txt`))

    expect(calls).toHaveLength(2)
    expect(calls[0]!.command.input.Delete.Objects).toHaveLength(1000)
    expect(calls[1]!.command.input.Delete.Objects).toHaveLength(1)
  })

  it('does nothing for an empty list', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete([])

    expect(send).not.toHaveBeenCalled()
  })

  it('validates every key before sending anything', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.delete(['a.txt', '/b.txt'])).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })

  it('reports per-object failures returned by S3', async () => {
    const { client } = createStubClient({ Errors: [{ Key: 'b.txt', Code: 'AccessDenied' }] })
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.delete(['a.txt', 'b.txt']).catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('DELETE_FAILED')
    expect(error.message).toContain('b.txt (AccessDenied)')
  })

  it('wraps transport failures, keeping the original error as cause', async () => {
    const cause = new Error('NetworkingError')
    const { client } = createStubClient({}, cause)
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.delete('a.txt').catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('DELETE_FAILED')
    expect(error.cause).toBe(cause)
  })
})

describe('client lifecycle', () => {
  it('reuses a lazily created client', () => {
    const bucket = createBucket({ bucket: 'assets', region: 'eu-west-3' })

    expect(bucket.client).toBe(bucket.client)
  })

  it('closes the client it created, then builds a fresh one', () => {
    const bucket = createBucket({ bucket: 'assets', region: 'eu-west-3' })
    const first = bucket.client
    const destroy = vi.spyOn(first, 'destroy')

    bucket.destroy()

    expect(destroy).toHaveBeenCalledOnce()
    expect(bucket.client).not.toBe(first)
  })

  it('leaves an injected client alone', () => {
    const { client } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    bucket.destroy()

    expect(client.destroy).not.toHaveBeenCalled()
    expect(bucket.client).toBe(client)
  })
})
