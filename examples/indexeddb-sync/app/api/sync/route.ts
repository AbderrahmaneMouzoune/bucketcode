import { createSyncCode, isBucketCodeError } from 'bucketcode'

import { store, CODE_TTL_SECONDS, SCHEMA_VERSION } from '@/lib/store'

/** POST /api/sync — take this device's database and hand back a code for it. */
export async function POST(request: Request) {
  const state = await request.json()
  const code = createSyncCode()

  try {
    const result = await store().putSnapshot(code, state, {
      app: 'bucketcode-notes',
      version: SCHEMA_VERSION,
      device: request.headers.get('user-agent') ?? undefined,
      expiresIn: CODE_TTL_SECONDS,
      // Never land on a code somebody else already claimed.
      ifAbsent: true,
    })

    return Response.json({ code, expiresAt: result.expiresAt, size: result.size }, { status: 201 })
  } catch (error) {
    if (isBucketCodeError(error) && error.code === 'FILE_TOO_LARGE') {
      return Response.json({ error: 'This database is too large to transfer in one piece' }, { status: 413 })
    }

    throw error
  }
}
