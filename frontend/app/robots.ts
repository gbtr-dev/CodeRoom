import type { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coderoom.app'
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/features', '/docs', '/login'],
        disallow: ['/rooms', '/room/', '/settings', '/invite/'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
