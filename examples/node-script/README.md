# Node script example

A whole transfer in one file: write a snapshot under a code, read it back through a sloppily typed
version of that code, prove the conditional writes work, then burn it. Useful as a smoke test when
you point bucketcode at a new bucket or a new provider.

```sh
cp .env.example .env
pnpm install
node --env-file=.env --import tsx src/round-trip.ts
```

Expected output:

```
code      ZZWMBSTD
stored    1826 bytes gzipped, from 22991 raw (12.6x)
typed     "zzwm-bstd" → ZZWMBSTD
restored  200 notes from node-script, written 2026-08-27T14:29:20.442Z
identical true
claim     rejected as PRECONDITION_FAILED
ifMatch   rejected as PRECONDITION_FAILED
burned    gone
```

## Worth noticing

- **The compression ratio is the headline.** A realistic dump — many records that look alike — is
  the best case for gzip, and that ratio is what keeps a real database under your runtime's
  request limit.
- **The typed code is deliberately messy.** Lowercase, with a dash, exactly what a person produces.
  `store.codes.normalize()` is what makes it find the object.
- **Both conditional writes are exercised.** `ifAbsent` is how you claim a code without trampling
  one in use; `ifMatch` is how a second device finds out it lost the race instead of silently
  discarding the first one's work. If your S3-compatible provider does not implement conditional
  `PutObject`, these two lines are where you will find out.
- **`destroy()` in `finally`** releases the HTTP sockets so the script exits immediately instead of
  waiting for keep-alive timeouts.
