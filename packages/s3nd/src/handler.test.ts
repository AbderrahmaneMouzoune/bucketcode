import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from './bucket.js'
import { createTransferHandler } from './handler.js'
import { createMemoryClient } from './test-helpers.js'

const BASE = 'http://drop.test/api/transfers'

function setup(config: Partial<Parameters<typeof createTransferHandler>[0]> = {}) {
  const memory = createMemoryClient()
  const bucket = createBucket({ bucket: 'transfers', client: memory.client })
  const handler = createTransferHandler({ bucket, ...config })

  return { memory, bucket, handler }
}

function postSnapshot(body: unknown): Request {
  return new Request(BASE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function postFile(bytes: Uint8Array, filename: string, contentType = 'application/pdf'): Request {
  return new Request(BASE, {
    method: 'POST',
    headers: { 'content-type': contentType, 'x-s3nd-filename': encodeURIComponent(filename) },
    // The DOM lib admits a Uint8Array only under a narrower ArrayBuffer
    // parameter than TextEncoder produces; the bytes themselves are fine.
    body: bytes as BodyInit,
  })
}

describe('createTransferHandler — snapshots', () => {
  it('stores state and hands back a code', async () => {
    const { handler } = setup()

    const response = await handler(postSnapshot({ data: { notes: ['one', 'two'] }, version: 3 }))
    expect(response.status).toBe(201)

    const created = await response.json()
    expect(created.kind).toBe('snapshot')
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/)
    expect(created.expiresAt).toBeTypeOf('string')
  })

  it('reads the state back inline', async () => {
    const { handler } = setup({ app: 'notes' })

    const { code } = await (await handler(postSnapshot({ data: { notes: ['one'] }, version: 3 }))).json()
    const metadata = await (await handler(new Request(`${BASE}/${code}`))).json()

    expect(metadata).toMatchObject({
      code,
      kind: 'snapshot',
      app: 'notes',
      version: 3,
      data: { notes: ['one'] },
    })
  })

  it('accepts a code typed with the wrong case and separators', async () => {
    const { handler } = setup()

    const { code } = await (await handler(postSnapshot({ data: 1 }))).json()
    const typed = `${code.slice(0, 4).toLowerCase()}-${code.slice(4).toLowerCase()}`

    const response = await handler(new Request(`${BASE}/${typed}`))
    expect(response.status).toBe(200)
    expect((await response.json()).data).toBe(1)
  })

  it('refuses a snapshot written by a newer schema', async () => {
    const { handler } = setup({ maxVersion: 2 })

    const { code } = await (await handler(postSnapshot({ data: {}, version: 5 }))).json()
    const response = await handler(new Request(`${BASE}/${code}`))

    expect(response.status).toBe(409)
    expect((await response.json()).error.code).toBe('SNAPSHOT_TOO_NEW')
  })

  it('rejects a body that is not an object with `data`', async () => {
    const { handler } = setup()

    const response = await handler(
      new Request(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' }),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_REQUEST')
  })

  it('rejects invalid JSON', async () => {
    const { handler } = setup()

    const response = await handler(
      new Request(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }),
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_REQUEST')
  })
})

describe('createTransferHandler — files', () => {
  const bytes = new TextEncoder().encode('%PDF-1.4 pretend')

  it('stores bytes and reports them as a file', async () => {
    const { handler } = setup()

    const created = await (await handler(postFile(bytes, 'report.pdf'))).json()
    expect(created.kind).toBe('file')

    const metadata = await (await handler(new Request(`${BASE}/${created.code}`))).json()
    expect(metadata).toMatchObject({ kind: 'file', filename: 'report.pdf', contentType: 'application/pdf' })
    // Bytes are never inlined: that is what /raw is for.
    expect(metadata.data).toBeUndefined()
  })

  it('serves the bytes from /raw with a download disposition', async () => {
    const { handler } = setup()

    const { code } = await (await handler(postFile(bytes, 'report.pdf'))).json()
    const response = await handler(new Request(`${BASE}/${code}/raw`))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition')).toContain('report.pdf')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
  })

  it('keeps a filename with characters that headers cannot carry raw', async () => {
    const { handler } = setup()

    const { code } = await (await handler(postFile(bytes, 'rapport été.pdf'))).json()
    const metadata = await (await handler(new Request(`${BASE}/${code}`))).json()

    expect(metadata.filename).toBe('rapport été.pdf')
  })

  it('rejects an empty body', async () => {
    const { handler } = setup()

    const response = await handler(
      new Request(BASE, { method: 'POST', headers: { 'content-type': 'application/pdf' }, body: new Uint8Array() }),
    )

    expect(response.status).toBe(400)
  })
})

describe('createTransferHandler — lifecycle', () => {
  it('burns a code on DELETE', async () => {
    const { handler } = setup()

    const { code } = await (await handler(postSnapshot({ data: 1 }))).json()

    expect((await handler(new Request(`${BASE}/${code}`, { method: 'DELETE' }))).status).toBe(204)
    expect((await handler(new Request(`${BASE}/${code}`))).status).toBe(404)
  })

  it('treats deleting an unknown code as a no-op', async () => {
    const { handler } = setup()

    expect((await handler(new Request(`${BASE}/K7QP2M4X`, { method: 'DELETE' }))).status).toBe(204)
  })

  it('answers 404 for an unknown code', async () => {
    const { handler } = setup()

    const response = await handler(new Request(`${BASE}/K7QP2M4X`))
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('NOT_FOUND')
  })

  it('answers 400 for something that is not a code at all', async () => {
    const { handler } = setup()

    const response = await handler(new Request(`${BASE}/not-a-code!`))
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe('INVALID_SYNC_CODE')
  })

  it('omits expiresAt when transfers do not expire', async () => {
    const { handler } = setup({ expiresIn: null })

    const created = await (await handler(postSnapshot({ data: 1 }))).json()
    expect(created.expiresAt).toBeUndefined()
  })
})

describe('createTransferHandler — expiry', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('stops handing over an expired snapshot', async () => {
    const { handler } = setup({ expiresIn: 60 })

    const { code } = await (await handler(postSnapshot({ data: 1 }))).json()
    expect((await handler(new Request(`${BASE}/${code}`))).status).toBe(200)

    vi.setSystemTime(Date.now() + 61_000)
    expect((await handler(new Request(`${BASE}/${code}`))).status).toBe(404)
  })

  it('stops handing over an expired file, metadata and bytes alike', async () => {
    const { handler } = setup({ expiresIn: 60 })
    const bytes = new TextEncoder().encode('secret')

    const { code } = await (await handler(postFile(bytes, 'secret.txt', 'text/plain'))).json()
    expect((await handler(new Request(`${BASE}/${code}/raw`))).status).toBe(200)

    vi.setSystemTime(Date.now() + 61_000)
    expect((await handler(new Request(`${BASE}/${code}`))).status).toBe(404)
    expect((await handler(new Request(`${BASE}/${code}/raw`))).status).toBe(404)
  })
})

describe('createTransferHandler — routing and access', () => {
  it('ignores paths outside its mount point', async () => {
    const { handler } = setup()

    expect((await handler(new Request('http://drop.test/elsewhere'))).status).toBe(404)
  })

  it('honours a custom basePath', async () => {
    const { handler } = setup({ basePath: '/t' })

    const response = await handler(
      new Request('http://drop.test/t', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: 1 }),
      }),
    )

    expect(response.status).toBe(201)
  })

  it('refuses a method a route does not serve', async () => {
    const { handler } = setup()

    expect((await handler(new Request(BASE, { method: 'GET' }))).status).toBe(400)
    expect((await handler(new Request(`${BASE}/K7QP2M4X`, { method: 'POST' }))).status).toBe(400)
  })

  it('answers 401 when authorize refuses', async () => {
    const { handler } = setup({ authorize: () => false })

    const response = await handler(postSnapshot({ data: 1 }))
    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('lets authorize answer with its own response', async () => {
    const { handler } = setup({ authorize: () => new Response('nope', { status: 403 }) })

    const response = await handler(postSnapshot({ data: 1 }))
    expect(response.status).toBe(403)
    expect(await response.text()).toBe('nope')
  })

  it('sees the request, so authorize can read a header', async () => {
    const seen: string[] = []
    const { handler } = setup({
      authorize: (request) => {
        seen.push(request.headers.get('authorization') ?? '')
        return true
      },
    })

    await handler(
      new Request(BASE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer t' },
        body: JSON.stringify({ data: 1 }),
      }),
    )

    expect(seen).toEqual(['Bearer t'])
  })

  it('exposes GET/POST/DELETE for a Next route handler', async () => {
    const { handler } = setup()

    expect(handler.GET).toBeTypeOf('function')
    expect(handler.POST).toBeTypeOf('function')
    expect(handler.DELETE).toBeTypeOf('function')

    const created = await (await handler.POST(postSnapshot({ data: 1 }))).json()
    expect(created.code).toBeTypeOf('string')
  })
})

describe('createTransferHandler — code collisions', () => {
  it('retries with a fresh code rather than overwriting a live transfer', async () => {
    const { bucket, handler } = setup()

    // Force the first code to collide, then let the second one through.
    const taken = 'AAAAAAAA'
    const create = vi.spyOn(bucket.codes, 'create')
    create.mockReturnValueOnce(taken).mockReturnValueOnce(taken).mockReturnValueOnce('BBBBBBBB')

    const first = await (await handler(postSnapshot({ data: 'first' }))).json()
    expect(first.code).toBe(taken)

    const second = await (await handler(postSnapshot({ data: 'second' }))).json()
    expect(second.code).toBe('BBBBBBBB')

    // The first transfer is still intact — that is the whole point.
    const metadata = await (await handler(new Request(`${BASE}/${taken}`))).json()
    expect(metadata.data).toBe('first')
  })
})
