import { Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { normalizeBody } from '../src/body.js'
import type { BucketCodeError } from '../src/errors.js'

describe('normalizeBody', () => {
  it('rejects a missing body', async () => {
    await expect(normalizeBody(undefined as never)).rejects.toThrowError(/body is required/)
  })

  it('encodes strings as utf-8 text', async () => {
    const result = await normalizeBody('héllo')

    expect(result.contentLength).toBe(6)
    expect(result.contentType).toBe('text/plain; charset=utf-8')
    expect(Buffer.from(result.body as Uint8Array).toString('utf8')).toBe('héllo')
  })

  it('passes buffers through untouched', async () => {
    const buffer = Buffer.from('abc')
    const result = await normalizeBody(buffer)

    expect(result.body).toBe(buffer)
    expect(result.contentLength).toBe(3)
    expect(result.contentType).toBeUndefined()
  })

  it('converts ArrayBuffers', async () => {
    const result = await normalizeBody(new ArrayBuffer(8))

    expect(result.body).toBeInstanceOf(Uint8Array)
    expect(result.contentLength).toBe(8)
  })

  it('respects the window of a typed-array view', async () => {
    const view = new Uint16Array(new ArrayBuffer(16), 4, 2)
    const result = await normalizeBody(view)

    expect(result.contentLength).toBe(4)
  })

  it('reads size, type and name from a File', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    const result = await normalizeBody(file)

    expect(result.contentLength).toBe(3)
    expect(result.contentType).toBe('image/png')
    expect(result.filename).toBe('avatar.png')
  })

  it('ignores a generic blob type so the extension can win', async () => {
    const file = new File(['x'], 'notes.md', { type: 'application/octet-stream' })
    const result = await normalizeBody(file)

    expect(result.contentType).toBeUndefined()
    expect(result.filename).toBe('notes.md')
  })

  it('accepts a Node stream when the length is known', async () => {
    const stream = Readable.from([Buffer.from('abc')])
    const result = await normalizeBody(stream, 3)

    expect(result.body).toBe(stream)
    expect(result.contentLength).toBe(3)
  })

  it('accepts a web stream when the length is known', async () => {
    const stream = new Blob(['abc']).stream()
    const result = await normalizeBody(stream, 3)

    expect(result.contentLength).toBe(3)
  })

  it('refuses a stream of unknown length, and says what to do about it', async () => {
    const stream = Readable.from([Buffer.from('abc')])

    await expect(normalizeBody(stream)).rejects.toMatchObject({
      code: 'MISSING_CONTENT_LENGTH',
    })
    await expect(normalizeBody(stream)).rejects.toThrowError(/v0\.2/)
  })

  it('rejects anything else', async () => {
    const error = (await normalizeBody({ nope: true } as never).catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('INVALID_BODY')
  })
})
