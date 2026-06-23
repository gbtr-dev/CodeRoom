import type { Metadata } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'Login',
  description: 'Sign in to Coderoom and start collaborating on code in real time.',
  openGraph: {
    title: 'Login | Coderoom',
    description: 'Sign in to Coderoom and start collaborating on code in real time.',
    url: '/login',
  },
  robots: { index: true, follow: true },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
