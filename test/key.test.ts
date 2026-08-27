import { describe, expect, it } from 'vitest'

import { BucketCodeError } from '../src/errors.js'
import { assertValidKey, encodeKey, generateKey, joinKey, normalizePrefix, sanitizeFilename } from '../src/key.js'

describe('assertValidKey', () => {
  it('accepts ordinary keys', () => {
    expect(() => assertValidKey('uploads/2026/report.pdf')).not.toThrow()
    expect(() => assertValidKey('a')).not.toThrow()
  })

  it.each([
    ['an empty string', ''],
    ['a leading slash', '/uploads/a.png'],
    ['a trailing slash', 'uploads/'],
    ['a backslash', 'uploads\\a.png'],
    ['empty segments', 'uploads//a.png'],
    ['a traversal segment', 'uploads/../../etc/passwd'],
    ['a dot segment', 'uploads/./a.png'],
  ])('rejects %s', (_label, key) => {
    expect(() => assertValidKey(key)).toThrowError(BucketCodeError)
  })

  it('rejects non-strings', () => {
    expect(() => assertValidKey(42)).toThrowError(/non-empty string/)
  })

  it('rejects keys longer than 1024 bytes', () => {
    expect(() => assertValidKey('a'.repeat(1025))).toThrowError(/1024 bytes/)
  })

  it('counts bytes, not characters', () => {
    expect(() => assertValidKey('é'.repeat(513))).toThrowError(/1024 bytes/)
    expect(() => assertValidKey('é'.repeat(512))).not.toThrow()
  })

  it('exposes a stable error code', () => {
    try {
      assertValidKey('/nope')
      expect.unreachable()
    } catch (error) {
      expect((error as BucketCodeError).code).toBe('INVALID_KEY')
    }
  })
})

describe('normalizePrefix', () => {
  it('strips surrounding slashes', () => {
    expect(normalizePrefix('/uploads/')).toBe('uploads')
  })

  it('treats blank prefixes as absent', () => {
    expect(normalizePrefix('')).toBeUndefined()
    expect(normalizePrefix('///')).toBeUndefined()
    expect(normalizePrefix(undefined)).toBeUndefined()
  })
})

describe('joinKey', () => {
  it('joins with a single slash', () => {
    expect(joinKey('uploads', 'a.png')).toBe('uploads/a.png')
    expect(joinKey('/uploads/', 'a.png')).toBe('uploads/a.png')
  })

  it('returns the key untouched without a prefix', () => {
    expect(joinKey(undefined, 'a.png')).toBe('a.png')
  })
})

describe('sanitizeFilename', () => {
  it('keeps a readable name and extension', () => {
    expect(sanitizeFilename('Rapport final.pdf')).toBe('Rapport-final.pdf')
  })

  it('drops directories', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\photo.png')).toBe('photo.png')
  })

  it('collapses unsafe runs and never returns an empty name', () => {
    expect(sanitizeFilename('a  ***  b.png')).toBe('a-b.png')
    expect(sanitizeFilename('...')).toBe('file')
    expect(sanitizeFilename('')).toBe('file')
  })

  it('caps the length', () => {
    expect(sanitizeFilename(`${'a'.repeat(200)}.png`)).toHaveLength(100)
  })
})

describe('generateKey', () => {
  it('is unique and keeps the filename readable', () => {
    const first = generateKey('mon rapport.pdf')
    const second = generateKey('mon rapport.pdf')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f-]{36}-mon-rapport\.pdf$/)
  })

  it('falls back to a bare uuid', () => {
    expect(generateKey()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('always produces a valid key', () => {
    expect(() => assertValidKey(generateKey('../../evil name!.png'))).not.toThrow()
  })
})

describe('encodeKey', () => {
  it('encodes segments but keeps separators', () => {
    expect(encodeKey('uploads/mon rapport.pdf')).toBe('uploads/mon%20rapport.pdf')
    expect(encodeKey('a/b+c&d.png')).toBe('a/b%2Bc%26d.png')
  })
})
