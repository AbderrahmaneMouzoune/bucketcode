import { createBucket, isBucketCodeError } from 'bucketcode'
import { nanoid } from 'nanoid'

/**
 * Exercises the whole API against a real bucket: create, read, replace, sign,
 * delete. Point it at a local MinIO and it costs nothing to run.
 */
const bucket = createBucket({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT,
  prefix: 'round-trip',
  maxSize: 1024 * 1024,
})

const id = nanoid(6)

try {
  const created = await bucket.put(id, 'first version', { filename: 'notes.txt' })
  console.log('created  ', created.key, '→', created.path, `(${created.size} bytes)`)

  const first = await bucket.get(id)
  console.log('read     ', await first?.text(), '|', first?.filename, '|', first?.contentType)

  await bucket.put(id, 'second version, longer', { filename: 'notes.txt' })
  const second = await bucket.get(id)
  console.log('replaced ', await second?.text(), `(${second?.size} bytes)`)

  console.log('signed   ', (await bucket.getUrl(id, { expiresIn: 60 })).slice(0, 80), '…')

  await bucket.delete(id)
  console.log('deleted  ', (await bucket.get(id)) === null ? 'gone' : 'still there')
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
