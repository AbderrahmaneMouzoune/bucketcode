# Changelog

## 0.1.0

First release. Server-side only: credentials never leave the server, and the bucket needs
no CORS configuration.

### Added

- `createBucket(config)` — bucket handle with lazy `S3Client` creation, environment
  variable fallbacks, and support for S3-compatible endpoints (R2, MinIO, Scaleway…).
- `upload(body, options)` — single `PutObject` accepting strings, buffers, typed arrays,
  `Blob`/`File`, Node `Readable` and web `ReadableStream`. Generates a collision-free key,
  detects the content type, and enforces `maxSize` before any network call.
- `put(id, body, options)` — the file for an identifier, created or replaced.
- `get(key, options)` — reads an object back with its metadata and original filename, or
  `null` when the key does not exist.
- `getUrl(key, options)` — public URL when `publicUrl` is configured, presigned `GET`
  otherwise, with optional `download` disposition.
- `delete(key)` — one key or many, batched at 1000 per request.
- `BucketCodeError` with stable error codes, and `isBucketCodeError()`.

Keys round-trip: the configured `prefix` is an internal namespace, applied by every
method, and `UploadResult.key` is the handle you hand back to `get`, `getUrl` and
`delete` (`UploadResult.path` carries the full object key).

### Known limitations

- Uploads transit through your server, so they are bound by your runtime's request size
  limit (6 MB on synchronous Lambda, 4.5 MB on Vercel). See the README.
- Streams require an explicit `contentLength`; multipart upload is planned for v0.2.
