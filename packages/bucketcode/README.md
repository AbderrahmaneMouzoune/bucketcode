# bucketcode

Move a local-first app's data from one device to another, through your own bucket.

```ts
import { createBucket } from 'bucketcode'

const store = createBucket({ bucket: 'my-bucket', prefix: 'snapshots' })

// On the old device: hand the user a code.
const code = store.codes.create() // "K7QP2M4X"
await store.putSnapshot(code, state, { app: 'notes', version: 3, expiresIn: 3600 })

// On the new device: they type it in.
const snapshot = await store.getSnapshot(store.codes.normalize(typed), { maxVersion: 3 })
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

## The routes, without writing them

`createTransferHandler()` serves [the transfer protocol](https://github.com/AbderrahmaneMouzoune/bucketcode/blob/main/apps/docs/content/docs/protocol.mdx):
create a transfer, read it back, burn it. It takes a `Request` and returns a `Response`, so it is a
Next route handler, a Hono route, `Bun.serve` or a worker without an adapter for any of them.

```ts
// app/api/transfers/[[...route]]/route.ts
import { createBucket, createTransferHandler } from 'bucketcode'

export const { GET, POST, DELETE } = createTransferHandler({
  bucket: createBucket({ bucket: 'my-bucket' }),
  app: 'notes',
  expiresIn: 3600,
})
```

Every route is public unless you pass `authorize` — fine for a personal drop box behind a proxy,
not fine for anything else:

```ts
createTransferHandler({
  bucket,
  authorize: (request) => request.headers.get('authorization') === `Bearer ${process.env.TOKEN}`,
})
```

The browser half is `bucketcode/protocol`, which is `fetch` and nothing else — no path from it
reaches the AWS SDK, so it bundles for a browser or React Native without dragging a storage client
along:

```ts
import { createTransferClient } from 'bucketcode/protocol'

const transfers = createTransferClient({ baseUrl: '/api/transfers' })

const { code } = await transfers.createSnapshot({ data: state, version: 3 })
const incoming = await transfers.read(typed) // null when unknown or expired
```

Writing the routes by hand stays perfectly reasonable when you want different shapes or different
semantics — the handler is built on the same public methods you would call yourself, and
`store.codes`, `putSnapshot()` and `getSnapshot()` are unchanged.

## The CLI

The package ships a binary, so anywhere bucketcode is installed:

```sh
npx bucketcode doctor
```

`doctor` performs the operations bucketcode needs and reports what happened, rather than reading
your bucket policy and reasoning about it:

```
✓ Configuration: bucket "transfers", region "eu-west-3"
✓ Credentials: resolved, key ends in 1234
✓ Bucket reachable: HeadBucket succeeded
✓ Write, read, delete: round-tripped a probe object
! Expiry cleanup: no enabled expiration rule
  → Add an S3 lifecycle rule that expires objects under this bucket after a day or two.
```

That last check is the one that earns the command: `expiresIn` stops a transfer being _handed
over_, but only a lifecycle rule deletes the object, and nothing surfaces the gap until a bill
does.

`put`, `get` and `rm` move files. The code goes to stdout and everything else to stderr, so it
composes:

```sh
CODE=$(bucketcode put ./report.pdf)
bucketcode get "$CODE" -o ./report.pdf   # on the other machine
```

Every command takes `--remote`, pointing it at your own deployment of the protocol instead of at
S3 — so the machine you run it from needs a token rather than credentials:

```sh
bucketcode --remote https://drop.example.com/api/transfers put ./report.pdf
```

## Sync codes

`store.codes` pairs code generation with the normalization that reads codes back, so the two can
never disagree about the alphabet. Codes are generated with
[nanoid](https://github.com/ai/nanoid).

The default is eight characters of
[Crockford base32](https://www.crockford.com/base32.html) — no `I`, `L`, `O` or `U`, so a code
survives being read aloud, written on paper, or typed on a phone. Both halves are configurable:

```ts
import { createBucket, syncCodeAlphabets } from 'bucketcode'

const store = createBucket({
  bucket: 'my-bucket',
  syncCode: { length: 4, alphabet: syncCodeAlphabets.digits },
})

store.codes.create() // "8143"
store.codes.entropyBits // 13.29 — what it is worth guessing against
```

`normalize()` canonicalizes what someone typed: separators dropped, case folded when the alphabet
has a single case, and confusable characters repaired when the alphabet makes that unambiguous —
`O` reads as zero only when there is no letter `O` to confuse it with. Call it on user input before
you look anything up.

```ts
store.codes.normalize('k7-qp2m4x') // → "K7QP2M4X"
store.codes.normalize('OIL5ABCD') // → "0115ABCD"
```

`createSyncCodes()`, `createSyncCode()` and `normalizeSyncCode()` are exported for use outside a
store; prefer `store.codes` in application code, since configuring the shape in one place is what
keeps the two sides in agreement.

They are also available on their own from `bucketcode/codes`, which has no path to the AWS SDK —
so the input that repairs a code as the user types it can run in the browser, before any network
call:

```ts
import { normalizeSyncCode } from 'bucketcode/codes'
```

**A sync code is a bearer token.** Anyone who has it can read that snapshot. Give it a short
`expiresIn` and rate-limit the lookup route — the shorter the code, the more that rate limit is
doing the work. If the data is sensitive, encrypt it in the browser before it ever reaches your
server: `putSnapshot()` stores whatever you hand it, ciphertext included.

Burning a code after a successful restore is a good habit, and there is no separate call for it:
`store.delete(code)` is the whole of it.

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
