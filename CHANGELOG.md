# Changelog

<!-- release:start -->

## 0.1.0

First release. Server-side only: credentials never leave the server, and the bucket needs no CORS
configuration.

### Snapshots

The reason the package exists: carrying a local-first app's data — an IndexedDB database — from
one device to another.

- `putSnapshot(key, data, options)` wraps a value in a self-describing envelope (app, schema
  version, device, timestamps), serializes it as JSON and gzips it. A realistic database dump
  compresses better than 10×, which is what keeps it under a serverless request limit.
- `getSnapshot(key, options)` reads it back, or returns `null` — for a key that was never written
  **and** for one past its `expiresAt`, which is never handed over even while the object is still
  in the bucket. `maxVersion` makes a snapshot from a newer build throw `SNAPSHOT_TOO_NEW` rather
  than land in an app that would misread it.
- `createSyncCode()` and `normalizeSyncCode()` produce and accept a code a person can read off one
  screen and type into another: Crockford base32, no `I`, `L`, `O` or `U`, and folded on the way
  back in so `k7-qp2m4x` and `K7QP2M4X` find the same snapshot.
- `ifMatch` and `ifAbsent` turn a concurrent write from silent data loss into
  `PRECONDITION_FAILED`. That is what makes a per-account backup safe when two devices push.

### Files

The primitives snapshots are built on, available for everything that is not a snapshot —
attachments, exports, avatars.

- `createBucket(config)` — bucket handle with lazy `S3Client` creation, environment variable
  fallbacks, and support for S3-compatible endpoints (R2, MinIO, Scaleway…).
- `upload(body, options)` — single `PutObject` accepting strings, buffers, typed arrays,
  `Blob`/`File`, Node `Readable` and web `ReadableStream`. Generates a collision-free key, detects
  the content type, and enforces `maxSize` before any network call.
- `put(id, body, options)` — the file for an identifier, created or replaced.
- `get(key, options)` — reads an object back with its metadata and original filename, or `null`.
- `getUrl(key, options)` — public URL when `publicUrl` is configured, presigned `GET` otherwise.
- `delete(key)` — one key or many, batched at 1000 per request.
- `BucketCodeError` with stable error codes, and `isBucketCodeError()`.

Keys round-trip: the configured `prefix` is an internal namespace applied by every method, and
`UploadResult.key` is the handle you hand back to `get`, `getUrl` and `delete`
(`UploadResult.path` carries the full object key).

### Known limitations

- A snapshot travels through your server, so it is bound by your runtime's request size limit
  (6 MB on synchronous Lambda, 4.5 MB on Vercel). Compression buys most applications an order of
  magnitude of headroom; above that, split by object store.
- Restoring replaces the receiving device's state. There is no per-record merge, and this is not a
  sync engine.
- Streams require an explicit `contentLength`; multipart upload and presigned browser uploads are
  planned for v0.2.

<!-- release:end -->
