/** @type {import('next').NextConfig} */
const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_BACKEND_URL
  ? new URL(process.env.NEXT_PUBLIC_BACKEND_URL).origin
  : 'https://coderoom.rg-dev.lat'

const backendHost = new URL(BACKEND_ORIGIN).host
const wsScheme = BACKEND_ORIGIN.startsWith('https') ? 'wss' : 'ws'
const isDevelopment = process.env.NODE_ENV === 'development'

const csp = [
  "default-src 'self'",
  // React's development debugging needs eval; keep it disabled in production.
  `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",    // Tailwind / CSS-in-JS
  `connect-src 'self' ${BACKEND_ORIGIN} ${wsScheme}://${backendHost}`,
  "img-src 'self' data:",                // avatars are data: URLs
  "font-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ')

const nextConfig = {
  devIndicators: false,
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
