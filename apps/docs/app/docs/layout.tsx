import type { ReactNode } from 'react'

import { Sidebar } from '@/components/sidebar'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <main className="content">
        <article className="prose">{children}</article>
      </main>
    </div>
  )
}
