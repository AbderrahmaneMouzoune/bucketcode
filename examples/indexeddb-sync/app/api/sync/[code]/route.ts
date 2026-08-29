import { isBucketCodeError, normalizeSyncCode } from 'bucketcode'

import { store, SCHEMA_VERSION } from '@/lib/store'

interface Context {
  params: Promise<{ code: string }>
}

/** Turns what the user typed into a key, or into a 400. */
function parse(code: string): { code: string } | { response: Response } {
  try {
    return { code: normalizeSyncCode(code) }
  } catch (error) {
    if (isBucketCodeError(error) && error.code === 'INVALID_SYNC_CODE') {
      return { response: Response.json({ error: 'That does not look like a code' }, { status: 400 }) }
    }

    throw error
  }
}

/** GET /api/sync/:code — the database behind a code, if the code is still live. */
export async function GET(_request: Request, { params }: Context) {
  const parsed = parse((await params).code)
  if ('response' in parsed) return parsed.response

  let snapshot
  try {
    snapshot = await store().getSnapshot(parsed.code, { maxVersion: SCHEMA_VERSION })
  } catch (error) {
    if (isBucketCodeError(error) && error.code === 'SNAPSHOT_TOO_NEW') {
      return Response.json({ error: 'That snapshot needs a newer version of this app' }, { status: 409 })
    }

    throw error
  }

  // Null covers both "never existed" and "expired" — the same thing to the user.
  if (!snapshot) {
    return Response.json({ error: 'Unknown or expired code' }, { status: 404 })
  }

  return Response.json({
    data: snapshot.data,
    createdAt: snapshot.createdAt,
    device: snapshot.device,
  })
}

/** DELETE /api/sync/:code — burn the code once the transfer worked. */
export async function DELETE(_request: Request, { params }: Context) {
  const parsed = parse((await params).code)
  if ('response' in parsed) return parsed.response

  await store().delete(parsed.code)

  return new Response(null, { status: 204 })
}
