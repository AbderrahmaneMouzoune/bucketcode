import { describe, expect, it } from 'vitest'

import { createBucket } from './bucket.js'
import { createTransferHandler } from './handler.js'
import { createTransferClient, isTransferError } from '@s3nd/protocol'
import { createMemoryClient } from './test-helpers.js'

const BASE = 'http://drop.test/api/transfers'

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
