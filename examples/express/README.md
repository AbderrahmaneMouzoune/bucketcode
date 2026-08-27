# Express example

A long-running Node server, which is where bucketcode's stream support earns its keep: the request
body goes straight to S3 without being buffered.

| Route                | Does                                                         |
| -------------------- | ------------------------------------------------------------ |
| `PUT /files`         | Streams the request body to S3 under a fresh id.             |
| `GET /files/:id`     | Streams the object back.                                     |
| `GET /files/:id/url` | Returns a 60-second presigned URL instead of proxying bytes. |
| `DELETE /files/:id`  | Removes it.                                                  |

## Run it

```sh
cp .env.example .env
pnpm install
node --env-file=.env --import tsx src/server.ts
```

With a local MinIO running — see the [providers guide](../../apps/docs/app/docs/providers/page.mdx).

```sh
# upload
curl -X PUT --data-binary @report.pdf \
  -H 'Content-Type: application/pdf' \
  'http://localhost:3300/files?filename=report.pdf'
# → {"id":"XK5892","size":48213,"contentType":"application/pdf"}

# download
curl -o out.pdf http://localhost:3300/files/XK5892

# or let S3 serve it
curl http://localhost:3300/files/XK5892/url
```

## Worth noticing

- **`contentLength` is mandatory for a stream.** A single `PutObject` cannot use chunked encoding,
  so the size has to be known upfront. The route turns a missing `Content-Length` into a 411
  rather than letting the upload fail halfway.
- **Two ways to serve.** `GET /files/:id` proxies the bytes, which lets you enforce permissions on
  every read. `GET /files/:id/url` signs a short-lived URL and keeps the bytes off your server
  entirely.
