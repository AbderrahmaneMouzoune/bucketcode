import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from './bucket.js'
import type { BucketCodeError } from './errors.js'
import { clearBucketEnv, createStubClient } from './test-helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('Bucket.delete', () => {
  it('deletes one object when given a single key', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete('uploads/a.txt')

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command.constructor.name).toBe('DeleteObjectCommand')
    expect(calls[0]!.command.input).toMatchObject({ Bucket: 'assets', Key: 'uploads/a.txt' })
  })

  it('deletes several objects in one batched request', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete(['a.txt', 'b.txt'])

    expect(calls).toHaveLength(1)
    expect(calls[0]!.command.constructor.name).toBe('DeleteObjectsCommand')
    expect(calls[0]!.command.input.Delete.Objects).toEqual([{ Key: 'a.txt' }, { Key: 'b.txt' }])
  })

  it('splits a batch at the 1000-key limit S3 enforces', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete(Array.from({ length: 1001 }, (_, index) => `a-${index}.txt`))

    expect(calls).toHaveLength(2)
    expect(calls[0]!.command.input.Delete.Objects).toHaveLength(1000)
    expect(calls[1]!.command.input.Delete.Objects).toHaveLength(1)
  })

  it('sends no request when the key list is empty', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.delete([])

    expect(send).not.toHaveBeenCalled()
  })

  it('throws INVALID_KEY without sending a request when one key is invalid', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.delete(['a.txt', '/b.txt'])).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })

  it('throws DELETE_FAILED naming the keys S3 reported as failed', async () => {
    const { client } = createStubClient({ Errors: [{ Key: 'b.txt', Code: 'AccessDenied' }] })
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.delete(['a.txt', 'b.txt']).catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('DELETE_FAILED')
    expect(error.message).toContain('b.txt (AccessDenied)')
  })

  it('throws DELETE_FAILED with the transport error as cause', async () => {
    const cause = new Error('NetworkingError')
    const { client } = createStubClient({}, cause)
    const bucket = createBucket({ bucket: 'assets', client })

    const error = (await bucket.delete('a.txt').catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('DELETE_FAILED')
    expect(error.cause).toBe(cause)
  })
})

describe('Bucket.client', () => {
  it('returns the same lazily created client on every access', () => {
    const bucket = createBucket({ bucket: 'assets', region: 'eu-west-3' })

    expect(bucket.client).toBe(bucket.client)
  })
})

describe('Bucket.destroy', () => {
  it('destroys the client it created and builds a fresh one on the next access', () => {
    const bucket = createBucket({ bucket: 'assets', region: 'eu-west-3' })
    const first = bucket.client
    const destroy = vi.spyOn(first, 'destroy')

    bucket.destroy()

    expect(destroy).toHaveBeenCalledOnce()
    expect(bucket.client).not.toBe(first)
  })

  it('leaves an injected client untouched', () => {
    const { client } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    bucket.destroy()

    expect(client.destroy).not.toHaveBeenCalled()
    expect(bucket.client).toBe(client)
  })
})
