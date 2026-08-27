# bucketcode

Server-side S3 uploads, without the ceremony.

```ts
import { createBucket } from 'bucketcode'

const bucket = createBucket({ bucket: 'my-bucket', prefix: 'files' })

await bucket.put('XK5892', file) // create or replace
const stored = await bucket.get('XK5892') // → the file back, or null
await bucket.getUrl('XK5892') // → public or presigned URL
await bucket.delete('XK5892')
```

Every method runs a plain AWS SDK command from your server. Your credentials never reach the
browser, so there is no CORS policy to write on the bucket and nothing to sign client-side. Works
with AWS S3, Cloudflare R2, MinIO, Scaleway and any S3-compatible storage.

```sh
npm install bucketcode
```

**[Read the documentation →](./apps/docs)**

## This repository

A pnpm workspace monorepo, driven by Turborepo.

| Path                                                         | What it is                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| [`packages/bucketcode`](./packages/bucketcode)               | The published package.                                     |
| [`apps/docs`](./apps/docs)                                   | The documentation site — guides, use cases, API reference. |
| [`examples/nextjs-app-router`](./examples/nextjs-app-router) | Upload, read, replace and delete through one identifier.   |
| [`examples/express`](./examples/express)                     | A long-running server streaming request bodies to S3.      |
| [`examples/node-script`](./examples/node-script)             | The whole API in one file, as a smoke test.                |

## Working on it

```sh
pnpm install
pnpm build        # turbo build across the workspace
pnpm test         # the package's test suite
pnpm type-check
pnpm lint
pnpm format
```

Run the docs site locally with `pnpm --filter @bucketcode/docs dev` — it listens on
[localhost:3100](http://localhost:3100).

The test suite is offline: it injects a fake `S3Client`, so it needs no credentials and no
network. For an integration check against the real protocol, point an example at a local MinIO:

```sh
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

## Releasing

Publishing is driven by the version field, not by tags:

1. Bump `version` in `packages/bucketcode/package.json`.
2. Write the release notes in [`CHANGELOG.md`](./CHANGELOG.md), between the
   `<!-- release:start -->` and `<!-- release:end -->` markers.
3. Merge to `main`.

The [release workflow](./.github/workflows/release.yml) compares the local version to what is on
npm. When they differ it publishes with provenance and opens a GitHub release named after the
version, using the notes between those markers.

It expects an `NPM_TOKEN` repository secret with publish rights. If you would rather use npm
trusted publishing, configure this repository as a trusted publisher on npm and drop the
`NODE_AUTH_TOKEN` line from the workflow — the `id-token: write` permission it already grants is
what OIDC needs.

## License

MIT © Abderrahmane Mouzoune
