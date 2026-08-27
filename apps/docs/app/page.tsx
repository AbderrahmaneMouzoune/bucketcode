import Link from 'next/link'
import { codeToHtml } from 'shiki'

import { navigation } from '@/lib/navigation'

const SAMPLE = `import { createBucket, createSyncCode, normalizeSyncCode } from 'bucketcode'

const bucket = createBucket({ bucket: 'my-bucket', prefix: 'snapshots' })

// On the old device: hand the user a code.
const code = createSyncCode() // "K7QP2M4X"
await bucket.putSnapshot(code, state, { app: 'notes', version: 3, expiresIn: 3600 })

// On the new device: they type it in.
const snapshot = await bucket.getSnapshot(normalizeSyncCode(typed), { maxVersion: 3 })
snapshot?.data // → the state, ready to write back into IndexedDB`

export default async function HomePage() {
  const highlighted = await codeToHtml(SAMPLE, {
    lang: 'ts',
    themes: { light: 'github-light', dark: 'github-dark' },
  })

  const useCases = navigation.find((section) => section.title === 'Use cases')?.links ?? []

  return (
    <>
      <section className="hero">
        <h1>Your local-first app, on their other device.</h1>
        <p>
          IndexedDB never leaves the browser it was written in. bucketcode snapshots that state into a bucket you
          control, under a code the user carries across. Credentials stay on your server.
        </p>

        <div className="hero-actions">
          <Link className="button button-primary" href="/docs/quick-start">
            Quick start
          </Link>
          <Link className="button" href="/docs/snapshots">
            How snapshots work
          </Link>
          <a className="button" href="https://github.com/AbderrahmaneMouzoune/bucketcode">
            GitHub
          </a>
        </div>

        <div className="prose" dangerouslySetInnerHTML={{ __html: highlighted }} />
      </section>

      <section className="cards">
        {useCases.map((useCase) => (
          <Link className="card" href={useCase.href} key={useCase.href}>
            <div className="card-title">{useCase.title}</div>
            <p className="card-body">{useCase.description}</p>
          </Link>
        ))}
      </section>
    </>
  )
}
