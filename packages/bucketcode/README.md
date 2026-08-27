# bucketcode

Server-side S3 uploads, without the ceremony.

```ts
const bucket = createBucket({ bucket: 'my-bucket' })

await bucket.upload(file) // → { key, path, url?, size?, etag?, contentType }
await bucket.put(id, file) // one file per identifier: create or replace
await bucket.get(id) // → the file back, or null
await bucket.getUrl(id) // → public or presigned URL
await bucket.delete(id) // → void
```

No presigned POST to orchestrate, no CORS rules to write on the bucket, no browser-side
signing: your credentials stay on the server and every call goes straight to S3. Works
with AWS S3 and any S3-compatible storage (Cloudflare R2, MinIO, Scaleway, Wasabi, Ceph).

The [documentation site](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/apps/docs)
goes further than this README: configuration, providers, error handling, testing, and four worked
use cases. Runnable
[examples](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/examples) live in the same
repository.

- **Small surface.** Five methods, all server-side. No dual client/server mode, no
  conditional branches depending on where the code runs.
- **Typed.** Written in TypeScript, ESM + CJS, no `any` in the public API.
- **Safe by default.** Keys are validated (no traversal, no absolute paths), content types
  are detected, and size limits are enforced before anything hits the network.

## Install

```sh
npm install bucketcode
```

Node 20 or later — that is what AWS SDK v3 requires. `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` come along as
dependencies — nothing else to install.

## ⚠️ Read this before shipping: the payload goes through your server

`upload()` sends the bytes from your server to S3 in a single `PutObject` request. The file
therefore transits through your runtime, and your runtime has a request size limit:

| Runtime                                                    | Max request body                  |
| ---------------------------------------------------------- | --------------------------------- |
| AWS Lambda (synchronous invoke, API Gateway, function URL) | **6 MB**                          |
| Vercel Serverless Functions                                | **4.5 MB**                        |
| Netlify Functions                                          | **6 MB**                          |
| Next.js Pages Router API routes (`bodyParser`)             | **1 MB** by default, configurable |
| Long-running Node server (Express, Fastify, Docker…)       | whatever you configure            |

