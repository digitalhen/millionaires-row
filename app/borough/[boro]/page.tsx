import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AboutNote, { CoopValueNote } from '@/components/AboutNote';
import JsonLd from '@/components/JsonLd';
import OwnerRankTable, { localOwnerRows } from '@/components/OwnerRankTable';
import RankedPropertyTable from '@/components/RankedPropertyTable';
import StatGrid from '@/components/StatGrid';
import TopBar from '@/components/TopBar';
import {
  AREA_OWNER_LIMIT,
  AREA_PROPERTY_LIMIT,
  getBoroughStats,
  getBoroughTopOwners,
  getBoroughTopProperties,
  getZipDirectory,
} from '@/lib/aggregates';
import { boroFromSlug, boroName, boroSlug, money, num } from '@/lib/format';
import {
  LEADERBOARDS_PATH,
  SITE_NAME,
  absoluteUrl,
  boroughPath,
  decodeParam,
  zipPath,
} from '@/lib/seo';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ boro: string }> };

/** manhattan | bronx | brooklyn | queens | staten-island, or a 404. */
function resolve(slug: string): number | null {
  return boroFromSlug(decodeParam(slug));
}

function describe(
  boro: number,
  stats: { rollCount: number; eligibleCount: number; rollFmv: number; rollMedianFmv: number | null },
): string {
  return (
    `${num(stats.rollCount)} ${boroName(boro)} properties are on the New York ` +
    `City Department of Finance's 2027 supplemental property roll, worth ` +
    `${money(stats.rollFmv)} in combined DOF full market value (median ` +
    `${money(stats.rollMedianFmv)}). ${num(stats.eligibleCount)} of them match ` +
    `the criteria published for the non-primary-residence surcharge. Largest ` +
    `owners, most expensive parcels and a ZIP-code breakdown.`
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { boro: slug } = await params;
  const boro = resolve(slug);
  if (boro == null) {
    return { title: 'Borough not found', robots: { index: false, follow: true } };
  }

  const stats = await getBoroughStats(boro).catch((err) => {
    console.error('[borough] metadata figures unavailable', err);
    return null;
  });
  const name = boroName(boro);
  const title = stats
    ? `${name} — ${num(stats.rollCount)} properties on the 2027 roll`
    : name;
  const description = stats
    ? describe(boro, stats)
    : `${name} on the New York City Department of Finance's 2027 supplemental property roll.`;
  const url = absoluteUrl(boroughPath(boroSlug(boro)));

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: `${title} | ${SITE_NAME}`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${SITE_NAME}`,
      description,
    },
  };
}

export default async function BoroughPage({ params }: Params) {
  const { boro: slug } = await params;
  const boro = resolve(slug);
  if (boro == null) notFound();

  const [stats, owners, properties, directory] = await Promise.all([
    getBoroughStats(boro),
    getBoroughTopOwners(boro),
    getBoroughTopProperties(boro),
    getZipDirectory(),
  ]);
  // A borough with no parcels is not a borough this dataset covers.
  if (!stats) notFound();

  const name = boroName(boro);
  const zips = directory.byBoro.get(boro) ?? [];
  const url = absoluteUrl(boroughPath(boroSlug(boro)));

  /**
   * A borough is a `Place` inside New York City. The roll figures travel as
   * `additionalProperty` for the same reason they do on a parcel page: they
   * are assessment counts and estimates, not an offer or a rating.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': url,
    url,
    name,
    description: describe(boro, stats),
    address: {
      '@type': 'PostalAddress',
      addressLocality: name,
      addressRegion: 'NY',
      addressCountry: 'US',
    },
    containedInPlace: {
      '@type': 'City',
      name: 'New York City',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'New York',
        addressRegion: 'NY',
        addressCountry: 'US',
      },
    },
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'Parcels on the FY27 city assessment roll',
        value: stats.allCount,
      },
      {
        '@type': 'PropertyValue',
        name: 'Parcels on the 2027 supplemental roll',
        value: stats.rollCount,
      },
      {
        '@type': 'PropertyValue',
        name: "Parcels that may be subject to NYC's non-primary residence surcharge",
        value: stats.eligibleCount,
      },
      {
        '@type': 'PropertyValue',
        name: 'Combined DOF full market value of supplemental-roll parcels',
        value: stats.rollFmv,
        unitCode: 'USD',
      },
      {
        '@type': 'PropertyValue',
        name: 'Median DOF full market value of supplemental-roll parcels',
        value: stats.rollMedianFmv ?? undefined,
        unitCode: 'USD',
      },
    ],
  };

  return (
    <div className="page">
      <JsonLd data={jsonLd} />
      <TopBar crumb="Borough" />

      <div className="detail-head">
        <h1>{name}</h1>
        <p className="detail-sub">
          New York City · Borough code {boro} · {num(zips.length)} ZIP codes
        </p>
        <nav className="jump" aria-label="Related">
          <Link href={LEADERBOARDS_PATH}>Citywide leaderboards</Link>
          <a href="#zips">ZIP codes</a>
        </nav>
      </div>

      <div className="fmv-block">
        <div>
          <span className="label">Supplemental roll — combined value</span>
          <div className="fmv">{money(stats.rollFmv)}</div>
        </div>
        <span className="crumb">
          {num(stats.rollCount)} parcels · median {money(stats.rollMedianFmv)}
        </span>
      </div>

      <section className="section">
        <h2>The roll in {name}</h2>
        <StatGrid
          stats={[
            { label: 'NYC properties (FY27 roll)', value: num(stats.allCount) },
            { label: 'On the supplemental roll', value: num(stats.rollCount) },
            {
              label: 'May be subject to surcharge',
              value: num(stats.eligibleCount),
              accent: stats.eligibleCount > 0,
            },
            { label: 'Combined value (on roll)', value: money(stats.rollFmv) },
            { label: 'Median value (on roll)', value: money(stats.rollMedianFmv) },
            { label: 'ZIP codes', value: num(zips.length), dim: true },
          ]}
        />
        <CoopValueNote />
      </section>

      <section className="section">
        <h2>
          Largest owners in {name} — top {num(AREA_OWNER_LIMIT)} by parcels on the
          roll
        </h2>
        <OwnerRankTable
          rows={localOwnerRows(owners)}
          rollLabel={`On roll in ${name}`}
          fmvLabel={`Value in ${name}`}
        />
        <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
          Counts cover {name} only — an owner&rsquo;s page carries their full
          city-wide portfolio. Values are DOF estimates; co-op buildings and their
          units may both appear.
        </p>
      </section>

      <section className="section">
        <h2>
          Most expensive properties in {name} — top {num(AREA_PROPERTY_LIMIT)} on
          the roll
        </h2>
        <RankedPropertyTable rows={properties} showBorough={false} />
      </section>

      <section className="section" id="zips">
        <h2>
          ZIP codes in {name} — {num(zips.length)}
        </h2>
        {zips.length ? (
          <div className="grid">
            {zips.map((z) => (
              <div className="cell zip-cell" key={z.zip}>
                <Link href={zipPath(z.zip)} className="zip-code">
                  {z.zip}
                </Link>
                <span className="zip-counts">
                  {num(z.rollCount)} of {num(z.allCount)} on roll
                  {z.eligibleCount > 0 && (
                    <span className="eligible">
                      {' '}
                      · {num(z.eligibleCount)} may be subject
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="crumb">No ZIP codes recorded.</p>
        )}
        <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
          Counts are the parcels each ZIP holds inside {name}; a handful of ZIP
          codes straddle a borough line and appear under both.
        </p>
      </section>

      <AboutNote />
    </div>
  );
}
