import type { Metadata } from 'next';
import HomeView from '@/components/HomeView';
import JsonLd from '@/components/JsonLd';
import { addressLabel, boroName, money } from '@/lib/format';
import { getPropertyCard, getStats } from '@/lib/queries';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  absoluteUrl,
  decodeParam,
  propertyPath,
} from '@/lib/seo';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HOME_METADATA: Metadata = {
  // `absolute` so the home page is not "Millionaires' Row | Millionaires' Row".
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: absoluteUrl('/') },
};

/**
 * Shared links land on the map with the parcel's panel open (`/?p=parid`), so
 * when a selection is in the URL the metadata — title, description and the
 * social card — must be the parcel's, not the site's. Canonical stays on
 * `/property/[parid]`, which serves the same record as a page.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}): Promise<Metadata> {
  const { p: selected } = await searchParams;
  if (!selected?.trim()) return HOME_METADATA;

  const p = await getPropertyCard(decodeParam(selected).trim()).catch(() => null);
  if (!p) return HOME_METADATA;

  const label = addressLabel(p.address, p);
  const title = p.fmv != null ? `${label} — ${money(p.fmv)}` : label;
  const description = [
    `${label}, ${boroName(p.boro)}.`,
    `Owner of record: ${p.owner_norm ? p.owner_display || p.owner : 'none on file'}.`,
    `DOF full market value ${money(p.fmv)}.`,
    p.eligible
      ? "This parcel may be subject to NYC's non-primary residence surcharge."
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  const ogImage = absoluteUrl(`${propertyPath(p.parid)}/opengraph-image`);

  return {
    title: { absolute: `${title} | ${SITE_NAME}` },
    description,
    alternates: { canonical: absoluteUrl(propertyPath(p.parid)) },
    openGraph: {
      type: 'website',
      url: absoluteUrl(`/?p=${encodeURIComponent(p.parid)}`),
      siteName: SITE_NAME,
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [ogImage],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
      images: [ogImage],
    },
  };
}

export default async function HomePage() {
  let stats: StatsResponse | null = null;
  try {
    stats = await getStats();
  } catch (err) {
    console.error('[home] stats unavailable', err);
  }

  const home = absoluteUrl('/');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${home}#website`,
        url: home,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'en-US',
        // Sitelinks search box: `?q=` pre-fills the search field on this page.
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: absoluteUrl('/?q={search_term_string}'),
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'Dataset',
        '@id': `${home}#dataset`,
        name: 'New York City DOF 2027 supplemental property roll',
        description:
          'The New York City Department of Finance 2027 supplemental property ' +
          'roll: parcels that may be subject to the non-primary-residence ' +
          '(pied-à-terre) surcharge, with owner of record, full market value ' +
          'estimate, tax class and building class. Coordinates joined from NYC PLUTO.',
        url: home,
        isAccessibleForFree: true,
        creator: {
          '@type': 'GovernmentOrganization',
          name: 'New York City Department of Finance',
          url: 'https://www.nyc.gov/site/finance/index.page',
        },
        spatialCoverage: { '@type': 'Place', name: 'New York City, NY, USA' },
        temporalCoverage: '2027',
        ...(stats
          ? {
              variableMeasured: [
                {
                  '@type': 'PropertyValue',
                  name: 'Parcels on the supplemental roll',
                  value: stats.supplementalCount,
                },
                {
                  '@type': 'PropertyValue',
                  name: 'Parcels that may be subject to the surcharge',
                  value: stats.eligibleCount,
                },
                {
                  '@type': 'PropertyValue',
                  name: 'Combined DOF full market value',
                  value: stats.totalFmv,
                  unitCode: 'USD',
                },
              ],
            }
          : {}),
      },
    ],
  };

  return (
    <>
      <JsonLd data={jsonLd} />
      <HomeView stats={stats} />
    </>
  );
}
