# Security policy

## Supported versions

bucketcode is pre-1.0. Security fixes land on the latest minor, and only there.

| Version | Supported |
| ------- | --------- |
| 0.1.x   | ✅        |
| < 0.1   | ❌        |

## Reporting a vulnerability

Report it privately through
[GitHub Security Advisories](https://github.com/AbderrahmaneMouzoune/bucketcode/security/advisories/new).
Please do not open a public issue.

Include what you can: the version, a reproduction, and what an attacker gets out of it. Expect an
acknowledgement within 72 hours and an assessment within a week. If the report is valid you will be
credited in the advisory unless you would rather not be.

## What bucketcode does and does not protect

Worth knowing before you file — and before you ship:

- **A sync code is a bearer token.** Anyone holding it can read the snapshot stored under it, and
  overwrite it. Eight Crockford base32 characters is 40 bits, which resists guessing only if the
  endpoint that accepts codes is rate-limited. It is your endpoint, so that is your rate limit to
  add. Treat a leaked code as a leaked password: nothing in the envelope re-authenticates the
  caller.
- **Give codes an expiry.** `putSnapshot(code, data, { expiresIn })` makes the window finite.
  `getSnapshot()` refuses an expired snapshot, but the object stays in the bucket until an S3
  lifecycle rule removes it — configure one.
- **Your server can read every snapshot it stores.** For anything sensitive, encrypt in the browser
  before handing the value over; see
  [End-to-end encrypted sync](./apps/docs/content/docs/use-cases/encrypted-sync.mdx).
- **Credentials stay server-side.** bucketcode is not built to run in a browser, and its bundle is
  not a client bundle. Do not import it into client code, and do not expose the S3 credentials it
  reads.
- **Keys are validated, not sanitized.** `assertValidKey()` rejects traversal, absolute paths,
  backslashes, empty segments and control characters rather than silently rewriting them. Pass user
  input through it by passing it to bucketcode — do not build object keys by hand.
- **Presigned URLs are unauthenticated once issued.** Anyone with the URL has the object until the
  URL expires. Keep `expiresIn` as short as the flow tolerates.

## Supply chain

Every release is published to npm from GitHub Actions with
[provenance](https://docs.npmjs.com/generating-provenance-statements), so the tarball can be traced
back to the commit and the workflow run that built it. Verify it with `npm audit signatures`.
