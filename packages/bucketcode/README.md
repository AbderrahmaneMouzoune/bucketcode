# bucketcode

Move a local-first app's data from one device to another, through your own bucket.

```ts
import { createBucket, createSyncCode, normalizeSyncCode } from 'bucketcode'

const store = createBucket({ bucket: 'my-bucket', prefix: 'snapshots' })

// On the old device: hand the user a code.
const code = createSyncCode() // "K7QP2M4X"
await store.putSnapshot(code, state, { app: 'notes', version: 3, expiresIn: 3600 })

// On the new device: they type it in.
const snapshot = await store.getSnapshot(normalizeSyncCode(typed), { maxVersion: 3 })
snapshot?.data // → the state, ready to write back into IndexedDB
```

Your app keeps everything in IndexedDB: fast, offline, private. Then the user opens it on their
phone and it is empty, because IndexedDB does not leave the browser it was written in. bucketcode
is the small server-side piece that closes that gap — it snapshots the local state into a bucket
you control, under a code the user carries across.

Credentials stay on your server. The browser only ever talks to your own API, so there is no CORS
policy to write on the bucket and nothing to sign client-side. Works with AWS S3 and any
S3-compatible storage (Cloudflare R2, MinIO, Scaleway, Wasabi, Ceph).

The [documentation site](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/apps/docs)
covers the whole flow, and a
[runnable IndexedDB example](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/examples/indexeddb-sync)
lives in the same repository.

## Install

```sh
npm install bucketcode
```

Node 20 or later — that is what AWS SDK v3 requires. `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner` come along as dependencies, so there is nothing else to install
and no peer dependency to satisfy.

## What a snapshot is

`putSnapshot()` wraps your value in a self-describing envelope, serializes it as JSON and gzips it:

```jsonc
{
  "bucketcode": 1, // envelope format, not your data's
  "app": "notes",
  "version": 3, // your schema version
  "device": "Pixel 8",
  "createdAt": "2026-08-27T12:00:00.000Z",
  "expiresAt": "2026-08-27T13:00:00.000Z",
  "data": {/* whatever you passed */},
}
```

That envelope is what makes a restore safe rather than hopeful. `getSnapshot()` reads it back and:

- returns `null` when there is nothing stored, **or when the snapshot has expired** — an expired
  snapshot is never handed over, even if the object is still sitting in the bucket;
- throws `SNAPSHOT_TOO_NEW` when the snapshot's `version` is above the `maxVersion` this build
  understands, instead of feeding an old app data it will misread;
- gives you back `createdAt`, `device` and `etag`, which is what you need to show the user _what_
  they are about to restore.

Compression is on by default and is not a detail: an IndexedDB dump is repetitive JSON, so gzip
routinely cuts it by 5–10×. That is headroom against the request limit of whatever runs your API.

## The two routes

```ts
// POST /api/sync — the device that has the data
export async function POST(request: Request) {
  const state = await request.json()
  const code = createSyncCode()

  await store.putSnapshot(code, state, {
    app: 'notes',
    version: SCHEMA_VERSION,
    device: request.headers.get('user-agent') ?? undefined,
    expiresIn: 60 * 60, // a transfer code should not outlive the transfer
    ifAbsent: true, // never land on a code someone else already claimed
  })

  return Response.json({ code })
}
```

```ts
// GET /api/sync/[code] — the device that wants it
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params

  const snapshot = await store.getSnapshot(normalizeSyncCode(code), { maxVersion: SCHEMA_VERSION })

  if (!snapshot) return Response.json({ error: 'Unknown or expired code' }, { status: 404 })

  return Response.json({ data: snapshot.data, createdAt: snapshot.createdAt, device: snapshot.device })
}
```

The client half — reading IndexedDB out and writing it back in — is your application's code,
because only it knows its own object stores. The
[example](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/examples/indexeddb-sync)
shows a complete one.

## Sync codes

