import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'bucketcode',
    template: '%s · bucketcode',
  },
  description:
    'Server-side S3 uploads without the ceremony. Upload, put, get, getUrl, delete — for AWS S3, Cloudflare R2, MinIO and any S3-compatible storage.',
}

const REPOSITORY = 'https://github.com/AbderrahmaneMouzoune/bucketcode'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <Link className="header-brand" href="/">
            bucketcode
          </Link>
          <nav className="header-nav">
            <Link href="/docs">Docs</Link>
            <Link href="/docs/use-cases/new-device">Use cases</Link>
            <Link href="/docs/api">API</Link>
            <a href={REPOSITORY}>GitHub</a>
          </nav>
        </header>

        {children}

        <footer className="footer">
          <div className="footer-inner">
            <span>MIT © Abderrahmane Mouzoune</span>
            <a href={`${REPOSITORY}/tree/main/examples`}>Examples</a>
          </div>
        </footer>
      </body>
    </html>
  )
}
