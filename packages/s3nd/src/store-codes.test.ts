import { describe, expect, it } from 'vitest'

import { createBucket } from './bucket.js'
import { syncCodeAlphabets } from '@s3nd/protocol'
import { createStubClient } from './test-helpers.js'

describe('Bucket.codes', () => {
  it('creates and normalizes codes in the scheme configured on the bucket', () => {
    const { client } = createStubClient()
    const store = createBucket({
      bucket: 'assets',
      syncCode: { length: 4, alphabet: syncCodeAlphabets.digits },
      client,
    })

    expect(store.codes.create()).toMatch(/^\d{4}$/)
    expect(store.codes.normalize('1-2 3O')).toBe('1230')
    expect(store.codes.length).toBe(4)
  })

  it('defaults to eight Crockford base32 characters', () => {
    const { client } = createStubClient()
    const store = createBucket({ bucket: 'assets', client })

    expect(store.codes.alphabet).toBe(syncCodeAlphabets.crockford)
    expect(store.codes.create()).toHaveLength(8)
  })
})
