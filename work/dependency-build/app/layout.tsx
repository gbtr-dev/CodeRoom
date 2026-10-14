import { Analytics } from '@vercel/analytics/next'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/auth-provider'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coderoom.app'

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Coderoom — Collaborative Code Editor',
    template: '%s | Coderoom',
  },
  description: 'Real-time collaborative code editing rooms. Share code, pair program, and build together — live.',
  keywords: ['collaborative code editor', 'real-time coding', 'code sharing', 'pair programming', 'online IDE', 'live coding'],
  authors: [{ name: 'Coderoom' }],
  openGraph: {
    type: 'website',
    siteName: 'Coderoom',
    title: 'Coderoom — Collaborative Code Editor',
    description: 'Real-time collaborative code editing rooms. Share code, pair program, and build together — live.',
    url: '/',
    images: [{ url: '/logo.png', width: 512, height: 512, alt: 'Coderoom' }],
  },
  twitter: {
    card: 'summary',
    title: 'Coderoom — Collaborative Code Editor',
    description: 'Real-time collaborative code editing rooms.',
    images: ['/logo.png'],
  },
  robots: { index: true, follow: true },
  icons: {
    icon: '/logo-icon.png',
    apple: '/logo-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      style={{ backgroundColor: '#0d0d0d' }}
    >
      <body className="font-sans antialiased">
        <AuthProvider>{children}</AuthProvider>
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
