import { describe, expect, it } from 'vitest'

import { createBucket } from '../src/bucket.js'
import { createSyncCode, createSyncCodes, normalizeSyncCode, syncCodeAlphabets } from '../src/sync-code.js'
import { createStubClient } from './helpers.js'

describe('the default scheme', () => {
  it('is eight characters of Crockford base32', () => {
    const code = createSyncCode()

    expect(code).toHaveLength(8)
    for (const character of code) {
      expect(syncCodeAlphabets.crockford).toContain(character)
    }
  })

  it('never emits the characters people confuse', () => {
    const codes = Array.from({ length: 200 }, () => createSyncCode()).join('')

    expect(codes).not.toMatch(/[ILOU]/)
  })

  it('does not repeat itself', () => {
    expect(new Set(Array.from({ length: 500 }, () => createSyncCode())).size).toBe(500)
  })

  it('accepts what a person actually types', () => {
    expect(normalizeSyncCode('k7qp2m4x')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('  K7QP-2M4X ')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('K7QP 2M4X')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('K7QP_2M4X')).toBe('K7QP2M4X')
  })

  it('repairs the misreadings the alphabet makes unambiguous', () => {
    expect(normalizeSyncCode('OIL5')).toBe('0115')
    expect(normalizeSyncCode('oil5')).toBe('0115')
  })

  it('round-trips a generated code', () => {
    const code = createSyncCode()

    expect(normalizeSyncCode(code.toLowerCase())).toBe(code)
  })

  it('rejects what the alphabet cannot contain', () => {
    expect(() => normalizeSyncCode('K7QP/2M4X')).toThrowError(/not a valid sync code/)
    expect(() => normalizeSyncCode('')).toThrowError(/must not be empty/)
    expect(() => normalizeSyncCode('   ')).toThrowError(/must not be empty/)
    expect(() => normalizeSyncCode('nope!')).toThrowError(expect.objectContaining({ code: 'INVALID_SYNC_CODE' }))
  })

  it('reports what a code is worth guessing against', () => {
    expect(createSyncCodes().entropyBits).toBe(40)
  })
})

describe('a four-digit scheme', () => {
  const codes = createSyncCodes({ length: 4, alphabet: syncCodeAlphabets.digits })

  it('produces four digits', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(codes.create()).toMatch(/^\d{4}$/)
    }
  })

  it('still repairs O and I, because digits leave no ambiguity', () => {
    expect(codes.normalize('O1I4')).toBe('0114')
  })

  it('rejects letters', () => {
    expect(() => codes.normalize('A123')).toThrowError(/not one of 0123456789/)
  })

  it('is honest about how little it is worth', () => {
    expect(codes.entropyBits).toBeCloseTo(13.29, 2)
  })
})

describe('a custom alphabet', () => {
  it('keeps case when the alphabet has both', () => {
    const codes = createSyncCodes({ alphabet: 'abcdefABCDEF', length: 4 })

    expect(codes.normalize('aBcD')).toBe('aBcD')
  })

  it('does not invent a case fold that would break the alphabet', () => {
    const codes = createSyncCodes({ alphabet: 'abcdef', length: 4 })

    expect(codes.normalize('abcd')).toBe('abcd')
    expect(() => codes.normalize('ABCD')).toThrowError(/not a valid sync code/)
  })

  it('does not fold O when the alphabet actually contains one', () => {
    const codes = createSyncCodes({ alphabet: syncCodeAlphabets.alphanumeric, length: 6 })

    expect(codes.normalize('OI1L0Z')).toBe('OI1L0Z')
  })

  it.each([
    ['a single character', 'A'],
    ['a repeated character', 'ABCA'],
    ['a dash', 'ABC-DEF'],
    ['a space', 'ABC DEF'],
    ['an underscore', 'ABC_DEF'],
  ])('rejects %s', (_label, alphabet) => {
    expect(() => createSyncCodes({ alphabet })).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it.each([0, -1, 65, 4.5])('rejects a length of %s', (length) => {
    expect(() => createSyncCodes({ length })).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })
})

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
