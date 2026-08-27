'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { navigation } from '@/lib/navigation'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <nav className="sidebar" aria-label="Documentation">
      {navigation.map((section) => (
        <div className="sidebar-section" key={section.title}>
          <p className="sidebar-title">{section.title}</p>
          {section.links.map((link) => (
            <Link className="sidebar-link" data-active={pathname === link.href} href={link.href} key={link.href}>
              {link.title}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}
