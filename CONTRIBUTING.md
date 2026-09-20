# Contributing

Thanks for wanting to help. This document is what you need to get from a clone to a merged pull
request.

## Getting set up

You need [Bun](https://bun.sh) 1.2 or later (the repo pins 1.3.11) and [Node](https://nodejs.org)
20 or later. Bun installs and orchestrates; the toolchain itself — tsup, ESLint, vitest, Next —
still runs on Node, which is why you need both.

```sh
git clone https://github.com/AbderrahmaneMouzoune/bucketcode.git
cd bucketcode
bun install
bun run build
bun run test
```

That should be green before you change anything. If it is not, open an issue — that is a bug in
itself.

## The layout

A Bun workspace driven by [Turborepo](https://turbo.build).

| Path                | What it is                                                         |
| ------------------- | ------------------------------------------------------------------ |
| `packages/s3nd`     | The server-side package: bucket, snapshots, transfer handler.      |
| `packages/protocol` | The wire format, the client and sync codes. Runs in a browser too. |
| `packages/react`    | Hooks over the protocol client.                                    |
| `packages/cli`      | `s3nd doctor` and friends.                                         |
| `apps/docs`         | The documentation site.                                            |
| `examples/*`        | Runnable examples, consuming the packages from the workspace.      |

`protocol` is the dependency everything else builds on, so a change there is the one most likely to
ripple.

## The loop

```sh
bun run test                            # everything
cd packages/s3nd && bunx vitest          # one package, watching
bun run test:coverage

bun run lint
bun run lint:tests
bun run type-check
bun run format
```

Before pushing, run what CI runs:

```sh
bun run format:check && bun run lint && bun run lint:tests && bun run type-check && bun run build && bun run check:exports && bun run test
```

### Tests

The suites are offline and have no credentials in them. `packages/s3nd/src/test-helpers.ts` gives
you two stand-ins for S3, and you almost certainly want one of them rather than a new mock:

- `createStubClient()` — records the commands it is handed and replies with a canned response. Use
  it to assert on _what was sent to S3_.
- `createMemoryClient()` — a miniature S3 backed by a `Map`, honouring `IfMatch` and `IfNoneMatch`.
  Use it when a value has to genuinely round-trip, or when you are testing conditional writes.

New behaviour arrives with tests. Coverage thresholds are enforced per package in its
`vitest.config.ts`; a pull request that drops below them fails.

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

`bun run lint:tests` enforces what a linter can see of this — [oxlint](https://oxc.rs) with the
vitest rules in [`.oxlintrc.json`](./.oxlintrc.json): no `should` or `correctly`, lowercase `it`
titles, `it` rather than `test`, no duplicate titles, no `.only` or `.skip`, at most two levels of
`describe`, and every test carrying an assertion. It runs in CI.

### Changing a public API

Anything exported from a package's `src/index.ts` is public, and these packages are used in
production. When you add to one:

1. Export the option and result types too — a caller has to be able to name what they pass.
2. Document every new option with a TSDoc comment. The doc site and editor tooltips both read them.
3. Update `apps/docs` and the package README.
4. Run `bun run check:exports`. publint and are-the-types-wrong catch an entry point that resolves
   differently for CommonJS than for ESM — something a green build will not tell you.
5. Keep it additive. A breaking change needs `!` in the commit title and a note on what to do
   instead.

Errors are part of that API. Throw an `S3ndError` with a code from `S3ndErrorCode` — never a bare
`Error` — and say in the message what the caller should do differently.

## Commits and pull request titles

Pull requests are squash-merged, so **the pull request title becomes the commit on `main`** and
release-please reads it to decide the next version of each package you touched. CI rejects a title
that is not a [conventional commit](https://www.conventionalcommits.org):

```
feat: presign browser uploads
fix(snapshots): honour expiresAt on read
feat!: drop the callback form of getUrl
docs: explain the R2 checksum flag
```

`feat` releases a minor, `fix` a patch, `!` or a `BREAKING CHANGE:` footer a major once a package
reaches 1.0. Everything else (`docs`, `chore`, `ci`, `test`, `refactor`, `style`, `build`) ships
without a release. Pick the type that describes what a _user_ gets, not what you edited.

## Style

Prettier and ESLint decide formatting and lint; `bun run format` settles any argument. Beyond that:

- Comments explain _why_, not _what_. The existing source is the reference — match its density.
- Prefer a named helper over a clever expression.
- No `any` in `src`, outside test files. The ESLint config already carves out the test doubles.

## Reporting a security issue

Do not open a public issue — see [SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md).
