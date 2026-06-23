import type { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://coderoom.app'
  return [
    { url: siteUrl,                      lastModified: new Date(), changeFrequency: 'weekly',  priority: 1   },
    { url: `${siteUrl}/features`,        lastModified: new Date(), changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/docs`,            lastModified: new Date(), changeFrequency: 'monthly', priority: 0.7 },
    { url: `${siteUrl}/login`,           lastModified: new Date(), changeFrequency: 'yearly',  priority: 0.5 },
  ]
}
