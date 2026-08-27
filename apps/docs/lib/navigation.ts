export interface NavLink {
  title: string
  href: string
  description?: string
}

export interface NavSection {
  title: string
  links: NavLink[]
}

export const navigation: NavSection[] = [
  {
    title: 'Getting started',
    links: [
      { title: 'Introduction', href: '/docs' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Quick start', href: '/docs/quick-start' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { title: 'Configuration', href: '/docs/configuration' },
      { title: 'S3-compatible providers', href: '/docs/providers' },
      { title: 'Size limits and streams', href: '/docs/limits' },
      { title: 'Errors', href: '/docs/errors' },
      { title: 'Testing', href: '/docs/testing' },
    ],
  },
  {
    title: 'Use cases',
    links: [
      {
        title: 'One file per identifier',
        href: '/docs/use-cases/file-per-id',
        description: 'A row in your database holds XK5892, the bucket holds the file for it.',
      },
      {
        title: 'User avatars',
        href: '/docs/use-cases/user-avatars',
        description: 'Public bucket, CDN URL, one object per user, replaced on every change.',
      },
      {
        title: 'Private documents',
        href: '/docs/use-cases/private-documents',
        description: 'Invoices and contracts behind a permission check and a short-lived URL.',
      },
      {
        title: 'Generated exports',
        href: '/docs/use-cases/generated-exports',
        description: 'A CSV or PDF your server builds, uploaded from memory and handed back as a download.',
      },
    ],
  },
  {
    title: 'Reference',
    links: [{ title: 'API', href: '/docs/api' }],
  },
]

export const allLinks: NavLink[] = navigation.flatMap((section) => section.links)
