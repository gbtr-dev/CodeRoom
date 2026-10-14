import type { Metadata } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'Docs',
  description: 'Coderoom technical documentation: stack, architecture, database schema, environment variables, and setup guide.',
  openGraph: {
    title: 'Docs | Coderoom',
    description: 'Coderoom technical documentation: stack, architecture, database schema, environment variables, and setup guide.',
    url: '/docs',
  },
  twitter: {
    card: 'summary',
    title: 'Docs | Coderoom',
    description: 'Coderoom technical documentation: stack, architecture, and setup guide.',
  },
}

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
