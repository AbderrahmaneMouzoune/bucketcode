# bucketcode

Move a local-first app's data from one device to another, through your own bucket.

```ts
import { createBucket, createSyncCode, normalizeSyncCode } from 'bucketcode'

const bucket = createBucket({ bucket: 'my-bucket', prefix: 'snapshots' })

// On the old device: hand the user a code.
const code = createSyncCode() // "K7QP2M4X"
await bucket.putSnapshot(code, state, { app: 'notes', version: 3, expiresIn: 3600 })

// On the new device: they type it in.
const snapshot = await bucket.getSnapshot(normalizeSyncCode(typed), { maxVersion: 3 })
snapshot?.data // → the state, ready to write back into IndexedDB
```

Your app keeps everything in IndexedDB: fast, offline, private. Then the user opens it on their
phone and it is empty, because IndexedDB does not leave the browser it was written in. bucketcode
is the small server-side piece that closes that gap.

Credentials stay on your server — the browser only ever talks to your own API, so there is no CORS
policy to write on the bucket and nothing to sign client-side. Works with AWS S3, Cloudflare R2,
MinIO, Scaleway and any S3-compatible storage.

```sh
npm install bucketcode
```

**[Read the documentation →](./apps/docs)** · **[Run the IndexedDB example →](./examples/indexeddb-sync)**

## This repository

A pnpm workspace monorepo, driven by Turborepo.

| Path                                                   | What it is                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| [`packages/bucketcode`](./packages/bucketcode)         | The published package.                                       |
| [`apps/docs`](./apps/docs)                             | The documentation site — guides, use cases, API reference.   |
| [`examples/indexeddb-sync`](./examples/indexeddb-sync) | A notes app in IndexedDB, moved between devices with a code. |
| [`examples/node-script`](./examples/node-script)       | Snapshot round-trip, expiry and conflicts in one file.       |

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

The test suite is offline: it runs against an in-memory stand-in for S3 that honours the
conditional headers, so snapshots genuinely round-trip without credentials or network. For an
integration check against the real protocol, point an example at a local MinIO:

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
