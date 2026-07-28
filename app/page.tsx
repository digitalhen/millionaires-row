import type { Metadata } from 'next';
import HomeView from '@/components/HomeView';
import JsonLd from '@/components/JsonLd';
import { getStats } from '@/lib/queries';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  absoluteUrl,
} from '@/lib/seo';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // `absolute` so the home page is not "Millionaires' Row | Millionaires' Row".
  title: { absolute: `${SITE_NAME} — ${SITE_TAGLINE}` },
  description: SITE_DESCRIPTION,
  alternates: { canonical: absoluteUrl('/') },
};

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
