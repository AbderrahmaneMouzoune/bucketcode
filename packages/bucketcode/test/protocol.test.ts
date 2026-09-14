import { describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import { createTransferHandler } from '../src/handler.js'
import { createTransferClient, isTransferError, TransferError } from '../src/protocol/index.js'
import { createMemoryClient } from './helpers.js'

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

/**
 * The client wired straight into the handler, with no socket in between — the
 * exact arrangement the CLI uses when it is not given `--remote`.
 */
function wired() {
  const memory = createMemoryClient()
  const handler = createTransferHandler({
    bucket: createBucket({ bucket: 'transfers', client: memory.client }),
  })

  return createTransferClient({
    baseUrl: BASE,
    fetch: (input, init) => handler(new Request(input as string, init as RequestInit)),
  })
}

describe('createTransferClient — against a real handler', () => {
  it('round-trips a snapshot', async () => {
    const client = wired()

    const created = await client.createSnapshot({ data: { notes: ['one'] }, version: 2, device: 'Pixel 8' })
    expect(created.kind).toBe('snapshot')

    const read = await client.read(created.code)
    expect(read).toMatchObject({ kind: 'snapshot', version: 2, device: 'Pixel 8', data: { notes: ['one'] } })
  })

  it('round-trips a file', async () => {
    const client = wired()
    const bytes = new TextEncoder().encode('hello bucket')

    const created = await client.createFile({ body: bytes, filename: 'hello.txt', contentType: 'text/plain' })
    expect(created.kind).toBe('file')

    expect(await client.readBytes(created.code)).toEqual(bytes)
    expect((await client.read(created.code))?.filename).toBe('hello.txt')
  })

  it('returns null rather than throwing on an unknown code', async () => {
    const client = wired()

    expect(await client.read('K7QP2M4X')).toBeNull()
    expect(await client.readBytes('K7QP2M4X')).toBeNull()
  })

  it('burns a code, and tolerates burning it twice', async () => {
    const client = wired()

    const { code } = await client.createSnapshot({ data: 1 })
    await client.remove(code)
    await expect(client.remove(code)).resolves.toBeUndefined()

    expect(await client.read(code)).toBeNull()
  })

  it('throws a typed error the caller can branch on', async () => {
    const client = wired()

    await expect(client.read('not-a-code!')).rejects.toSatisfy(
      (error: unknown) => isTransferError(error) && error.code === 'INVALID_SYNC_CODE',
    )
  })
})

describe('createTransferClient — wire details', () => {
  it('sends the configured headers on every request', async () => {
    const { fetchImpl, calls } = stubFetch(
      Response.json({ code: 'A', kind: 'snapshot', createdAt: '' }, { status: 201 }),
    )
    const client = createTransferClient({ baseUrl: BASE, headers: { authorization: 'Bearer t' }, fetch: fetchImpl })

    await client.createSnapshot({ data: 1 })

    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer t')
  })

  it('percent-encodes the filename into the header', async () => {
    const { fetchImpl, calls } = stubFetch(Response.json({ code: 'A', kind: 'file', createdAt: '' }, { status: 201 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await client.createFile({ body: new Uint8Array([1]), filename: 'rapport été.pdf' })

    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['x-bucketcode-filename']).toBe(encodeURIComponent('rapport été.pdf'))
  })

  it('tolerates a baseUrl with a trailing slash', async () => {
    const { fetchImpl, calls } = stubFetch(
      Response.json({ code: 'A', kind: 'snapshot', createdAt: '' }, { status: 201 }),
    )
    const client = createTransferClient({ baseUrl: `${BASE}/`, fetch: fetchImpl })

    await client.createSnapshot({ data: 1 })

    expect(calls[0]!.url).toBe(BASE)
  })

  it('reads the documented error body back into a TransferError', async () => {
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

  it('still produces a typed error when the server is not one of ours', async () => {
    const { fetchImpl } = stubFetch(new Response('<html>gateway timeout</html>', { status: 504 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    const error = await client.createSnapshot({ data: 1 }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(TransferError)
    expect((error as TransferError).code).toBe('INTERNAL')
    expect((error as TransferError).status).toBe(504)
  })

  it('maps a bare 401 to UNAUTHORIZED', async () => {
    const { fetchImpl } = stubFetch(new Response('', { status: 401 }))
    const client = createTransferClient({ baseUrl: BASE, fetch: fetchImpl })

    await expect(client.read('K7QP2M4X')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
