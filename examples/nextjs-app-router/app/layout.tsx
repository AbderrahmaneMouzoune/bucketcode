import type { ReactNode } from 'react'

export const metadata = {
  title: 'bucketcode · Next.js example',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          maxWidth: '38rem',
          margin: '4rem auto',
          padding: '0 1.5rem',
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  )
}
