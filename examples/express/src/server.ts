import { Readable } from 'node:stream'

import { createBucket, isBucketCodeError } from 'bucketcode'
import express from 'express'
import { nanoid } from 'nanoid'

const bucket = createBucket({
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
  endpoint: process.env.S3_ENDPOINT,
  prefix: 'files',
})

const app = express()

/**
 * Streams the request body straight to S3. Nothing is buffered in memory, which
 * is what a long-running server can do and a serverless function cannot.
 *
 * `contentLength` is required: a single PutObject cannot use chunked encoding.
 * A client that sends no Content-Length gets a clear 411 instead of an obscure
 * failure inside the AWS SDK.
 */
app.put('/files', async (request, response) => {
  const contentLength = Number(request.headers['content-length'])

  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    response.status(411).json({ error: 'Content-Length is required' })
    return
  }

  const id = nanoid(6)

  try {
    const result = await bucket.put(id, request, {
      contentLength,
      contentType: request.headers['content-type'],
      filename: typeof request.query.filename === 'string' ? request.query.filename : undefined,
    })

    response.status(201).json({ id, size: result.size, contentType: result.contentType })
  } catch (error) {
    if (isBucketCodeError(error)) {
      response.status(error.code === 'FILE_TOO_LARGE' ? 413 : 500).json({ error: error.code })
      return
    }

    throw error
  }
})

app.get('/files/:id', async (request, response) => {
  const file = await bucket.get(request.params.id)

  if (!file) {
    response.status(404).json({ error: 'Not found' })
    return
  }

  response.setHeader('Content-Type', file.contentType)
  if (file.size != null) response.setHeader('Content-Length', file.size)
  if (file.filename) response.setHeader('Content-Disposition', `inline; filename="${file.filename}"`)

  Readable.from(file.body).pipe(response)
})

/** Hands the download off to S3 instead of proxying the bytes. */
app.get('/files/:id/url', async (request, response) => {
  response.json({ url: await bucket.getUrl(request.params.id, { expiresIn: 60 }) })
})

app.delete('/files/:id', async (request, response) => {
  await bucket.delete(request.params.id)
  response.status(204).end()
})

const port = Number(process.env.PORT ?? 3300)

app.listen(port, () => {
  console.log(`listening on http://localhost:${port}`)
})
