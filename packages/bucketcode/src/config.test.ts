import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveConfig } from './config.js'
import type { BucketCodeError } from './errors.js'
import { clearBucketEnv } from './test-helpers.js'

beforeEach(clearBucketEnv)
afterEach(() => vi.unstubAllEnvs())

describe('resolveConfig', () => {
  it('throws INVALID_CONFIG when no bucket is configured', () => {
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

  it('reads the bucket and region from the environment when they are not passed', () => {
    vi.stubEnv('S3_BUCKET', 'from-env')
    vi.stubEnv('AWS_REGION', 'eu-west-3')

    expect(resolveConfig()).toMatchObject({ bucket: 'from-env', region: 'eu-west-3' })
  })

  it('prefers an explicit bucket over the environment', () => {
    vi.stubEnv('S3_BUCKET', 'from-env')

    expect(resolveConfig({ bucket: 'explicit' }).bucket).toBe('explicit')
  })

  it('applies S3-compatible defaults when a custom endpoint is set', () => {
    const config = resolveConfig({ bucket: 'b', endpoint: 'https://account.r2.cloudflarestorage.com' })

    expect(config.region).toBe('auto')
    expect(config.forcePathStyle).toBe(true)
  })

  it('leaves path style off when no endpoint is set', () => {
    expect(resolveConfig({ bucket: 'b', region: 'eu-west-3' }).forcePathStyle).toBe(false)
  })

  it('honours an explicit forcePathStyle over the endpoint default', () => {
    expect(resolveConfig({ bucket: 'b', endpoint: 'https://example.com', forcePathStyle: false }).forcePathStyle).toBe(
      false,
    )
  })

  it('strips surrounding slashes from the public URL and the prefix', () => {
    const config = resolveConfig({ bucket: 'b', publicUrl: 'https://cdn.example.com/', prefix: '/uploads/' })

    expect(config.publicUrl).toBe('https://cdn.example.com')
    expect(config.prefix).toBe('uploads')
  })

  it('throws when the public URL is not absolute', () => {
    expect(() => resolveConfig({ bucket: 'b', publicUrl: '/uploads' })).toThrowError(/absolute URL/)
  })

  it('throws when maxSize is not a positive number', () => {
    expect(() => resolveConfig({ bucket: 'b', maxSize: 0 })).toThrowError(/positive number of bytes/)
  })
})
