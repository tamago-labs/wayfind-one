export interface DocLink {
  href: string
  label: string
}

export interface DocSection {
  title: string
  links: DocLink[]
}

export const DOC_NAV: DocSection[] = [
  {
    title: 'Start',
    links: [
      { href: '/docs', label: 'Introduction' },
      { href: '/docs/quickstart', label: 'Quickstart' },
      { href: '/docs/cli', label: 'CLI reference' },
    ],
  },
  {
    title: 'Product',
    links: [
      { href: '/docs/p2p', label: 'Team store & P2P' },
      { href: '/docs/sandbox', label: 'Sandbox runner' },
      { href: '/docs/inference', label: 'Inference & attestation' },
      { href: '/docs/policy', label: 'Policy & approvals' },
      { href: '/docs/bots-tasks', label: 'Bots & tasks' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { href: '/docs/privacy', label: 'Privacy & threat model' },
      { href: '/docs/changelog', label: 'Changelog & roadmap' },
    ],
  },
]

export const DOC_ORDER: DocLink[] = DOC_NAV.flatMap((s) => s.links)

export function docNeighbors(pathname: string): { prev?: DocLink; next?: DocLink } {
  const i = DOC_ORDER.findIndex((l) => l.href === pathname)
  if (i === -1) return {}
  return {
    prev: i > 0 ? DOC_ORDER[i - 1] : undefined,
    next: i < DOC_ORDER.length - 1 ? DOC_ORDER[i + 1] : undefined,
  }
}