`createSyncCode()` produces a code from [Crockford base32](https://www.crockford.com/base32.html):
no `I`, `L`, `O` or `U`, so it survives being read aloud, written on paper, or typed on a phone.
Eight characters is the default — about 10¹² combinations.

`normalizeSyncCode()` turns what someone typed into the canonical form: case is ignored, spaces
and dashes are dropped, and the characters people confuse are folded — `O` reads as zero, `I` and
`L` as one. Call it on user input before you look anything up.

```ts
normalizeSyncCode('k7-qp2m4x') // → "K7QP2M4X"
normalizeSyncCode('OIL5ABCD') // → "0115ABCD"
```

**A sync code is a bearer token.** Anyone who has it can read that snapshot. Give it a short
`expiresIn`, and if the data is sensitive, encrypt it in the browser before it ever reaches your
server — `putSnapshot()` stores whatever you hand it, ciphertext included.

## Two devices, one snapshot

For a shared key that both devices write to — a continuous backup rather than a one-shot
transfer — pass the ETag you last read as `ifMatch`. A device that writes after someone else did
gets `PRECONDITION_FAILED` instead of silently discarding their work:

```ts
const current = await store.getSnapshot(`user-${userId}`)

try {
  await store.putSnapshot(`user-${userId}`, merged, { ifMatch: current?.etag })
} catch (error) {
  if (isBucketCodeError(error) && error.code === 'PRECONDITION_FAILED') {
    // Another device won. Read again, merge again.
  }

  throw error
}
```

`ifAbsent: true` is the other half: write only if nothing is stored yet, which is how you claim a
freshly generated code without a chance of trampling one already in use.

## The file API underneath

Snapshots are built on a small set of file primitives, and they stay available for everything that
is not a snapshot — an attachment, an exported PDF, an avatar:

```ts
await store.upload(file) // → { key, path, url?, size?, etag?, contentType }
await store.put(id, file) // one file per identifier: create or replace
await store.get(id) // → the file back, or null
await store.getUrl(id) // → public or presigned URL
await store.delete(id) // → void
```

Keys round-trip: what `upload()` returns is what you hand back to `get()`, `getUrl()` and
`delete()`. The configured `prefix` is an internal namespace.

Anything the package does not wrap is one command away through `store.client`, which is the plain
`S3Client`.

## Errors

Everything throws a `BucketCodeError` carrying a stable `code`, with the original error in `cause`:

| Code                                                            | When                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `INVALID_CONFIG`                                                | Missing bucket, `publicUrl` that is not an absolute URL, non-positive `maxSize`.                        |
| `INVALID_SYNC_CODE`                                             | The code is empty, or holds characters outside the alphabet.                                            |
| `INVALID_SNAPSHOT`                                              | Data JSON cannot represent, a stored object that is not a snapshot, or an envelope from a newer format. |
| `SNAPSHOT_TOO_NEW`                                              | The snapshot's schema version is above the `maxVersion` given.                                          |
| `PRECONDITION_FAILED`                                           | An `ifMatch` or `ifAbsent` write lost the race.                                                         |
| `INVALID_KEY`                                                   | Empty key, leading or trailing `/`, `..` segment, backslash, over 1024 bytes.                           |
| `INVALID_BODY`                                                  | Unsupported upload body type.                                                                           |
| `MISSING_CONTENT_LENGTH`                                        | A stream uploaded without `contentLength`.                                                              |
| `FILE_TOO_LARGE`                                                | Body above the configured `maxSize`.                                                                    |
| `UPLOAD_FAILED` / `GET_FAILED` / `DELETE_FAILED` / `URL_FAILED` | S3 rejected the request.                                                                                |

Failures that can be caught locally — a bad code, an oversized body, unserializable data — are
raised before anything reaches the network.

## Size, and where the ceiling is

A snapshot goes from the browser to your server, and only then to S3, so your runtime's request
limit applies: **6 MB** on synchronous Lambda, **4.5 MB** on Vercel serverless functions, **6 MB**
on Netlify, **1 MB** by default on Next.js Pages Router API routes. Gzip buys most apps an order of
magnitude of headroom, and `maxSize` lets you refuse an oversized snapshot before it costs you a
request.

Above that, split the snapshot per object store, or presign an upload so the browser talks to S3
directly. Both get first-class support in v0.2, along with multipart.

## Configuration

```ts
createBucket({
  bucket: 'my-bucket', // required (or BUCKETCODE_BUCKET / S3_BUCKET)
  region: 'eu-west-3', // or BUCKETCODE_REGION / AWS_REGION / AWS_DEFAULT_REGION
  credentials: { accessKeyId: '…', secretAccessKey: '…' }, // omit for the AWS provider chain
  endpoint: 'https://…', // S3-compatible storage — or BUCKETCODE_ENDPOINT / S3_ENDPOINT
  prefix: 'snapshots', // internal namespace, applied on the way in and out
  maxSize: 5 * 1024 * 1024, // reject bigger writes before any network call
})
```

With an `endpoint` set, `region` defaults to `"auto"` and path-style addressing is enabled — what
R2, MinIO and Scaleway expect. Every option except `client` falls back to an environment variable,
so `createBucket()` with no arguments works once `S3_BUCKET` and the usual `AWS_*` variables are
set.

## License

MIT © Abderrahmane Mouzoune
