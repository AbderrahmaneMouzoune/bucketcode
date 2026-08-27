import { isBucketCodeError } from 'bucketcode'
import { nanoid } from 'nanoid'

import { bucket } from '@/lib/bucket'

/** POST /api/files — store a file under a freshly generated identifier. */
export async function POST(request: Request) {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file' }, { status: 400 })
  }

  const id = nanoid(6)

  try {
    const result = await bucket().put(id, file)

    // A real application writes its database row here, once the upload succeeded.
    return Response.json({ id, size: result.size, contentType: result.contentType }, { status: 201 })
  } catch (error) {
    if (isBucketCodeError(error) && error.code === 'FILE_TOO_LARGE') {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    throw error
  }
}
