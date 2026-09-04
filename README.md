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

Releases are driven by [release-please](https://github.com/googleapis/release-please) and by the
commit messages that land on `main`, which follow
[Conventional Commits](https://www.conventionalcommits.org/). Pull requests are squash-merged, so
the pull request title is the message that counts — CI checks its shape on every pull request.

| A commit on `main`                         | Takes 0.1.0 to                         |
| ------------------------------------------ | -------------------------------------- |
| `fix: …`                                   | 0.1.1                                  |
| `feat: …`                                  | 0.2.0                                  |
| `feat!: …`, or a `BREAKING CHANGE:` footer | 0.2.0 — the major bump waits for 1.0.0 |
| `chore: …`, `ci: …`, `docs: …`, `test: …`  | nowhere, no release                    |

Only commits touching `packages/bucketcode` release it; the docs site, the examples and the
workflows do not.

While there is something to release, the [release workflow](./.github/workflows/release.yml) keeps
a `chore: release x.y.z` pull request open, carrying the version bump and the entry it would add to
[the changelog](./packages/bucketcode/CHANGELOG.md). Merging it is the release: the commit is
tagged `vx.y.z`, the GitHub release is created from that changelog entry, and the package is
published to npm with provenance.

[`release-please-config.json`](./release-please-config.json) holds the settings;
[`.release-please-manifest.json`](./.release-please-manifest.json) holds the last released version
and is rewritten by release-please, so leave it alone.

Two repository secrets:

- `NPM_TOKEN`, with publish rights. If you would rather use npm trusted publishing, configure this
  repository as a trusted publisher on npm and drop the `NODE_AUTH_TOKEN` line from the workflow —
  the `id-token: write` permission it already grants is what OIDC needs.
- `RELEASE_PLEASE_TOKEN`, optional: a personal access token with `contents` and `pull-requests`
  write access. GitHub skips workflows on pull requests opened with the default `GITHUB_TOKEN`, so
  without it the release pull request shows no checks.

Running the workflow by hand with **Publish** ticked publishes the version currently on `main` —
the way out when a release was tagged but the publish step failed.

## License

MIT © Abderrahmane Mouzoune
