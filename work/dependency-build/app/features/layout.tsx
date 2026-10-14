import type { Metadata } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'Features',
  description: 'Explore Coderoom: real-time collaboration, live chat, syntax highlighting, file trees, and more — all in the browser.',
  openGraph: {
    title: 'Features | Coderoom',
    description: 'Explore Coderoom: real-time collaboration, live chat, syntax highlighting, file trees, and more — all in the browser.',
    url: '/features',
  },
  twitter: {
    card: 'summary',
    title: 'Features | Coderoom',
    description: 'Explore Coderoom: real-time collaboration, live chat, syntax highlighting, file trees, and more.',
  },
}

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
