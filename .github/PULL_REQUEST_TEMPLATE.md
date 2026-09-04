<!--
The title of this pull request becomes the commit message on `main`, and
release-please reads it to decide the next version. It has to be a conventional
commit — CI checks its shape:

  feat: presign browser uploads          → minor
  fix(snapshots): honour expiresAt       → patch
  feat!: drop the callback form of getUrl → breaking
  docs: …, ci: …, chore: …               → no release
-->

## What this changes

<!-- One or two sentences. What was broken or missing, and what it does now. -->

## Why

<!-- The reasoning, or a link to the issue this closes. -->

## Checklist

- [ ] `pnpm test` passes
- [ ] `pnpm lint`, `pnpm type-check` and `pnpm format:check` pass
- [ ] New behaviour comes with tests
- [ ] Public API changes are reflected in `apps/docs` and in the package README
- [ ] The title is a conventional commit, and `feat`/`fix` is right for the change
