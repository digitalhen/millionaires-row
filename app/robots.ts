import type { MetadataRoute } from 'next';
import { withBase } from '@/lib/basePath';
import { absoluteUrl } from '@/lib/seo';

/**
 * Everything public is crawlable. `/api/*` is excluded — the JSON endpoints
 * duplicate what the HTML pages already expose and the map/point routes are
 * expensive to serve to a crawler.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [withBase('/api/')],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/').replace(/\/$/, ''),
  };
}
