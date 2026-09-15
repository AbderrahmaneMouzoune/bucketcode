# @s3nd/react

React hooks for moving a local-first app's data between devices: send a snapshot or a file, read a
code back, and an input that repairs the code as the user types it.

```sh
npm install @s3nd/react
```

**It never sees a storage credential, and never pulls a storage client.** Its whole dependency tree
is `@s3nd/protocol` and `nanoid`, with React as a peer — the AWS SDK stays on your server,
where `s3nd` runs. That separation is the reason this is its own package.

React 18 or later. Every export is a client hook, and the build carries `'use client'`, so it drops
straight into the Next.js App Router.

## Setting it up

Point the provider at wherever you mounted
[the transfer routes](https://github.com/AbderrahmaneMouzoune/bucketcode/blob/main/apps/docs/content/docs/protocol.mdx):

```tsx
import { S3ndProvider } from '@s3nd/react'

export default function Providers({ children }) {
  return <S3ndProvider baseUrl="/api/transfers">{children}</S3ndProvider>
}
```

Pass `headers` for a token, or `client` to bring your own — which is also how you drive it in tests,
with no network at all.

## Sending

```tsx
import { useSendTransfer } from '@s3nd/react'

function MoveToAnotherDevice() {
  const { send, transfer, isPending, error } = useSendTransfer()

  return (
    <>
      <button onClick={async () => send(await exportDatabase(), { version: 3 })} disabled={isPending}>
        Move to another device
      </button>

      {transfer && <p>Type this on the other device: {transfer.code}</p>}
      {error && <p>{error.message}</p>}
    </>
  )
}
```

`sendFile` takes a `File` straight off an `<input type="file">`, keeping its name and type.

Failures land in `error` rather than rejecting — an event handler should not need a `try`/`catch`.
The call returns `null` when it failed, for callers that want to branch.

## Receiving

```tsx
import { useReceiveTransfer, useSyncCodeInput } from '@s3nd/react'

function RestoreFromCode() {
  const input = useSyncCodeInput()
  const { load, transfer, data, notFound, isPending } = useReceiveTransfer<DatabaseDump>()

  return (
    <>
      <input {...input.inputProps} placeholder="K7QP2M4X" />
      <button onClick={() => input.code && load(input.code)} disabled={!input.isComplete || isPending}>
        Look it up
      </button>

      {notFound && <p>Unknown or expired code.</p>}
      {transfer && (
        <>
          <p>
            From {transfer.device}, {new Date(transfer.createdAt).toLocaleString()}
          </p>
          <button onClick={() => importDatabase(data!)}>Replace my data</button>
        </>
      )}
    </>
  )
}
```

Loading and applying are deliberately separate: only your code knows its own object stores, and the
user should see what is about to replace their data before it does.

## The code input

`useSyncCodeInput` does the repair in the browser, before any request: separators dropped, case
folded, and `O`/`I`/`L` read as `0`/`1`/`1` where the alphabet makes that unambiguous.

```tsx
const { value, code, isComplete, error, inputProps } = useSyncCodeInput()
```

What the user typed stays in `value`, untouched — rewriting the field under the cursor is the one
thing that makes these inputs miserable. `code` is the canonical form to submit, `null` while what
is typed cannot be one. `inputProps` carries the keyboard and autofill hints a one-time code wants.

Pass the same shape your server configured:

```tsx
useSyncCodeInput({ length: 4, alphabet: '0123456789' }) // inputProps.inputMode becomes "numeric"
```

## What each hook gives back

| Hook                   |                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `useSendTransfer()`    | `send`, `sendFile`, `transfer`, `status`, `isPending`, `error`, `reset`                              |
| `useReceiveTransfer()` | `load`, `loadBytes`, `burn`, `transfer`, `data`, `notFound`, `status`, `isPending`, `error`, `reset` |
| `useSyncCodeInput()`   | `value`, `setValue`, `code`, `isComplete`, `error`, `reset`, `inputProps`                            |
| `useTransferClient()`  | the underlying client, for anything the hooks do not cover                                           |

`status` is `'idle' | 'pending' | 'success' | 'error'`.

Every call aborts the one before it, a late reply from a superseded call is dropped rather than
published, and nothing is written after unmount — so a user hammering a button does not end up with
whichever request happened to finish last.

## License

MIT © Abderrahmane Mouzoune
