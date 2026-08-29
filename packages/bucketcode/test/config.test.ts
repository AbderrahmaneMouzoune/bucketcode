import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from '../src/config.js'
import type { BucketCodeError } from '../src/errors.js'
import { clearBucketEnv } from './helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('resolveConfig', () => {
  it('requires a bucket', () => {
    const error = (() => {
      try {
        resolveConfig()
      } catch (e) {
        return e as BucketCodeError
      }
    })()

    expect(error?.code).toBe('INVALID_CONFIG')
    expect(error?.message).toMatch(/BUCKETCODE_BUCKET/)
  })

  it('falls back to environment variables', () => {
    vi.stubEnv('S3_BUCKET', 'from-env')
    vi.stubEnv('AWS_REGION', 'eu-west-3')

    expect(resolveConfig()).toMatchObject({ bucket: 'from-env', region: 'eu-west-3' })
  })

  it('prefers explicit config over the environment', () => {
    vi.stubEnv('S3_BUCKET', 'from-env')

    expect(resolveConfig({ bucket: 'explicit' }).bucket).toBe('explicit')
  })

  it('defaults region and path style for custom endpoints', () => {
    const config = resolveConfig({ bucket: 'b', endpoint: 'https://account.r2.cloudflarestorage.com' })

    expect(config.region).toBe('auto')
    expect(config.forcePathStyle).toBe(true)
  })

  it('leaves path style off for plain AWS', () => {
    expect(resolveConfig({ bucket: 'b', region: 'eu-west-3' }).forcePathStyle).toBe(false)
  })

  it('lets forcePathStyle be overridden', () => {
    expect(resolveConfig({ bucket: 'b', endpoint: 'https://example.com', forcePathStyle: false }).forcePathStyle).toBe(
      false,
    )
  })

  it('normalizes the public URL and the prefix', () => {
    const config = resolveConfig({ bucket: 'b', publicUrl: 'https://cdn.example.com/', prefix: '/uploads/' })

    expect(config.publicUrl).toBe('https://cdn.example.com')
    expect(config.prefix).toBe('uploads')
  })

  it('rejects a relative public URL', () => {
    expect(() => resolveConfig({ bucket: 'b', publicUrl: '/uploads' })).toThrowError(/absolute URL/)
  })

  it('rejects a non-positive maxSize', () => {
    expect(() => resolveConfig({ bucket: 'b', maxSize: 0 })).toThrowError(/positive number of bytes/)
  })
})
