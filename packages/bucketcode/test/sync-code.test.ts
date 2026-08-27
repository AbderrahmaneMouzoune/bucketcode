import { describe, expect, it } from 'vitest'

import { createSyncCode, normalizeSyncCode } from '../src/snapshot.js'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

describe('createSyncCode', () => {
  it('is eight characters by default, from the unambiguous alphabet', () => {
    const code = createSyncCode()

    expect(code).toHaveLength(8)
    for (const character of code) {
      expect(ALPHABET).toContain(character)
    }
  })

  it('never emits the characters people confuse', () => {
    const codes = Array.from({ length: 200 }, () => createSyncCode(16)).join('')

    expect(codes).not.toMatch(/[ILOU]/)
  })

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => createSyncCode()))

    expect(codes.size).toBe(500)
  })

  it('honours a custom length and rejects silly ones', () => {
    expect(createSyncCode(12)).toHaveLength(12)
    expect(() => createSyncCode(3)).toThrowError(/between 4 and 32/)
    expect(() => createSyncCode(64)).toThrowError(/between 4 and 32/)
  })
})

describe('normalizeSyncCode', () => {
  it('accepts what a person actually types', () => {
    expect(normalizeSyncCode('xk5892ab')).toBe('XK5892AB')
    expect(normalizeSyncCode('  XK58-92AB ')).toBe('XK5892AB')
    expect(normalizeSyncCode('XK 58 92 AB')).toBe('XK5892AB')
  })

  it('folds the characters that get misread', () => {
    // O reads as zero, I and L as one — Crockford base32.
    expect(normalizeSyncCode('OIL5')).toBe('0115')
    expect(normalizeSyncCode('oil5')).toBe('0115')
  })

  it('round-trips a generated code', () => {
    const code = createSyncCode()

    expect(normalizeSyncCode(code.toLowerCase())).toBe(code)
  })

  it('rejects characters that are not in the alphabet', () => {
    expect(() => normalizeSyncCode('XK58/92')).toThrowError(/not a valid sync code/)
    expect(() => normalizeSyncCode('')).toThrowError(/must not be empty/)
    expect(() => normalizeSyncCode('   ')).toThrowError(/must not be empty/)
  })

  it('reports a stable error code', () => {
    expect(() => normalizeSyncCode('nope!')).toThrowError(expect.objectContaining({ code: 'INVALID_SYNC_CODE' }))
  })
})
