import Link from 'next/link'
import { codeToHtml } from 'shiki'

import { navigation } from '@/lib/navigation'

const SAMPLE = `import { nanoid } from 'nanoid'
import { createBucket } from 'bucketcode'

const bucket = createBucket({ bucket: 'my-bucket', prefix: 'files' })
const id = nanoid(6) // "XK5892"

await bucket.put(id, file)        // create
await bucket.put(id, newVersion)  // replace, same id

const stored = await bucket.get(id)
stored?.filename // "rapport.pdf"`

export default async function HomePage() {
  const highlighted = await codeToHtml(SAMPLE, {
    lang: 'ts',
    themes: { light: 'github-light', dark: 'github-dark' },
  })

  const useCases = navigation.find((section) => section.title === 'Use cases')?.links ?? []

  return (
    <>
      <section className="hero">
        <h1>Server-side S3 uploads, without the ceremony.</h1>
        <p>
          Five methods, all running on your server. Credentials never reach the browser, so there is no CORS to
          configure and nothing to sign client-side.
        </p>

        <div className="hero-actions">
          <Link className="button button-primary" href="/docs/quick-start">
            Quick start
          </Link>
          <Link className="button" href="/docs/api">
            API reference
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
