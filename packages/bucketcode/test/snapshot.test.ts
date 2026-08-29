import { gunzipSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import type { BucketCodeError } from '../src/errors.js'
import { clearBucketEnv, createMemoryClient, createStubClient } from './helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

/** A stand-in for what a local-first app dumps out of IndexedDB. */
const STATE = {
  notes: [
    { id: 1, title: 'Groceries', body: 'milk, eggs' },
    { id: 2, title: 'Ideas', body: 'a package for moving IndexedDB between devices' },
  ],
  settings: { theme: 'dark' },
}

describe('putSnapshot', () => {
  it('stores a gzipped, self-describing envelope', async () => {
    const { client, calls } = createStubClient({ ETag: '"abc"' })
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.putSnapshot('XK5892', STATE, { app: 'notes', version: 3, device: 'Pixel 8' })

    const input = calls[0]!.command.input
    expect(input.Key).toBe('XK5892')
    expect(input.ContentType).toBe('application/gzip')
    expect(input.CacheControl).toBe('private, no-store')

    const envelope = JSON.parse(gunzipSync(input.Body).toString('utf8'))
    expect(envelope).toMatchObject({
      bucketcode: 1,
      app: 'notes',
      version: 3,
      device: 'Pixel 8',
      data: STATE,
    })
    expect(Date.parse(envelope.createdAt)).not.toBeNaN()
    expect(envelope.expiresAt).toBeUndefined()
  })

  it('compresses well enough to matter', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    // A realistic dump: many records that look alike.
    const notes = Array.from({ length: 500 }, (_, index) => ({
      id: index,
      title: `Note ${index}`,
      body: 'the quick brown fox jumps over the lazy dog',
    }))

    await bucket.putSnapshot('XK5892', { notes })

    const raw = JSON.stringify({ notes }).length
    expect(calls[0]!.command.input.Body.byteLength).toBeLessThan(raw / 5)
  })

  it('can skip compression', async () => {
    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const result = await bucket.putSnapshot('XK5892', STATE, { compress: false })

    expect(result.compressed).toBe(false)
    expect(calls[0]!.command.input.ContentType).toBe('application/json')
    expect(JSON.parse(Buffer.from(calls[0]!.command.input.Body).toString('utf8')).data).toEqual(STATE)
  })

  it('stamps an expiry when asked', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))

    const { client, calls } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const result = await bucket.putSnapshot('XK5892', STATE, { expiresIn: 3600 })

    expect(result.expiresAt?.toISOString()).toBe('2026-08-27T13:00:00.000Z')
    const envelope = JSON.parse(gunzipSync(calls[0]!.command.input.Body).toString('utf8'))
    expect(envelope.expiresAt).toBe('2026-08-27T13:00:00.000Z')
  })

  it('rejects data JSON cannot represent', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const circular: Record<string, unknown> = {}
    circular.self = circular

    await expect(bucket.putSnapshot('XK5892', circular)).rejects.toMatchObject({ code: 'INVALID_SNAPSHOT' })
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects a non-positive expiry', async () => {
    const { client } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await expect(bucket.putSnapshot('XK5892', STATE, { expiresIn: 0 })).rejects.toMatchObject({
      code: 'INVALID_SNAPSHOT',
    })
  })
})

describe('getSnapshot', () => {
  it('round-trips the state, with everything that described it', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', prefix: 'snapshots', client })

    const written = await bucket.putSnapshot('XK5892', STATE, { app: 'notes', version: 3, device: 'Pixel 8' })
    const read = await bucket.getSnapshot<typeof STATE>('XK5892')

    expect(read?.data).toEqual(STATE)
    expect(read).toMatchObject({ app: 'notes', version: 3, device: 'Pixel 8', key: 'XK5892', path: 'snapshots/XK5892' })
    expect(read?.createdAt.toISOString()).toBe(written.createdAt.toISOString())
    expect(read?.etag).toBe(written.etag)
  })

  it('reads an uncompressed snapshot too', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.putSnapshot('XK5892', STATE, { compress: false })

    expect((await bucket.getSnapshot('XK5892'))?.data).toEqual(STATE)
  })

  it('returns null when there is nothing stored', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    expect(await bucket.getSnapshot('XK5892')).toBeNull()
  })

  it('treats an expired snapshot as gone', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T12:00:00Z'))

    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.putSnapshot('XK5892', STATE, { expiresIn: 3600 })

    vi.setSystemTime(new Date('2026-08-27T12:59:00Z'))
    expect(await bucket.getSnapshot('XK5892')).not.toBeNull()

    vi.setSystemTime(new Date('2026-08-27T13:00:01Z'))
    expect(await bucket.getSnapshot('XK5892')).toBeNull()
  })

  it('refuses a snapshot written by a newer build', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.putSnapshot('XK5892', STATE, { version: 5 })

    await expect(bucket.getSnapshot('XK5892', { maxVersion: 3 })).rejects.toMatchObject({
      code: 'SNAPSHOT_TOO_NEW',
    })
    expect(await bucket.getSnapshot('XK5892', { maxVersion: 5 })).not.toBeNull()
  })

  it('rejects an object that is not a snapshot', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload('just a text file', { key: 'XK5892' })

    const error = (await bucket.getSnapshot('XK5892').catch((e) => e)) as BucketCodeError
    expect(error.code).toBe('INVALID_SNAPSHOT')
  })

  it('rejects an envelope from a future format', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.upload(JSON.stringify({ bucketcode: 99, createdAt: new Date().toISOString(), data: {} }), {
      key: 'XK5892',
    })

    await expect(bucket.getSnapshot('XK5892')).rejects.toThrowError(/Upgrade the package/)
  })
})

describe('concurrent devices', () => {
  it('refuses to overwrite a snapshot that moved under you', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const first = await bucket.putSnapshot('XK5892', { notes: ['a'] })

    // Another device writes in the meantime.
    await bucket.putSnapshot('XK5892', { notes: ['a', 'b'] })

    const error = (await bucket
      .putSnapshot('XK5892', { notes: ['a', 'c'] }, { ifMatch: first.etag })
      .catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('PRECONDITION_FAILED')
    expect(await bucket.getSnapshot('XK5892')).toMatchObject({ data: { notes: ['a', 'b'] } })
  })

  it('accepts a write when the ETag still matches', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    const first = await bucket.putSnapshot('XK5892', { notes: ['a'] })
    await bucket.putSnapshot('XK5892', { notes: ['a', 'b'] }, { ifMatch: first.etag })

    expect(await bucket.getSnapshot('XK5892')).toMatchObject({ data: { notes: ['a', 'b'] } })
  })

  it('claims a code only if nobody else did', async () => {
    const { client } = createMemoryClient()
    const bucket = createBucket({ bucket: 'assets', client })

    await bucket.putSnapshot('XK5892', STATE, { ifAbsent: true })

    await expect(bucket.putSnapshot('XK5892', STATE, { ifAbsent: true })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
    })
  })
})
