# Next.js App Router example

The [one file per identifier](https://github.com/AbderrahmaneMouzoune/bucketcode/tree/main/apps/docs)
flow, end to end: upload a file, get an id back, then read, replace and delete through that id.

| Route                   | Does                                                          |
| ----------------------- | ------------------------------------------------------------- |
| `POST /api/files`       | Stores the file under a fresh `nanoid(6)` and returns the id. |
| `GET /api/files/:id`    | Streams the file back with its original name, or 404.         |
| `PUT /api/files/:id`    | Replaces the file behind an existing id.                      |
| `DELETE /api/files/:id` | Removes it.                                                   |

## Run it

```sh
cp .env.example .env.local
pnpm install
pnpm dev
```

Then open http://localhost:3200.

`.env.example` points at a local MinIO, which is the quickest way to exercise the real code path:

```sh
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

Create the bucket once from the console at http://localhost:9001.

## Worth noticing

- **`lib/bucket.ts` builds the bucket lazily.** `createBucket()` validates its configuration
  eagerly, and `next build` imports route modules without the runtime environment being set.
- **`maxSize` is set below the platform limit** so an oversized upload answers 413 instead of
  being truncated by the runtime.
- **`PUT` checks the object exists first.** A six character id is guessable; without the check,
  anyone can write to any id.
- **`GET` streams rather than buffers**, and sets `Cache-Control: private, no-store` because the
  bucket is private.
