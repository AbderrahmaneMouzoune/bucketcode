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
    title: 'Core concepts',
    links: [
      { title: 'Snapshots', href: '/docs/snapshots' },
      { title: 'Sync codes', href: '/docs/sync-codes' },
      { title: 'Two devices, one snapshot', href: '/docs/two-devices' },
    ],
  },
  {
    title: 'Guides',
    links: [
      { title: 'Configuration', href: '/docs/configuration' },
      { title: 'S3-compatible providers', href: '/docs/providers' },
      { title: 'How big can a snapshot be', href: '/docs/limits' },
      { title: 'Errors', href: '/docs/errors' },
      { title: 'Testing', href: '/docs/testing' },
    ],
  },
  {
    title: 'Use cases',
    links: [
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
    ],
  },
  {
    title: 'Reference',
    links: [{ title: 'API', href: '/docs/api' }],
  },
]

export const allLinks: NavLink[] = navigation.flatMap((section) => section.links)
