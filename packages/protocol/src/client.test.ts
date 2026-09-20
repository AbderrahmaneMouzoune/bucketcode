import { describe, expect, it, vi } from 'vitest'

import { createTransferClient, TransferError } from './index.js'

const BASE = 'http://drop.test/api/transfers'

/** A fetch that answers one canned response, and records what it was asked. */
function stubFetch(response: Response) {
  const calls: { url: string; init: RequestInit }[] = []

  const fetchImpl = vi.fn(async (input: any, init: any) => {
    calls.push({ url: String(input), init })
    return response
  }) as unknown as typeof globalThis.fetch

  return { fetchImpl, calls }
}

function created(kind: 'snapshot' | 'file' = 'snapshot') {
  return Response.json({ code: 'K7QP2M4X', kind, createdAt: '2026-01-01T00:00:00.000Z' }, { status: 201 })
}

describe('createTransferClient', () => {
  it('sends the configured headers on every request', async () => {
    const { fetchImpl, calls } = stubFetch(created())
    const client = createTransferClient({ baseUrl: BASE, headers: { authorization: 'Bearer t' }, fetch: fetchImpl })

    await client.createSnapshot({ data: 1 })

    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer t')
  })

  it('percent-encodes the filename into the header', async () => {
    const { fetchImpl, calls } = stubFetch(created('file'))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await client.createFile({ body: new Uint8Array([1]), filename: 'rapport été.pdf' })

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-s3nd-filename']).toBe(encodeURIComponent('rapport été.pdf'))
  })

  it('accepts a Uint8Array as a file body', async () => {
    const { fetchImpl, calls } = stubFetch(created('file'))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    // The obvious thing to hand this method; the DOM lib's BodyInit only
    // admits it under a narrower ArrayBuffer parameter than TextEncoder gives.
    await client.createFile({ body: new TextEncoder().encode('hi'), filename: 'a.txt' })

    expect(calls[0]!.init.body).toBeInstanceOf(Uint8Array)
  })

  it('strips a trailing slash from the baseUrl', async () => {
    const { fetchImpl, calls } = stubFetch(created())
    const client = createTransferClient({ baseUrl: `${BASE}/`, fetch: fetchImpl })

    await client.createSnapshot({ data: 1 })

    expect(calls[0]!.url).toBe(BASE)
  })

  it('percent-encodes the code into the request path', async () => {
    const { fetchImpl, calls } = stubFetch(Response.json({ code: 'A', kind: 'snapshot', createdAt: '' }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await client.read('K7QP 2M4X')

    expect(calls[0]!.url).toBe(`${BASE}/${encodeURIComponent('K7QP 2M4X')}`)
  })

  it('throws a TransferError built from the documented error body', async () => {
    const body = { error: { code: 'TOO_LARGE', message: 'That file is too big.' } }
    const { fetchImpl } = stubFetch(Response.json(body, { status: 413 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await expect(client.createSnapshot({ data: 1 })).rejects.toMatchObject({
      name: 'TransferError',
      code: 'TOO_LARGE',
      status: 413,
      message: 'That file is too big.',
    })
  })

  it('throws a TransferError when the server response is not one of ours', async () => {
    const { fetchImpl } = stubFetch(new Response('<html>gateway timeout</html>', { status: 504 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    const error = await client.createSnapshot({ data: 1 }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TransferError)
    expect((error as TransferError).code).toBe('INTERNAL')
    expect((error as TransferError).status).toBe(504)
  })

  it('throws UNAUTHORIZED on a bare 401', async () => {
    const { fetchImpl } = stubFetch(new Response('', { status: 401 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await expect(client.read('K7QP2M4X')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('returns null rather than throwing on a 404', async () => {
    const body = { error: { code: 'NOT_FOUND', message: 'Unknown or expired code.' } }
    const { fetchImpl } = stubFetch(Response.json(body, { status: 404 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    expect(await client.read('K7QP2M4X')).toBeNull()
  })

  it('falls back to the global fetch when none is passed', () => {
    expect(() => createTransferClient({ baseUrl: BASE })).not.toThrow()
  })

  it('throws a readable error on a runtime with no fetch', () => {
    const original = globalThis.fetch
    // @ts-expect-error — simulating an exotic runtime, which is the only case
    // where this guard fires: Node 18+ and every browser ship fetch.
    delete globalThis.fetch

    try {
      expect(() => createTransferClient({ baseUrl: BASE })).toThrow(TransferError)
    } finally {
      globalThis.fetch = original
    }
  })
})
