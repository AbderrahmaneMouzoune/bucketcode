import { describe, expect, it } from 'vitest'

import { createBucket } from '../src/bucket.js'
import { syncCodeAlphabets } from '@s3nd/protocol'
import { createStubClient } from './helpers.js'

describe('store.codes', () => {
  it('follows the scheme configured on the bucket', () => {
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

  it('defaults to the Crockford scheme', () => {
    const { client } = createStubClient()
    const store = createBucket({ bucket: 'assets', client })

    expect(store.codes.alphabet).toBe(syncCodeAlphabets.crockford)
    expect(store.codes.create()).toHaveLength(8)
  })
})
