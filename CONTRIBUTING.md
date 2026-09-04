# Contributing

Thanks for wanting to help. This document is what you need to get from a clone to a merged pull
request.

## Getting set up

You need [Node](https://nodejs.org) 20 or later (the repo pins 22 in `.node-version`) and
[pnpm](https://pnpm.io) 10.

```sh
git clone https://github.com/AbderrahmaneMouzoune/bucketcode.git
cd bucketcode
pnpm install
pnpm build
pnpm test
```

That should be green before you change anything. If it is not, open an issue — that is a bug in
itself.

## The layout

A pnpm workspace driven by [Turborepo](https://turbo.build).

| Path                  | What it is                                                    |
| --------------------- | ------------------------------------------------------------- |
| `packages/bucketcode` | The published package. This is what most changes touch.       |
| `apps/docs`           | The documentation site (Fumadocs + Next.js).                  |
| `examples/*`          | Runnable examples. They consume the package as `workspace:*`. |

## The loop

```sh
pnpm --filter bucketcode test:watch   # the fast loop
pnpm --filter bucketcode test         # once
pnpm --filter bucketcode test:coverage

pnpm lint
pnpm type-check
pnpm format
```

Before pushing, run what CI runs:

```sh
pnpm format:check && pnpm lint && pnpm type-check && pnpm build && pnpm --filter bucketcode test
```

### Tests

The suite is offline and has no credentials in it. `test/helpers.ts` gives you two stand-ins for
S3, and you almost certainly want one of them rather than a new mock:

- `createStubClient()` — records the commands it is handed and replies with a canned response. Use
  it to assert on _what was sent to S3_.
- `createMemoryClient()` — a miniature S3 backed by a `Map`, honouring `IfMatch` and `IfNoneMatch`.
  Use it when a value has to genuinely round-trip, or when you are testing conditional writes.

New behaviour arrives with tests. Coverage thresholds are enforced in
`packages/bucketcode/vitest.config.ts`; a pull request that drops below them fails.

### Naming a test

Tests sit next to the module they cover, as `<module>.test.ts`.

- One root `describe` per unit, named exactly as the export: `normalizeBody`, `Bucket.getUrl`,
  `createSyncCodes`. Two levels at most.
- Nest a `describe` only when three or more tests share a context. Otherwise the context goes
  inline in the title.
- An `it` states observable behaviour in the third person, with no `should`: `returns`, `throws`,
  `stores`. Put the condition inline with `when`.
- The title alone has to explain a CI failure, without opening the file. `throws INVALID_KEY when
the key is not a string` beats `rejects bad input`.

```ts
describe('Bucket.delete', () => {
  it('deletes one object when given a single key', async () => {})
  it('throws DELETE_FAILED naming the keys S3 reported as failed', async () => {})
})
```

`pnpm lint:tests` enforces what a linter can see of this — [oxlint](https://oxc.rs) with the vitest
rules in [`.oxlintrc.json`](./.oxlintrc.json): no `should` or `correctly`, lowercase `it` titles,
`it` rather than `test`, no duplicate titles, no `.only` or `.skip`, and at most two levels of
`describe`. It runs in CI.

For a check against the real S3 protocol rather than a stand-in, point an example at a local MinIO:

```sh
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

### Changing the public API

Anything exported from `packages/bucketcode/src/index.ts` is public, and this package is used in
production. When you add to it:

1. Export the option and result types too — a caller has to be able to name what they pass.
2. Document every new option with a TSDoc comment. The doc site and editor tooltips both read them.
3. Update `apps/docs/content/docs/api.mdx` and the package `README.md`.
4. Keep it additive. A breaking change needs `!` in the commit title and a note on what to do
   instead.

Errors are part of that API. Throw a `BucketCodeError` with a code from `BucketCodeErrorCode` —
never a bare `Error` — and say in the message what the caller should do differently. Add the code to
`errors.ts` and to `apps/docs/content/docs/errors.mdx` if it is a new one.

## Commits and pull request titles

Pull requests are squash-merged, so **the pull request title becomes the commit on `main`** and
release-please reads it to decide the next version. CI rejects a title that is not a
[conventional commit](https://www.conventionalcommits.org):

```
feat: presign browser uploads
fix(snapshots): honour expiresAt on read
feat!: drop the callback form of getUrl
docs: explain the R2 checksum flag
```

`feat` releases a minor, `fix` a patch, `!` or a `BREAKING CHANGE:` footer a major once the package
reaches 1.0. Everything else (`docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`) ships
without a release. Pick the type that describes what a _user_ gets, not what you edited.

Only commits touching `packages/bucketcode` trigger a release.

## Style

Prettier and ESLint decide formatting and lint; `pnpm format` settles any argument. Beyond that:

- Comments explain _why_, not _what_. The existing source is the reference — match its density.
- Prefer a named helper over a clever expression.
- No `any` in `src`. Tests may use it for SDK stand-ins; the ESLint config already allows that.

## Reporting a security issue

Do not open a public issue — see [SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
