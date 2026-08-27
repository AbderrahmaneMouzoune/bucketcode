import { createBucket, type Bucket } from 'bucketcode'

let cached: Bucket | undefined

/**
 * Built on first use rather than at module scope: `createBucket()` validates its
 * configuration eagerly, and `next build` imports route modules without the
 * runtime environment being set.
 */
export function bucket(): Bucket {
  cached ??= createBucket({
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    endpoint: process.env.S3_ENDPOINT,
    prefix: 'transfers',
    // Under Vercel's 4.5 MB request limit, so an oversized database is a clean
    // 413 rather than a truncated request.
    maxSize: 4 * 1024 * 1024,
  })

  return cached
}

/** Matches SCHEMA_VERSION in lib/db.ts — the server just carries it. */
export const SCHEMA_VERSION = 1

/** A transfer code should not outlive the transfer. */
export const CODE_TTL_SECONDS = 60 * 60
