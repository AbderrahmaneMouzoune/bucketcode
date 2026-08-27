# Node script example

The whole API in one file: create, read, replace, sign, delete. Useful as a smoke test when you
point bucketcode at a new bucket or a new provider.

```sh
cp .env.example .env
pnpm install
node --env-file=.env --import tsx src/round-trip.ts
```

Expected output:

```
created   XK5892 → round-trip/XK5892 (13 bytes)
read      first version | notes.txt | text/plain; charset=utf-8
replaced  second version, longer (22 bytes)
signed    http://localhost:9000/my-bucket/round-trip/XK5892?X-Amz-Algorithm=AWS4-HMAC-SHA256… …
deleted   gone
```

## Worth noticing

- **`put()` replaces in place.** The second write lands on the same key; there is no old object
  left behind.
- **`get()` returns `null` after the delete**, rather than throwing. That is what makes the last
  line a plain comparison.
- **`destroy()` in `finally`** releases the HTTP sockets so the script exits immediately instead
  of waiting for keep-alive timeouts.