Under those limits — avatars, documents, images, CSV exports — this is the simplest thing
that works. Above them, a single `PutObject` is the wrong tool, and v0.2 answers it with
multipart upload and presigned URLs so the browser talks to S3 directly. See
[Roadmap](#roadmap).

## Quick start

```ts
import { createBucket } from 'bucketcode'

const bucket = createBucket({
  bucket: 'my-bucket',
  region: 'eu-west-3',
  // credentials are optional: the AWS default provider chain (env vars, shared
  // config, IAM role) is used when you omit them.
})

const { key, size } = await bucket.upload(Buffer.from('hello'), { key: 'greeting.txt' })

const url = await bucket.getUrl(key, { expiresIn: 900 })

await bucket.delete(key)
```

### One file per identifier

Generate an id, store the file under it, read it back later. This is the shape most
apps actually need: a row in your database holds `XK5892`, and the bucket holds the
file for it.

```ts
import { nanoid } from 'nanoid'
import { createBucket } from 'bucketcode'

const bucket = createBucket({ bucket: 'my-bucket', prefix: 'files' })

const id = nanoid(6) // "XK5892"

await bucket.put(id, file) // create
await bucket.put(id, newVersion) // replace — same id, no cleanup to do

const stored = await bucket.get(id)

if (stored) {
  stored.filename // "rapport.pdf" — the name it was uploaded with
  stored.contentType // "application/pdf"
  stored.size // 48213
  await stored.bytes() // Uint8Array
}
```

`put()` writes to the id, so writing again replaces what is there — S3 has no
separate update call. `get()` returns `null` when nothing is stored under that id,
so a missing file is a value you branch on rather than an exception you catch.

The configured `prefix` stays internal: you store `"XK5892"`, the bucket holds
`files/XK5892`, and every method takes the plain id.

#### Serving it back

Cheapest — your server signs a URL and S3 serves the bytes:

```ts
// app/api/files/[id]/route.ts
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  return Response.redirect(await bucket.getUrl(id, { expiresIn: 60 }))
}
```

Or stream it through your route, when you need to check permissions or answer 404
yourself:

```ts
import { Readable } from 'node:stream'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const file = await bucket.get(id)

  if (!file) return new Response('Not found', { status: 404 })

  return new Response(Readable.toWeb(file.body) as ReadableStream, {
    headers: {
      'Content-Type': file.contentType,
      ...(file.filename ? { 'Content-Disposition': `inline; filename="${file.filename}"` } : {}),
    },
  })
}
```

### Next.js App Router

```ts
// app/api/upload/route.ts
import { createBucket, isBucketCodeError } from 'bucketcode'

const bucket = createBucket({ bucket: process.env.S3_BUCKET, prefix: 'uploads', maxSize: 4 * 1024 * 1024 })

export async function POST(request: Request) {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file' }, { status: 400 })
  }

  try {
    // No key: bucketcode generates `uploads/<uuid>-<filename>` and detects the content type.
    const result = await bucket.upload(file)
    return Response.json({ key: result.key, url: await bucket.getUrl(result.key) })
  } catch (error) {
    if (isBucketCodeError(error) && error.code === 'FILE_TOO_LARGE') {
      return Response.json({ error: 'File too large' }, { status: 413 })
    }

    throw error
  }
}
```

### Express

```ts
app.put('/files/:name', async (request, response) => {
  const result = await bucket.upload(request, {
    filename: request.params.name,
    contentLength: Number(request.headers['content-length']),
    contentType: request.headers['content-type'],
  })

  response.json(result)
})
```

`request` is a Node `Readable`, so it is streamed to S3 rather than buffered — as long as
you pass `contentLength`. See [Streams](#streams).

## Configuration

```ts
createBucket({
  bucket: 'my-bucket', // required (or BUCKETCODE_BUCKET / S3_BUCKET)
  region: 'eu-west-3', // or BUCKETCODE_REGION / AWS_REGION / AWS_DEFAULT_REGION
  credentials: {
    // omit to use the AWS default provider chain
    accessKeyId: '…',
    secretAccessKey: '…',
    sessionToken: '…', // optional
  },
  endpoint: 'https://…', // S3-compatible storage — or BUCKETCODE_ENDPOINT / S3_ENDPOINT
  forcePathStyle: true, // defaults to true when `endpoint` is set
  publicUrl: 'https://cdn…', // public bucket or CDN — or BUCKETCODE_PUBLIC_URL / S3_PUBLIC_URL
  prefix: 'uploads', // internal namespace, applied on the way in and out
  maxSize: 5 * 1024 * 1024, // reject bigger uploads before any network call
  client: myS3Client, // bring your own S3Client (retries, proxy, tests)
})
```

Every option except `client` falls back to an environment variable, so the zero-config
form works once `S3_BUCKET` and the usual `AWS_*` variables are set:

```ts
const bucket = createBucket()
```

### Cloudflare R2

```ts
createBucket({
  bucket: 'my-bucket',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  publicUrl: 'https://cdn.example.com', // your R2 custom domain
})
```

### MinIO

```ts
createBucket({
  bucket: 'my-bucket',
  endpoint: 'http://localhost:9000',
  credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
})
```

`region` defaults to `"auto"` and `forcePathStyle` to `true` as soon as an `endpoint` is
set, which is what self-hosted gateways expect.

## API

### `upload(body, options?)`

```ts
const result = await bucket.upload(body, options)
```

`body` accepts a `string`, `Buffer`, `Uint8Array`, `ArrayBuffer`, typed array, `Blob`,
`File`, Node `Readable` or web `ReadableStream`.

| Option               | Type                     | Default                                                                           |
| -------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `key`                | `string`                 | generated: `<uuid>-<filename>`                                                    |
| `prefix`             | `string`                 | the bucket-level `prefix`                                                         |
| `filename`           | `string`                 | the `File` name, when there is one                                                |
| `contentType`        | `string`                 | the `File` type, else guessed from the extension, else `application/octet-stream` |
| `contentLength`      | `number`                 | the body size — **required for streams**                                          |
| `cacheControl`       | `string`                 | —                                                                                 |
| `contentDisposition` | `string`                 | —                                                                                 |
| `metadata`           | `Record<string, string>` | —                                                                                 |
| `acl`                | `ObjectCannedACL`        | — (most buckets block ACLs; prefer a bucket policy)                               |
| `signal`             | `AbortSignal`            | —                                                                                 |

Returns:

```ts
{
  bucket: string
  key: string          // the handle: pass it back to get/getUrl/delete
  path: string         // full object key in the bucket, prefix included
  contentType: string
  size?: number
  etag?: string        // quotes stripped
  url?: string         // only when `publicUrl` is configured — otherwise use getUrl()
}
```

`url` is deliberately absent on a private bucket: a URL that returns 403 is worse than no
URL at all.

`key` never carries the configured `prefix` — it is what you store and hand back to the
other methods. `path` is the real object key, for the AWS console or another tool.

### `put(id, body, options?)`

`upload(body, { key: id })`, with the id first because that reads better for the one
file per identifier case. Same options minus `key`, same result.

```ts
await bucket.put('XK5892', file)
```

Writing to an id that already holds a file replaces it.

### `get(key, options?)`

Reads an object back, or `null` when the key does not exist.

```ts
const file = await bucket.get('XK5892')
```

| Field                          | Type                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `bucket`, `key`, `path`        | `string`                                                         |
| `contentType`                  | `string`                                                         |
| `filename`                     | `string \| undefined` — the name it was uploaded with            |
| `size`, `etag`, `lastModified` | `number` / `string` / `Date`, when S3 reports them               |
| `metadata`                     | `Record<string, string>` — raw S3 user metadata, keys lowercased |
| `body`                         | `Readable`                                                       |
| `bytes()`                      | `Promise<Uint8Array>`                                            |
| `text()`                       | `Promise<string>`                                                |

The body can only be read once: use `body`, `bytes()` **or** `text()`, exactly one of
them. Accepts `{ signal }` to abort.

The filename comes from metadata that `upload()` and `put()` write for you whenever the
body carries one (a `File`, or an explicit `filename` option).

### `getUrl(key, options?)`

Returns the public URL when `publicUrl` is configured, a presigned `GET` otherwise.

| Option      | Type                             | Default                                                                          |
| ----------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `expiresIn` | `number` (seconds, max `604800`) | `3600`                                                                           |
| `signed`    | `boolean`                        | `true` unless `publicUrl` is set                                                 |
| `download`  | `boolean \| string`              | — sets `Content-Disposition: attachment`, with a filename when you pass a string |

```ts
await bucket.getUrl('invoices/2026-01.pdf', { expiresIn: 300, download: 'Facture janvier.pdf' })
```

Signing is local: it costs no network round-trip and no S3 permission beyond the ones your
credentials already carry.

### `delete(key)`

```ts
await bucket.delete('uploads/a.png')
await bucket.delete(['uploads/a.png', 'uploads/b.png']) // batched, 1000 keys per request
```

Deleting a key that does not exist is a no-op, not an error — same semantics as S3 itself.

### Streams

Streams are accepted from v0.1, but a single `PutObject` request cannot use chunked
encoding, so S3 needs the size upfront:

```ts
await bucket.upload(stream, { key: 'video.mp4', contentLength: 12_582_912 })
```

Without `contentLength`, `upload()` throws `MISSING_CONTENT_LENGTH` rather than failing
deep inside the AWS SDK. When multipart upload lands in v0.2, `contentLength` becomes
optional — the signature does not change.

## Errors

Everything thrown by bucketcode is a `BucketCodeError` with a stable `code`:

```ts
import { isBucketCodeError } from 'bucketcode'

try {
  await bucket.upload(file)
} catch (error) {
  if (isBucketCodeError(error)) {
    console.error(error.code, error.message, error.cause)
  }
}
```

| Code                     | When                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `INVALID_CONFIG`         | missing bucket, bad `publicUrl`, non-positive `maxSize`                                |
| `INVALID_KEY`            | empty key, leading/trailing `/`, `..` segment, backslash, over 1024 bytes              |
| `INVALID_BODY`           | unsupported body type                                                                  |
| `MISSING_CONTENT_LENGTH` | stream uploaded without `contentLength`                                                |
| `FILE_TOO_LARGE`         | body above the configured `maxSize`                                                    |
| `UPLOAD_FAILED`          | `PutObject` rejected — original error in `cause`                                       |
| `GET_FAILED`             | `GetObject` rejected for a reason other than a missing key, or answered without a body |
| `DELETE_FAILED`          | `DeleteObject(s)` rejected, or S3 reported per-key errors                              |
| `URL_FAILED`             | invalid `expiresIn`, signing failure, or public URL requested without `publicUrl`      |

Failures that can be caught locally (bad key, oversized body) are raised _before_ any
network call.

## Testing your own code

Pass a fake client — no network, no credentials:

```ts
const bucket = createBucket({
  bucket: 'test',
  client: { send: async () => ({ ETag: '"abc"' }) } as unknown as S3Client,
})
```

`getUrl()` signs locally with the real SDK, so a stub client only covers `upload()` and
`delete()`. To exercise signing, pass static credentials instead — no network involved.

## Roadmap

- **v0.1** — `upload` / `put` / `get` / `getUrl` / `delete`, server-side only. ✅
- **v0.2** — multipart upload for large files (streams without `contentLength`), presigned
  PUT/POST so the browser can talk to S3 directly and bypass the payload limits above.
- **v0.3** — `list()`, `copy()`, `head()` to check an id without downloading it.

## License

MIT © Abderrahmane Mouzoune
