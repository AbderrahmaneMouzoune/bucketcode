# IndexedDB sync example

A notes app that keeps everything in IndexedDB, and moves it to another device with a code.

Open it in two different browsers to see the point: the second one is empty, because IndexedDB is
scoped to one origin in one browser profile on one device. Prepare a transfer in the first, type
the code into the second, and the database follows.

| Route                    | Does                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `POST /api/sync`         | Snapshots the posted database under a fresh code and returns it.  |
| `GET /api/sync/:code`    | The database behind a code, or 404 when it is unknown or expired. |
| `DELETE /api/sync/:code` | Burns the code once the transfer worked.                          |

## Run it

```sh
cp .env.example .env.local
pnpm install
pnpm dev
```

Then open http://localhost:3200 in two different browsers — two profiles, or one normal window and
one private window. Two tabs of the same browser share the same IndexedDB, so they will not show
you anything.

`.env.example` points at a local MinIO, which is the quickest way to exercise the real code path:

```sh
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  quay.io/minio/minio server /data --console-address ":9001"
```

Create the bucket once from the console at http://localhost:9001.

## What is where

| File             |                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------- |
| `lib/db.ts`      | The IndexedDB store, and the `exportDatabase` / `importDatabase` pair a transfer needs. |
| `lib/sync.ts`    | The browser half: post the dump, look a code up, apply it.                              |
| `lib/store.ts`   | The bucket, built lazily, with `maxSize` under the platform limit.                      |
| `app/api/sync/…` | The two routes. Around forty lines, most of it error mapping.                           |

`lib/db.ts` is deliberately application code. Only your app knows its own object stores, which is
why bucketcode does not try to dump IndexedDB generically — a generic dumper would be wrong for
most schemas and subtly wrong for the rest.

## Worth noticing

- **The code is shown grouped in fours**, because someone has to read it off one screen and type
  it into another. `store.codes.normalize()` on the server accepts it with or without the spaces,
  in any case, and folds `O` to zero and `I`/`L` to one. Change `syncCode` in `lib/store.ts` — to
  four digits, say — and both halves follow.
- **Nothing is imported before the user confirms.** Looking a code up fetches the snapshot and
  shows what it holds — how many notes, from which device, saved when — and only then offers to
  replace what is there. The most common mistake is restoring onto the device that already had the
  data.
- **`ifAbsent: true` on write.** A generated code landing on one already in use is unlikely, but
  overwriting a stranger's transfer is bad enough to be worth one header.
- **`expiresIn` is an hour.** A transfer code is a bearer token; a short life is most of its
  security. The `DELETE` after a successful import is the tidy path, the expiry is the backstop.
- **`importDatabase` runs in a single transaction.** Clear and repopulate every store at once, so
  a failure halfway leaves the previous contents intact instead of half of each.
- **The schema version travels with the snapshot.** A snapshot from a newer build of the app makes
  the read fail with a clear message rather than landing in a version that would misread it.

## What it does not do

There is no merge. Restoring replaces the receiving device's database — the right model for
carrying data to a new phone, the wrong one for two devices editing at once. For that, see
[continuous backup](../../apps/docs/app/docs/use-cases/continuous-backup/page.mdx) and
[two devices, one snapshot](../../apps/docs/app/docs/two-devices/page.mdx).

Attachments are out of scope here too: this store holds text. Blobs belong beside the snapshot
rather than inside it — see
[attachments beside the data](../../apps/docs/app/docs/use-cases/attachments/page.mdx).
