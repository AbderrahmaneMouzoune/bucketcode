import type { Metadata } from 'next'
import { RootProvider } from 'fumadocs-ui/provider/next'

import './global.css'

export const metadata: Metadata = {
  title: {
    default: 'bucketcode',
    template: '%s · bucketcode',
  },
  description:
    "Move a local-first app's data from one device to another, through your own bucket. Snapshots, sync codes, and a small server-side API.",
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  )
}
