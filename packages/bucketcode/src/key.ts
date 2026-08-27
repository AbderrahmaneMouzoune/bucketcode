import { randomUUID } from 'node:crypto'

import { BucketCodeError } from './errors.js'

/** S3 hard limit: an object key is at most 1024 bytes of UTF-8. */
const MAX_KEY_BYTES = 1024
const CONTROL_CHARACTERS = /\p{Cc}/u
const UNSAFE_FILENAME_CHARACTERS = /[^a-zA-Z0-9._-]+/g

/**
 * Validates an object key. Keys often come from user input (a filename posted
 * by a browser), so traversal and absolute paths are rejected rather than
 * silently normalized.
 */
export function assertValidKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) {
    throw new BucketCodeError('INVALID_KEY', 'Object key must be a non-empty string.')
  }

  if (key.startsWith('/')) {
    throw new BucketCodeError('INVALID_KEY', `Object key must not start with "/" (received "${key}").`)
  }

  if (key.endsWith('/')) {
    throw new BucketCodeError('INVALID_KEY', `Object key must not end with "/" (received "${key}").`)
  }

  if (key.includes('\\')) {
    throw new BucketCodeError('INVALID_KEY', `Object key must not contain backslashes (received "${key}").`)
  }

  if (key.includes('//')) {
    throw new BucketCodeError('INVALID_KEY', `Object key must not contain empty path segments (received "${key}").`)
  }

  if (key.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new BucketCodeError('INVALID_KEY', `Object key must not contain "." or ".." segments (received "${key}").`)
  }

  if (CONTROL_CHARACTERS.test(key)) {
    throw new BucketCodeError('INVALID_KEY', 'Object key must not contain control characters.')
  }

  if (Buffer.byteLength(key, 'utf8') > MAX_KEY_BYTES) {
    throw new BucketCodeError('INVALID_KEY', `Object key must be at most ${MAX_KEY_BYTES} bytes.`)
  }
}

/** Strips surrounding slashes so prefixes can be concatenated safely. */
export function normalizePrefix(prefix: string | undefined): string | undefined {
  if (prefix == null) return undefined

  const trimmed = prefix.replace(/^\/+|\/+$/g, '')
  return trimmed.length > 0 ? trimmed : undefined
}

export function joinKey(prefix: string | undefined, key: string): string {
  const normalized = normalizePrefix(prefix)
  return normalized ? `${normalized}/${key}` : key
}

/**
 * Makes a filename safe to embed in a key: keeps the extension readable while
 * dropping anything that would need escaping in a URL.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const cleaned = base
    .replace(UNSAFE_FILENAME_CHARACTERS, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 100)

  return cleaned.length > 0 ? cleaned : 'file'
}

/** Collision-free key: a UUID, plus the original filename when we know it. */
export function generateKey(filename?: string): string {
  const id = randomUUID()
  return filename ? `${id}-${sanitizeFilename(filename)}` : id
}

/** Percent-encodes each segment while keeping the `/` separators intact. */
export function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/')
}
