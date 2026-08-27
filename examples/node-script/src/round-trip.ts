import { createBucket, createSyncCode, isBucketCodeError, normalizeSyncCode } from 'bucketcode'

/**
 * Exercises a transfer end to end against a real bucket: write a snapshot under
 * a code, read it back through a sloppily typed version of that code, prove the
 * conditional writes work, then clean up. Point it at a local MinIO and it costs
 * nothing to run.
 */
const bucket = createBucket({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT,
  prefix: 'round-trip',
  maxSize: 1024 * 1024,
})

/** Stands in for what an app dumps out of IndexedDB. */
const state = {
  notes: Array.from({ length: 200 }, (_, index) => ({
    id: `note-${index}`,
    title: `Note ${index}`,
    body: 'the quick brown fox jumps over the lazy dog',
    updatedAt: 1756296000000 + index,
  })),
}

const code = createSyncCode()

try {
  const written = await bucket.putSnapshot(code, state, {
    app: 'round-trip',
    version: 1,
    device: 'node-script',
    expiresIn: 60,
    ifAbsent: true,
  })

  const raw = JSON.stringify(state).length
  console.log(`code      ${code}`)
  console.log(`stored    ${written.size} bytes gzipped, from ${raw} raw (${(raw / (written.size ?? 1)).toFixed(1)}x)`)

  // The other device types it in lowercase, with a dash, and gets the same object.
  const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase()
  const restored = await bucket.getSnapshot<typeof state>(normalizeSyncCode(typed), { maxVersion: 1 })

  console.log(`typed     "${typed}" → ${normalizeSyncCode(typed)}`)
  console.log(
    `restored  ${restored?.data.notes.length} notes from ${restored?.device}, written ${restored?.createdAt.toISOString()}`,
  )
  console.log(`identical ${JSON.stringify(restored?.data) === JSON.stringify(state)}`)

  // A second device claiming the same code loses.
  try {
    await bucket.putSnapshot(code, state, { ifAbsent: true })
    console.log('claim     UNEXPECTED: the second claim succeeded')
  } catch (error) {
    console.log(`claim     rejected as ${isBucketCodeError(error) ? error.code : 'unknown'}`)
  }

  // A write based on a stale read loses too.
  await bucket.putSnapshot(code, { notes: [] })
  try {
    await bucket.putSnapshot(code, { notes: [] }, { ifMatch: written.etag })
    console.log('ifMatch   UNEXPECTED: the stale write succeeded')
  } catch (error) {
    console.log(`ifMatch   rejected as ${isBucketCodeError(error) ? error.code : 'unknown'}`)
  }

  await bucket.delete(code)
  console.log(`burned    ${(await bucket.getSnapshot(code)) === null ? 'gone' : 'still there'}`)
} catch (error) {
  if (isBucketCodeError(error)) {
    console.error(`${error.code}: ${error.message}`)
    process.exitCode = 1
  } else {
    throw error
  }
} finally {
  bucket.destroy()
}
