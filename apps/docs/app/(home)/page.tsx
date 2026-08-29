import Link from 'next/link'
import { codeToHtml } from 'shiki'

import { repositoryUrl } from '@/lib/shared'

const SAMPLE = `import { createBucket, createSyncCode, normalizeSyncCode } from 'bucketcode'

const store = createBucket({ bucket: 'my-bucket', prefix: 'snapshots' })

// On the old device: hand the user a code.
const code = createSyncCode() // "K7QP2M4X"
await store.putSnapshot(code, state, { app: 'notes', version: 3, expiresIn: 3600 })

// On the new device: they type it in.
const snapshot = await store.getSnapshot(normalizeSyncCode(typed), { maxVersion: 3 })
snapshot?.data // → the state, ready to write back into IndexedDB`

const USE_CASES = [
  {
    title: 'Move to a new device',
    href: '/docs/use-cases/new-device',
    description: 'A code on the old phone, typed into the new one. The whole database follows.',
  },
  {
    title: 'Continuous backup',
    href: '/docs/use-cases/continuous-backup',
    description: 'One snapshot per account, rewritten as the local database changes.',
  },
  {
    title: 'End-to-end encrypted sync',
    href: '/docs/use-cases/encrypted-sync',
    description: 'Encrypt in the browser with a passphrase. Your server stores bytes it cannot read.',
  },
  {
    title: 'Attachments beside the data',
    href: '/docs/use-cases/attachments',
    description: 'The blobs an IndexedDB app holds, carried across with the records that point at them.',
  },
]

export default async function HomePage() {
  const highlighted = await codeToHtml(SAMPLE, {
    lang: 'ts',
    themes: { light: 'github-light', dark: 'github-dark' },
  })

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
        Your local-first app, on their other device.
      </h1>
      <p className="text-fd-muted-foreground mt-4 max-w-xl text-lg">
        IndexedDB never leaves the browser it was written in. bucketcode snapshots that state into a bucket you control,
        under a code the user carries across. Credentials stay on your server.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          className="bg-fd-primary text-fd-primary-foreground rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          href="/docs/quick-start"
        >
          Quick start
        </Link>
        <Link
          className="border-fd-border hover:bg-fd-accent rounded-lg border px-4 py-2 text-sm font-medium"
          href="/docs/snapshots"
        >
          How snapshots work
        </Link>
        <a
          className="border-fd-border hover:bg-fd-accent rounded-lg border px-4 py-2 text-sm font-medium"
          href={repositoryUrl}
        >
          GitHub
        </a>
      </div>

      <div
        className="border-fd-border bg-fd-card mt-12 overflow-x-auto rounded-xl border p-5 text-[13px] leading-relaxed"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {USE_CASES.map((useCase) => (
          <Link
            className="border-fd-border hover:border-fd-primary rounded-xl border p-5 transition-colors"
            href={useCase.href}
            key={useCase.href}
          >
            <div className="font-medium">{useCase.title}</div>
            <p className="text-fd-muted-foreground mt-1 text-sm">{useCase.description}</p>
          </Link>
        ))}
      </div>
    </main>
  )
}
