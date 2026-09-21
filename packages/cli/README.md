# @s3nd/cli

Move a file between machines with a code, check that a bucket is actually set up to hold
transfers, and keep the settings in a file instead of in your shell history.

```sh
npm install -g @s3nd/cli
s3nd init --provider r2 --bucket transfers
s3nd doctor
```

Or without installing anything:

```sh
npx @s3nd/cli doctor
```

It is built on [`s3nd`](https://www.npmjs.com/package/s3nd) as a primitive, and has no
dependencies of its own beyond it: `node:util`'s `parseArgs` is the whole argument parser.

## `init`

Writes a starting point for the provider you name, then says what is left to do:

```sh
$ s3nd init --provider r2 --bucket transfers
Wrote /home/you/transfers/s3nd.config.json

Put the three values in .env, and keep it out of git:
  R2_ACCOUNT_ID=…
  R2_ACCESS_KEY_ID=…
  R2_SECRET_ACCESS_KEY=…
The R2 API token needs Object Read & Write on this bucket, and nothing else.
Give the bucket a lifecycle rule that deletes objects under "transfers/" after a day or two.
Run `s3nd doctor` — it performs the operations s3nd needs and reports what happened.
```

`--provider` takes `aws`, `r2`, `minio`, `scaleway`, `wasabi` or `remote`.

## `doctor`

The command worth running first. S3 misconfiguration fails late and vaguely — a policy that looks
right, credentials that resolve to nothing, a region the endpoint disagrees with. `doctor` performs
the operations s3nd actually needs and reports what happened, rather than reading your policy
and reasoning about it. The probe object is deleted before it returns.

```sh
$ s3nd doctor
Using /home/you/transfers/s3nd.config.json
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
report.pdf · 284 kB · expires in 1 hour
K7QP2M4X
```

The code goes to stdout and everything else to stderr, so it composes:

```sh
CODE=$(s3nd put ./report.pdf)
```

`put -` reads stdin, which is how a directory travels:

```sh
tar cz ./project | s3nd put - --name project.tar.gz
```

On the other machine:

```sh
$ s3nd get K7QP2M4X
Wrote /home/you/report.pdf · 284 kB

$ s3nd rm K7QP2M4X
Burned K7QP2M4X
```

`get` writes to the stored filename unless you pass `-o`; `-o -` sends the payload to stdout. A code
holding a snapshot rather than a file prints its JSON instead.

## The configuration file

`s3nd.config.json`, `.s3ndrc.json` or `.s3ndrc`, looked for from the working directory upwards,
then `~/.config/s3nd/config.json`:

```json
{
  "bucket": "transfers",
  "region": "auto",
  "endpoint": "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
  "prefix": "transfers",
  "expiresIn": "24h",
  "envFile": ".env",
  "credentials": {
    "accessKeyId": "${R2_ACCESS_KEY_ID}",
    "secretAccessKey": "${R2_SECRET_ACCESS_KEY}"
  }
}
```

`${VAR}` is read from the environment and `envFile` names a file to load first — without
overwriting what the shell already set. So the configuration is committable and the keys are not.

Profiles hold several setups in one file:

```json
{
  "profiles": {
    "prod": { "remote": "https://drop.example.com/api/transfers", "token": "${S3ND_TOKEN}" },
    "local": { "bucket": "transfers", "endpoint": "http://localhost:9000" }
  }
}
```

```sh
s3nd -p local doctor
s3nd -p prod put ./report.pdf
```

A flag beats an environment variable, which beats the file. `s3nd config` prints which won:

```sh
$ s3nd config
file         /home/you/transfers/s3nd.config.json (profile "r2")
profiles     r2, local
mode         straight to S3

bucket       transfers                                 $S3ND_BUCKET
region       auto                                      s3nd.config.json (r2)
endpoint     https://8c4….r2.cloudflarestorage.com     s3nd.config.json (r2)
prefix       drops                                     --prefix
credentials  …1a2b                                     s3nd.config.json (r2)
expires in   1 day                                     s3nd.config.json (r2)
```

It masks the access key id and never prints the secret or the token.

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

| Option                 | What it does                                                |
| ---------------------- | ----------------------------------------------------------- |
| `-c, --config <path>`  | Configuration file to read                                  |
| `-p, --profile <name>` | Profile to use inside it                                    |
| `--env-file <path>`    | Read `KEY=value` pairs from this file first                 |
| `--bucket <name>`      | Bucket name                                                 |
| `--prefix <prefix>`    | Key prefix inside the bucket                                |
| `--region <name>`      | Region                                                      |
| `--endpoint <url>`     | S3-compatible endpoint                                      |
| `--expires-in <d>`     | Transfer lifetime: `3600`, `30m`, `24h`, `7d`, or `never`   |
| `--remote <url>`       | Talk to a s3nd server instead of S3 directly                |
| `--token <token>`      | Bearer token sent with `--remote`                           |
| `--name <filename>`    | Filename to store the transfer under                        |
| `-o, --output <path>`  | Where `get` writes. `-` is stdout                           |
| `--json`               | Machine-readable output, for scripts and for `doctor` in CI |
| `--provider <name>`    | Which starter `init` writes                                 |
| `--force`              | Let `init` overwrite an existing file                       |

Configuration otherwise comes from the same environment variables as the library:
`S3ND_BUCKET`, `S3ND_REGION`, `S3ND_ENDPOINT`, `S3ND_PREFIX`, `S3ND_PUBLIC_URL`,
`S3ND_EXPIRES_IN`, `S3ND_REMOTE`, `S3ND_TOKEN`, and the usual AWS credentials.

## License

MIT © Abderrahmane Mouzoune
