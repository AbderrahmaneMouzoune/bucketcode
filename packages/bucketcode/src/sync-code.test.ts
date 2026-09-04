import { describe, expect, it } from 'vitest'

import { createBucket } from './bucket.js'
import { createSyncCode, createSyncCodes, normalizeSyncCode, syncCodeAlphabets } from './sync-code.js'
import { createStubClient } from './test-helpers.js'
describe('createSyncCode', () => {
  it('returns eight characters drawn from the Crockford base32 alphabet', () => {
    const code = createSyncCode()

    expect(code).toHaveLength(8)
    for (const character of code) {
      expect(syncCodeAlphabets.crockford).toContain(character)
    }
  })

  it('never emits I, L, O or U across 200 codes', () => {
    const codes = Array.from({ length: 200 }, () => createSyncCode()).join('')

    expect(codes).not.toMatch(/[ILOU]/)
  })

  it('returns 500 distinct codes across 500 calls', () => {
    expect(new Set(Array.from({ length: 500 }, () => createSyncCode())).size).toBe(500)
  })
})

describe('normalizeSyncCode', () => {
  it('folds case and strips spaces, dashes and underscores', () => {
    expect(normalizeSyncCode('k7qp2m4x')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('  K7QP-2M4X ')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('K7QP 2M4X')).toBe('K7QP2M4X')
    expect(normalizeSyncCode('K7QP_2M4X')).toBe('K7QP2M4X')
  })

  it('folds O to zero and I and L to one', () => {
    expect(normalizeSyncCode('OIL5')).toBe('0115')
    expect(normalizeSyncCode('oil5')).toBe('0115')
  })

  it('returns the original code when given it lowercased', () => {
    const code = createSyncCode()

    expect(normalizeSyncCode(code.toLowerCase())).toBe(code)
  })

  it('throws INVALID_SYNC_CODE when the input is empty or outside the alphabet', () => {
    expect(() => normalizeSyncCode('K7QP/2M4X')).toThrowError(/not a valid sync code/)
    expect(() => normalizeSyncCode('')).toThrowError(/must not be empty/)
    expect(() => normalizeSyncCode('   ')).toThrowError(/must not be empty/)
    expect(() => normalizeSyncCode('nope!')).toThrowError(expect.objectContaining({ code: 'INVALID_SYNC_CODE' }))
  })
})

describe('createSyncCodes', () => {
  it('reports 40 entropy bits for the default scheme', () => {
    expect(createSyncCodes().entropyBits).toBe(40)
  })

  it('keeps case when the alphabet holds both cases', () => {
    const codes = createSyncCodes({ alphabet: 'abcdefABCDEF', length: 4 })

    expect(codes.normalize('aBcD')).toBe('aBcD')
  })

  it('throws on uppercase input when the alphabet is lowercase only', () => {
    const codes = createSyncCodes({ alphabet: 'abcdef', length: 4 })

    expect(codes.normalize('abcd')).toBe('abcd')
    expect(() => codes.normalize('ABCD')).toThrowError(/not a valid sync code/)
  })

  it('leaves O, I and L alone when the alphabet contains them', () => {
    const codes = createSyncCodes({ alphabet: syncCodeAlphabets.alphanumeric, length: 6 })

    expect(codes.normalize('OI1L0Z')).toBe('OI1L0Z')
  })

  it.each([
    ['a single character', 'A'],
    ['a repeated character', 'ABCA'],
    ['a dash', 'ABC-DEF'],
    ['a space', 'ABC DEF'],
    ['an underscore', 'ABC_DEF'],
  ])('throws INVALID_CONFIG when the alphabet has %s', (_label, alphabet) => {
    expect(() => createSyncCodes({ alphabet })).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it.each([0, -1, 65, 4.5])('throws INVALID_CONFIG when the length is %s', (length) => {
    expect(() => createSyncCodes({ length })).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  describe('with a digits-only, four-character scheme', () => {
    const codes = createSyncCodes({ length: 4, alphabet: syncCodeAlphabets.digits })

    it('returns four digits', () => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        expect(codes.create()).toMatch(/^\d{4}$/)
      }
    })

    it('folds O to zero and I to one', () => {
      expect(codes.normalize('O1I4')).toBe('0114')
    })

    it('throws when the input contains a letter', () => {
      expect(() => codes.normalize('A123')).toThrowError(/not one of 0123456789/)
    })

    it('reports 13.29 entropy bits', () => {
      expect(codes.entropyBits).toBeCloseTo(13.29, 2)
    })
  })
})

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
