import { Readable } from 'node:stream'

import { HeadObjectCommand } from '@aws-sdk/client-s3'

import { bucket } from '@/lib/bucket'

/**
 * Cheap existence check through the escape hatch: `bucket.client` is the plain
 * `S3Client`, so anything the package does not wrap is still one command away.
 * A real application would check its own database row instead.
 */
async function exists(id: string): Promise<boolean> {
  try {
    await bucket().client.send(new HeadObjectCommand({ Bucket: bucket().bucket, Key: `files/${id}` }))
    return true
  } catch {
    return false
  }
}

interface Context {
  params: Promise<{ id: string }>
}

/** GET /api/files/:id — stream the file back, with its original name. */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params
  const file = await bucket().get(id)

  if (!file) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(Readable.toWeb(file.body) as ReadableStream, {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, no-store',
      ...(file.filename ? { 'Content-Disposition': `inline; filename="${file.filename}"` } : {}),
    },
  })
}

/** PUT /api/files/:id — replace the file behind an identifier. */
export async function PUT(request: Request, { params }: Context) {
  const { id } = await params
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file' }, { status: 400 })
  }

  // Only replace something that exists: a six character id is guessable.
  if (!(await exists(id))) {
    return new Response('Not found', { status: 404 })
  }

  const result = await bucket().put(id, file)

  return Response.json({ id, size: result.size, contentType: result.contentType })
}

/** DELETE /api/files/:id */
export async function DELETE(_request: Request, { params }: Context) {
  const { id } = await params

  await bucket().delete(id)

  return new Response(null, { status: 204 })
}
