import { S3Client } from '@aws-sdk/client-s3'

import { BucketCodeError } from './errors.js'
import { normalizePrefix } from './key.js'
import type { BucketConfig, ResolvedConfig } from './types.js'

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value != null && value.length > 0) return value
  }

  return undefined
}

function normalizePublicUrl(publicUrl: string | undefined): string | undefined {
  if (publicUrl == null) return undefined

  const trimmed = publicUrl.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return undefined

  try {
    new URL(trimmed)
  } catch {
    throw new BucketCodeError('INVALID_CONFIG', `\`publicUrl\` must be an absolute URL (received "${publicUrl}").`)
  }

  return trimmed
}

export function resolveConfig(config: BucketConfig = {}): ResolvedConfig {
  const bucket = config.bucket ?? env('BUCKETCODE_BUCKET', 'S3_BUCKET')

  if (typeof bucket !== 'string' || bucket.trim().length === 0) {
    throw new BucketCodeError(
      'INVALID_CONFIG',
      'A bucket name is required. Pass `{ bucket }` to createBucket(), or set BUCKETCODE_BUCKET / S3_BUCKET.',
    )
  }

  if (config.maxSize != null && (!Number.isFinite(config.maxSize) || config.maxSize <= 0)) {
    throw new BucketCodeError('INVALID_CONFIG', '`maxSize` must be a positive number of bytes.')
  }

  const endpoint = config.endpoint ?? env('BUCKETCODE_ENDPOINT', 'S3_ENDPOINT')

  return {
    bucket: bucket.trim(),
    // R2 and most S3-compatible endpoints ignore the region but the SDK still
    // requires one; "auto" is the convention.
    region: config.region ?? env('BUCKETCODE_REGION', 'AWS_REGION', 'AWS_DEFAULT_REGION') ?? (endpoint ? 'auto' : undefined),
    credentials: config.credentials,
    endpoint,
    // Path style is what self-hosted gateways (MinIO, Ceph) expect, and every
    // managed S3-compatible provider accepts it too.
    forcePathStyle: config.forcePathStyle ?? endpoint != null,
    publicUrl: normalizePublicUrl(config.publicUrl ?? env('BUCKETCODE_PUBLIC_URL', 'S3_PUBLIC_URL')),
    prefix: normalizePrefix(config.prefix),
    maxSize: config.maxSize,
    client: config.client,
  }
}

export function createS3Client(config: ResolvedConfig): S3Client {
  if (config.client) return config.client

  return new S3Client({
    ...(config.region ? { region: config.region } : {}),
    ...(config.credentials ? { credentials: config.credentials } : {}),
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: config.forcePathStyle } : {}),
  })
}
