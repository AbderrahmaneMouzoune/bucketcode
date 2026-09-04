import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from './bucket.js'
import type { BucketCodeError } from './errors.js'
import { clearBucketEnv, createStubClient } from './test-helpers.js'

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }

/** Signing is local — no network, no live credentials needed. */
function signingBucket(publicUrl?: string) {
  return createBucket({ bucket: 'assets', region: 'eu-west-3', credentials, publicUrl })
}

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('Bucket.getUrl', () => {
  it('returns a presigned GET when no public URL is configured', async () => {
    const url = new URL(await signingBucket().getUrl('docs/invoice.pdf'))

    expect(url.host).toBe('assets.s3.eu-west-3.amazonaws.com')
    expect(url.pathname).toBe('/docs/invoice.pdf')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  })

  it('signs the URL for the requested expiresIn', async () => {
    const url = new URL(await signingBucket().getUrl('a.txt', { expiresIn: 60 }))

    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
  })

  it('returns a percent-encoded public URL when one is configured', async () => {
    const bucket = signingBucket('https://cdn.example.com')

    expect(await bucket.getUrl('mon dossier/a.txt')).toBe('https://cdn.example.com/mon%20dossier/a.txt')
  })

  it('returns a presigned URL when signed is true despite a public URL', async () => {
    const url = await signingBucket('https://cdn.example.com').getUrl('a.txt', { signed: true })

    expect(url).toContain('X-Amz-Signature')
  })

  it('sets an attachment disposition with a sanitized filename when download is a string', async () => {
    const url = new URL(await signingBucket().getUrl('a.pdf', { download: 'Mon rapport.pdf' }))

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="Mon-rapport.pdf"')
  })

  it('sets a bare attachment disposition when download is true', async () => {
    const url = new URL(await signingBucket().getUrl('a.pdf', { download: true }))

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment')
  })

  it('throws URL_FAILED when signed is false and no public URL is configured', async () => {
    const error = (await signingBucket()
      .getUrl('a.txt', { signed: false })
      .catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('URL_FAILED')
    expect(error.message).toMatch(/publicUrl/)
  })

  it.each([0, -1, 604_801, Number.NaN])('throws URL_FAILED when expiresIn is %s', async (expiresIn) => {
    await expect(signingBucket().getUrl('a.txt', { expiresIn })).rejects.toMatchObject({ code: 'URL_FAILED' })
  })

  it('throws INVALID_KEY without sending a request when the key is invalid', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', publicUrl: 'https://cdn.example.com', client })

    await expect(bucket.getUrl('../secrets.env')).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })

  it('applies a per-call prefix instead of the bucket-level one', async () => {
    const { client } = createStubClient()
    const store = createBucket({ bucket: 'b', prefix: 'snapshots', publicUrl: 'https://cdn.example.com', client })

    expect(await store.getUrl('K7QP2M4X')).toBe('https://cdn.example.com/snapshots/K7QP2M4X')
    expect(await store.getUrl('K7QP2M4X', { prefix: 'tenant-42' })).toBe('https://cdn.example.com/tenant-42/K7QP2M4X')
  })
})
