/** @type {import('next').NextConfig} */
const BACKEND_ORIGIN = 'https://coderoom.rg-dev.lat'

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",   // Next.js hydration requires inline scripts
  "style-src 'self' 'unsafe-inline'",    // Tailwind / CSS-in-JS
  `connect-src 'self' ${BACKEND_ORIGIN} wss://${new URL(BACKEND_ORIGIN).host}`,
  "img-src 'self' data:",                // avatars are data: URLs
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

const nextConfig = {
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ]
  },
}

export default nextConfig
