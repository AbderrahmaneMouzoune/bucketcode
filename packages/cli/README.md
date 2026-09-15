# @s3nd/cli

Move a file between machines with a code, and check that a bucket is actually set up to hold
transfers.

```sh
npm install -g @s3nd/cli
s3nd doctor
```

Or without installing anything:

```sh
npx @s3nd/cli doctor
```

It is built on [`s3nd`](https://www.npmjs.com/package/s3nd) as a primitive, and has no
dependencies of its own beyond it: `node:util`'s `parseArgs` is the whole argument parser.

## `doctor`

The command worth running first. S3 misconfiguration fails late and vaguely — a policy that looks
right, credentials that resolve to nothing, a region the endpoint disagrees with. `doctor` performs
the operations s3nd actually needs and reports what happened, rather than reading your policy
and reasoning about it. The probe object is deleted before it returns.

```sh
$ s3nd doctor
✓ Configuration: bucket "transfers", region "eu-west-3"
✓ Credentials: resolved, key ends in 1234
✓ Bucket reachable: HeadBucket succeeded
✓ Write, read, delete: round-tripped a probe object
! Expiry cleanup: no enabled expiration rule
  → Add an S3 lifecycle rule that expires objects under this bucket after a day or
    two. Without it, expired transfers stay stored and billed.

1 check(s) failed.
```

That last check is the one that earns the command. `expiresIn` stops a transfer being _handed
over_; only a lifecycle rule deletes the object, and nothing surfaces the gap until a bill does.

Pointed at a server, `doctor` checks the only thing that matters there — a real round trip:

```sh
$ s3nd doctor --remote https://drop.example.com/api/transfers --token "$TOKEN"
✓ Server: https://drop.example.com/api/transfers answered
✓ Create, read, delete: round-tripped code 8WTXQC8R
```

It exits non-zero when a check fails, so it works as a deployment smoke test.

## `put`, `get`, `rm`

```sh
$ s3nd put ./report.pdf
report.pdf, 284 kB, expires 14/09/2026 10:25
K7QP2M4X
```

The code goes to stdout and everything else to stderr, so it composes:

```sh
CODE=$(s3nd put ./report.pdf)
```

On the other machine:

```sh
$ s3nd get K7QP2M4X
Wrote report.pdf (284 kB)

$ s3nd rm K7QP2M4X
Burned K7QP2M4X
```

`get` writes to the stored filename unless you pass `-o`; `-o -` sends the payload to stdout. A code
holding a snapshot rather than a file prints its JSON instead.

## Against your own server

Every command takes `--remote`, pointing it at a deployment of
[the transfer protocol](https://github.com/AbderrahmaneMouzoune/bucketcode/blob/main/apps/docs/content/docs/protocol.mdx)
instead of at S3:

```sh
s3nd --remote https://drop.example.com/api/transfers put ./report.pdf
```

This is not a second implementation. The CLI has exactly one — the protocol client — wired either to
`fetch` or, without `--remote`, straight into the request handler in the same process. The two modes
cannot drift apart, because there is only one of them.

The practical consequence: the machine you run this from needs a token for your own deployment
rather than S3 credentials.

## Options

| Option                | What it does                                                |
| --------------------- | ----------------------------------------------------------- |
| `--remote <url>`      | Talk to a s3nd server instead of S3 directly                |
| `--token <token>`     | Bearer token sent with `--remote`                           |
| `--bucket <name>`     | Bucket name, overriding `$S3ND_BUCKET`                      |
| `--prefix <prefix>`   | Key prefix inside the bucket                                |
| `--expires-in <secs>` | Transfer lifetime; `0` for one that does not expire         |
| `-o, --output <path>` | Where `get` writes. `-` is stdout                           |
| `--json`              | Machine-readable output, for scripts and for `doctor` in CI |

Configuration otherwise comes from the same environment variables as the library:
`S3ND_BUCKET`, `S3ND_REGION`, `S3ND_ENDPOINT`, and the usual AWS credentials.

## License

MIT © Abderrahmane Mouzoune
