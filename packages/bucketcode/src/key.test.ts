import { describe, expect, it } from 'vitest'

import { BucketCodeError } from './errors.js'
import { assertValidKey, encodeKey, generateKey, joinKey, normalizePrefix, sanitizeFilename } from './key.js'

describe('assertValidKey', () => {
  it('accepts an ordinary key', () => {
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

  it('throws when the key is not a string', () => {
    expect(() => assertValidKey(42)).toThrowError(/non-empty string/)
  })

  it('throws when the key exceeds 1024 bytes', () => {
    expect(() => assertValidKey('a'.repeat(1025))).toThrowError(/1024 bytes/)
  })

  it('measures the key in utf-8 bytes rather than characters', () => {
    expect(() => assertValidKey('é'.repeat(513))).toThrowError(/1024 bytes/)
    expect(() => assertValidKey('é'.repeat(512))).not.toThrow()
  })

  it('throws a BucketCodeError carrying the INVALID_KEY code', () => {
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

  it('returns undefined when the prefix is blank', () => {
    expect(normalizePrefix('')).toBeUndefined()
    expect(normalizePrefix('///')).toBeUndefined()
    expect(normalizePrefix(undefined)).toBeUndefined()
  })
})

describe('joinKey', () => {
  it('joins the prefix and the key with a single slash', () => {
    expect(joinKey('uploads', 'a.png')).toBe('uploads/a.png')
    expect(joinKey('/uploads/', 'a.png')).toBe('uploads/a.png')
  })

  it('returns the key unchanged when there is no prefix', () => {
    expect(joinKey(undefined, 'a.png')).toBe('a.png')
  })
})

describe('sanitizeFilename', () => {
  it('replaces unsafe characters while keeping the extension', () => {
    expect(sanitizeFilename('Rapport final.pdf')).toBe('Rapport-final.pdf')
  })

  it('drops the directory segments of a path', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\me\\photo.png')).toBe('photo.png')
  })

  it('collapses unsafe runs and falls back to "file" when nothing is left', () => {
    expect(sanitizeFilename('a  ***  b.png')).toBe('a-b.png')
    expect(sanitizeFilename('...')).toBe('file')
    expect(sanitizeFilename('')).toBe('file')
  })

  it('caps the filename at 100 characters', () => {
    expect(sanitizeFilename(`${'a'.repeat(200)}.png`)).toHaveLength(100)
  })
})

describe('generateKey', () => {
  it('returns a unique key that keeps the filename readable', () => {
    const first = generateKey('mon rapport.pdf')
    const second = generateKey('mon rapport.pdf')

    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f-]{36}-mon-rapport\.pdf$/)
  })

  it('returns a bare uuid when no filename is given', () => {
    expect(generateKey()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('produces a key that passes assertValidKey even from a hostile filename', () => {
    expect(() => assertValidKey(generateKey('../../evil name!.png'))).not.toThrow()
  })
})

describe('encodeKey', () => {
  it('percent-encodes each segment while keeping the slash separators', () => {
    expect(encodeKey('uploads/mon rapport.pdf')).toBe('uploads/mon%20rapport.pdf')
    expect(encodeKey('a/b+c&d.png')).toBe('a/b%2Bc%26d.png')
  })
})
