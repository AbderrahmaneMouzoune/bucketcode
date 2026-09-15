# @s3nd/protocol

The shared vocabulary of every s3nd piece: the wire contract between a server and its
clients, a client that speaks it, and the sync codes that travel over it.

```sh
npm install @s3nd/protocol
```

It holds one invariant — **nothing here imports a storage client**. That is what lets
[`@s3nd/react`](https://www.npmjs.com/package/@s3nd/react), the CLI and a browser bundle
share this code without any of them pulling the AWS SDK behind it. Its only dependency is
[nanoid](https://github.com/ai/nanoid).

Most applications do not install this directly: `s3nd` and `@s3nd/react` depend on it
and re-export what you need. Reach for it when you are writing a client for a runtime neither of
those covers, or implementing the protocol on a server that is not Node.

## The client

```ts
import { createTransferClient } from '@s3nd/protocol'

const transfers = createTransferClient({
  baseUrl: 'https://drop.example.com/api/transfers',
  headers: { authorization: `Bearer ${token}` },
})

const { code } = await transfers.createSnapshot({ data: state, version: 3 })
const incoming = await transfers.read(typed) // null when unknown or expired
const bytes = await transfers.readBytes(code) // for a file transfer
await transfers.remove(code)
```

`fetch` and nothing else, so it runs in a browser, a worker, React Native, Deno or Node without a
polyfill. Pass your own `fetch` to add retries, or to point it somewhere else in tests.

## The routes

All four are relative to wherever the server mounted them.

| Route            | What it does                                                                        |
| ---------------- | ----------------------------------------------------------------------------------- |
| `POST /`         | Creates a transfer, returns the code. JSON body is a snapshot, anything else a file |
| `GET /:code`     | Metadata, with the state inline for a snapshot                                      |
| `GET /:code/raw` | The bytes, or a `302` to a presigned URL                                            |
| `DELETE /:code`  | Burns the code                                                                      |

Every non-2xx answer carries `{ "error": { "code", "message" } }`, and the client turns it into a
`TransferError` with that `code` on it. Branch on the code, never on the message:

```ts
import { isTransferError } from '@s3nd/protocol'

if (isTransferError(error) && error.code === 'TOO_LARGE') {
  // ask the user to trim their database
}
```

`NOT_FOUND` deliberately covers an expired code as well as one that never existed: telling them
apart would let someone probe which codes have been used.

The [protocol documentation](https://github.com/AbderrahmaneMouzoune/bucketcode/blob/main/apps/docs/content/docs/protocol.mdx)
describes each route and every error code in full.

## Sync codes

A sync code belongs here rather than in `s3nd` because it _is_ part of the contract: its
alphabet, and the rules for reading back what someone typed, are what the two devices have to agree
on.

```ts
import { createSyncCodes, syncCodeAlphabets } from '@s3nd/protocol'

const codes = createSyncCodes()
codes.create() // "K7QP2M4X"
codes.normalize('k7-qp2m4x') // "K7QP2M4X"
codes.normalize('OIL5ABCD') // "0115ABCD" — O, I and L are not in the alphabet
codes.entropyBits // 40
```

The default is eight characters of [Crockford base32](https://www.crockford.com/base32.html): no
`I`, `L`, `O` or `U`, so a code survives being read aloud, written on paper, or typed on a phone.
`createSyncCodes()` pairs generation with normalization so the two can never disagree about the
alphabet.

Normalizing in the browser, before any request, is what makes the input forgiving — see
`useSyncCodeInput` in `@s3nd/react`.

## License

MIT © Abderrahmane Mouzoune
