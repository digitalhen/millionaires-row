import type { MetadataRoute } from 'next';
import { getZipDirectory } from '@/lib/aggregates';
import { BOROUGH_CODES, boroSlug } from '@/lib/format';
import {
  SITEMAP_OWNER_LIMIT,
  SITEMAP_PROPERTY_LIMIT,
  getTopOwnerIds,
  getTopPropertyIds,
} from '@/lib/queries';
import {
  LEADERBOARDS_PATH,
  absoluteUrl,
  boroughPath,
  ownerPath,
  propertyPath,
  zipPath,
} from '@/lib/seo';

/**
 * The roll carries ~1M parcels and ~500k owners; submitting all of them is
 * pointless (and would blow past the 50k-URL/50MB per-file limits). The
 * sitemap lists the home page, the highest-value parcels and the largest
 * portfolios — everything else stays discoverable by crawling from those.
 *
 * Regenerated daily rather than per request: both queries are index-ordered
 * top-N scans, but they are still not something to run on every crawler hit.
 */
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteUrl('/'),
      lastModified,
      changeFrequency: 'daily',
      priority: 1,
    },
    // Aggregate pages: fixed URLs, so they need no query to be listed.
    {
      url: absoluteUrl(LEADERBOARDS_PATH),
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    ...BOROUGH_CODES.map((boro) => ({
      url: absoluteUrl(boroughPath(boroSlug(boro))),
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
  ];

  // A sitemap must never be the reason a build or a request fails: if the
  // database is unavailable (or mid-reload), serve the home page alone.
  const [parids, owners, zips] = await Promise.all([
    getTopPropertyIds(SITEMAP_PROPERTY_LIMIT).catch((err) => {
      console.error('[sitemap] property list unavailable', err);
      return [] as string[];
    }),
    getTopOwnerIds(SITEMAP_OWNER_LIMIT).catch((err) => {
      console.error('[sitemap] owner list unavailable', err);
      return [] as string[];
    }),
    // ~240 ZIPs, listed in full — small enough that no cap is needed.
    getZipDirectory()
      .then((d) => d.zips)
      .catch((err) => {
        console.error('[sitemap] ZIP list unavailable', err);
        return [] as string[];
      }),
  ]);

  for (const zip of zips) {
    entries.push({
      url: absoluteUrl(zipPath(zip)),
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    });
  }
  for (const parid of parids) {
    entries.push({
      url: absoluteUrl(propertyPath(parid)),
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.7,
    });
  }
  for (const ownerNorm of owners) {
    entries.push({
      url: absoluteUrl(ownerPath(ownerNorm)),
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.6,
    });
  }

  return entries;
}
