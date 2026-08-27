import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBucket } from '../src/bucket.js'
import type { BucketCodeError } from '../src/errors.js'
import { clearBucketEnv, createStubClient } from './helpers.js'

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }

/** Signing is local — no network, no live credentials needed. */
function signingBucket(publicUrl?: string) {
  return createBucket({ bucket: 'assets', region: 'eu-west-3', credentials, publicUrl })
}

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('getUrl', () => {
  it('signs a GET when no public URL is configured', async () => {
    const url = new URL(await signingBucket().getUrl('docs/invoice.pdf'))

    expect(url.host).toBe('assets.s3.eu-west-3.amazonaws.com')
    expect(url.pathname).toBe('/docs/invoice.pdf')
    expect(url.searchParams.get('X-Amz-Expires')).toBe('3600')
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy()
  })

  it('honours expiresIn', async () => {
    const url = new URL(await signingBucket().getUrl('a.txt', { expiresIn: 60 }))

    expect(url.searchParams.get('X-Amz-Expires')).toBe('60')
  })

  it('returns the public URL when one is configured', async () => {
    const bucket = signingBucket('https://cdn.example.com')

    expect(await bucket.getUrl('mon dossier/a.txt')).toBe('https://cdn.example.com/mon%20dossier/a.txt')
  })

  it('can force a signed URL even with a public URL configured', async () => {
    const url = await signingBucket('https://cdn.example.com').getUrl('a.txt', { signed: true })

    expect(url).toContain('X-Amz-Signature')
  })

  it('asks the browser to download, with a filename', async () => {
    const url = new URL(await signingBucket().getUrl('a.pdf', { download: 'Mon rapport.pdf' }))

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment; filename="Mon-rapport.pdf"')
  })

  it('asks the browser to download, without a filename', async () => {
    const url = new URL(await signingBucket().getUrl('a.pdf', { download: true }))

    expect(url.searchParams.get('response-content-disposition')).toBe('attachment')
  })

  it('refuses a public URL when none is configured', async () => {
    const error = (await signingBucket()
      .getUrl('a.txt', { signed: false })
      .catch((e) => e)) as BucketCodeError

    expect(error.code).toBe('URL_FAILED')
    expect(error.message).toMatch(/publicUrl/)
  })

  it.each([0, -1, 604_801, Number.NaN])('rejects an expiresIn of %s', async (expiresIn) => {
    await expect(signingBucket().getUrl('a.txt', { expiresIn })).rejects.toMatchObject({ code: 'URL_FAILED' })
  })

  it('validates the key first', async () => {
    const { client, send } = createStubClient()
    const bucket = createBucket({ bucket: 'assets', publicUrl: 'https://cdn.example.com', client })

    await expect(bucket.getUrl('../secrets.env')).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(send).not.toHaveBeenCalled()
  })
})
