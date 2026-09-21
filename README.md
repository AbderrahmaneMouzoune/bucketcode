# bucketcode → s3nd

> [!IMPORTANT]
> This repository has moved to **[AbderrahmaneMouzoune/s3nd](https://github.com/AbderrahmaneMouzoune/s3nd)**
> and is archived. It is kept read-only so existing links, clones and forks keep resolving;
> everything — the code, the full commit history, the open issues — carried over.

The project outgrew its name. `bucketcode` described the two things you could see, a bucket and a
code, but what the package does is move a local-first app's data from one device to another. The
packages were renamed to say so, and the repository followed.

| What                     | Where it is now                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| Source and history       | [AbderrahmaneMouzoune/s3nd](https://github.com/AbderrahmaneMouzoune/s3nd)                                 |
| Issues and pull requests | [s3nd/issues](https://github.com/AbderrahmaneMouzoune/s3nd/issues)                                        |
| Documentation            | [apps/docs](https://github.com/AbderrahmaneMouzoune/s3nd/tree/main/apps/docs)                             |
| The IndexedDB example    | [examples/indexeddb-sync](https://github.com/AbderrahmaneMouzoune/s3nd/tree/main/examples/indexeddb-sync) |

## If you depend on `bucketcode`

`bucketcode@0.1.0` stays on npm and keeps working — nothing was unpublished. It is deprecated
rather than removed, and it receives no further releases. New work happens on `s3nd`:

```sh
npm uninstall bucketcode
npm install s3nd
```

What the rename touched, and nothing else:

| `bucketcode@0.1.0`                     | `s3nd`                     |
| -------------------------------------- | -------------------------- |
| `import … from 'bucketcode'`           | `import … from 's3nd'`     |
| `BucketCodeError`, `isBucketCodeError` | `S3ndError`, `isS3ndError` |
| `BucketCodeErrorCode`                  | `S3ndErrorCode`            |

`createBucket`, `putSnapshot`, `getSnapshot`, `upload`, `put`, `get`, `getUrl`, `delete`, the
sync-code helpers and every exported type keep their names and their behaviour.

Three packages were split out of the original one, so a browser bundle no longer has to drag an S3
client along: [`@s3nd/protocol`](https://github.com/AbderrahmaneMouzoune/s3nd/tree/main/packages/protocol)
(the wire contract and sync codes), [`@s3nd/react`](https://github.com/AbderrahmaneMouzoune/s3nd/tree/main/packages/react)
(hooks) and [`@s3nd/cli`](https://github.com/AbderrahmaneMouzoune/s3nd/tree/main/packages/cli)
(the `s3nd` binary). Using `s3nd` alone requires none of them.

## Snapshots already in your bucket

They still read back. A snapshot written by `bucketcode@0.1.0` carries the marker under its old
name, and `s3nd` accepts it — a snapshot is data sitting in someone's bucket, not code they can
re-run, so the rename must not make one unreadable. Nothing to migrate, and no expiry on that
promise.

## License

MIT © Abderrahmane Mouzoune
