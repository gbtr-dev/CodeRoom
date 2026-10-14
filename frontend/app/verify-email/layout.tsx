import type { Metadata } from 'next'
import type React from 'react'

export const metadata: Metadata = {
  title: 'Confirm email',
  description: 'Confirm your email address for Coderoom.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}