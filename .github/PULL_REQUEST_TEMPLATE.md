<!--
The title of this pull request becomes the commit message on `main`, and
release-please reads it to decide the next version of the packages you touched.
It has to be a conventional commit — CI checks its shape:

  feat: presign browser uploads           → minor
  fix(snapshots): honour expiresAt        → patch
  feat!: drop the callback form of getUrl → breaking
  docs: …, ci: …, chore: …                → no release
-->

## What this changes

<!-- One or two sentences. What was broken or missing, and what it does now. -->

## Why

<!-- The reasoning, or a link to the issue this closes. -->

## Packages touched

<!-- s3nd / @s3nd/protocol / @s3nd/react / @s3nd/cli — and whether it is a breaking change for any of them. -->

## Checklist

- [ ] `bun run test` passes
- [ ] `bun run lint`, `bun run lint:tests`, `bun run type-check` and `bun run format:check` pass
- [ ] `bun run check:exports` passes if a package's entry points changed
- [ ] New behaviour comes with tests
- [ ] Public API changes are reflected in `apps/docs` and in the package README
- [ ] The title is a conventional commit, and `feat`/`fix` is right for the change
