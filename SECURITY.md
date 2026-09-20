# Security policy

## Supported versions

The s3nd packages are pre-1.0. Security fixes land on the latest minor, and only there.

| Package                | Supported |
| ---------------------- | --------- |
| `s3nd` 0.1.x           | ✅        |
| `@s3nd/protocol` 0.1.x | ✅        |
| `@s3nd/react` 0.1.x    | ✅        |
| `@s3nd/cli` 0.1.x      | ✅        |
| anything older         | ❌        |

## Reporting a vulnerability

Report it privately through
[GitHub Security Advisories](https://github.com/AbderrahmaneMouzoune/bucketcode/security/advisories/new).
Please do not open a public issue.

Include what you can: the package and version, a reproduction, and what an attacker gets out of it.
Expect an acknowledgement within 72 hours and an assessment within a week. If the report is valid
you will be credited in the advisory unless you would rather not be.

## What s3nd does and does not protect

Worth knowing before you file — and before you ship:

- **A sync code is a bearer token.** Anyone holding it can read the transfer stored under it, and
  overwrite it. Eight Crockford base32 characters is 40 bits, which resists guessing only if the
  endpoint that accepts codes is rate-limited. That endpoint is yours, so that rate limit is yours
  to add. Treat a leaked code as a leaked password: nothing in the envelope re-authenticates the
  caller.
- **Give transfers an expiry.** `expiresIn` makes the window finite. Reads refuse an expired
  transfer, but the object stays in the bucket until an S3 lifecycle rule removes it — configure
  one, and run `s3nd doctor` to check that you did.
- **Your server can read every snapshot it stores.** For anything sensitive, encrypt in the browser
  before handing the value over.
- **Credentials stay server-side.** `s3nd` is not built to run in a browser, and its bundle is not
  a client bundle. Do not import it into client code; `@s3nd/react` and `@s3nd/protocol` are the
  browser-side halves, and neither one sees an S3 credential.
- **Keys are validated, not sanitized.** `assertValidKey()` rejects traversal, absolute paths,
  backslashes, empty segments and control characters rather than silently rewriting them. Pass user
  input through the package — do not build object keys by hand.
- **Presigned URLs are unauthenticated once issued.** Anyone with the URL has the object until the
  URL expires. Keep `expiresIn` as short as the flow tolerates.
- **`authorize` is yours to implement.** The transfer handler calls it, and does not second-guess
  what it returns. An `authorize` that always resolves leaves the endpoint open to anyone who can
  guess a code.

## Supply chain

Every release is published to npm from GitHub Actions with
[provenance](https://docs.npmjs.com/generating-provenance-statements), so a tarball can be traced
back to the commit and the workflow run that built it. Verify it with `npm audit signatures`.
