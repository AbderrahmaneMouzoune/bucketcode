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
    prefix: 'files',
    maxSize: 4 * 1024 * 1024,
  })

  return cached
}
