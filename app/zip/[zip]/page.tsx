import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AboutNote, { CoopValueNote } from '@/components/AboutNote';
import JsonLd from '@/components/JsonLd';
import OwnerRankTable, { localOwnerRows } from '@/components/OwnerRankTable';
import RankedPropertyTable from '@/components/RankedPropertyTable';
import StatGrid from '@/components/StatGrid';
import TopBar from '@/components/TopBar';
import type { ZipEntry } from '@/lib/aggregates';
import {
  AREA_OWNER_LIMIT,
  AREA_PROPERTY_LIMIT,
  getZipEntry,
  getZipStats,
  getZipTopOwners,
  getZipTopProperties,
} from '@/lib/aggregates';
import { boroName, boroSlug, money, num } from '@/lib/format';
import {
  LEADERBOARDS_PATH,
  SITE_NAME,
  absoluteUrl,
  boroughPath,
  decodeParam,
  zipPath,
} from '@/lib/seo';

/**
 * Rendered once per ZIP, then served from Next's route cache.
 *
 * The roll is read-only for the life of a deploy, so this page's HTML is the
 * same for every visitor until the next one — the figures behind it were
 * already memoised, but the ~100kB of table markup was being re-rendered per
 * request. The hour is arbitrary and generous; nothing under it changes.
 *
 * Both exports are needed, and the empty one is the load-bearing half.
 * `revalidate` alone is inert on a dynamic segment: with no
 * `generateStaticParams` at all, Next registers no fallback for the route, it
 * never reaches the prerender manifest, and every request re-renders (checked
 * against the manifest, not assumed). Declaring it *empty* registers the
 * fallback without naming a single path to build, which is what keeps
 * `next build` off the database — the Docker image is built with a dummy
 * DATABASE_URL, so anything listed here would be rendered against a database
 * that is not there.
 */
export const revalidate = 3600;

export function generateStaticParams(): { zip: string }[] {
  return [];
}

type Params = { params: Promise<{ zip: string }> };

/** Where the ZIP sits, spelled out — nine of them straddle a borough line. */
function placeOf(entry: ZipEntry): string {
  return entry.boros.map(boroName).join(' / ');
}

function describe(
  entry: ZipEntry,
  stats: { rollCount: number; eligibleCount: number; rollFmv: number; rollMedianFmv: number | null },
): string {
  return (
    `${num(stats.rollCount)} properties in ZIP code ${entry.zip} ` +
    `(${placeOf(entry)}, New York City) are on the Department of Finance's 2027 ` +
    `supplemental property roll, worth ${money(stats.rollFmv)} in combined DOF ` +
    `full market value (median ${money(stats.rollMedianFmv)}). ` +
    `${num(stats.eligibleCount)} of them match the criteria published for the ` +
    `non-primary-residence surcharge. Largest owners and most expensive parcels.`
  );
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { zip: raw } = await params;
  const zip = decodeParam(raw).trim();
  const entry = await getZipEntry(zip).catch((err) => {
    console.error('[zip] directory unavailable', err);
    return null;
  });
  if (!entry) {
    return { title: 'ZIP code not found', robots: { index: false, follow: true } };
  }

  const stats = await getZipStats(entry.zip).catch(() => null);
  const title = stats
    ? `ZIP ${entry.zip}, ${placeOf(entry)} — ${num(stats.rollCount)} properties on the 2027 roll`
    : `ZIP ${entry.zip}, ${placeOf(entry)}`;
  const description = stats
    ? describe(entry, stats)
    : `ZIP code ${entry.zip} in ${placeOf(entry)} on the New York City Department of Finance's 2027 supplemental property roll.`;
  const url = absoluteUrl(zipPath(entry.zip));

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

export default async function ZipPage({ params }: Params) {
  const { zip: raw } = await params;
  // The directory is the gate: a five-digit NYC ZIP that no parcel carries has
  // no page, so `/zip/10999` is a 404 rather than an empty table.
  const entry = await getZipEntry(decodeParam(raw).trim());
  if (!entry) notFound();

  const [stats, owners, properties] = await Promise.all([
    getZipStats(entry.zip),
    getZipTopOwners(entry.zip, entry.boros),
    getZipTopProperties(entry.zip, entry.boros),
  ]);
  if (!stats) notFound();

  const place = placeOf(entry);
  const url = absoluteUrl(zipPath(entry.zip));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': url,
    url,
    name: `ZIP code ${entry.zip}`,
    description: describe(entry, stats),
    address: {
      '@type': 'PostalAddress',
      addressLocality: boroName(entry.boro),
      addressRegion: 'NY',
      postalCode: entry.zip,
      addressCountry: 'US',
    },
    containedInPlace: {
      '@type': 'Place',
      name: boroName(entry.boro),
      url: absoluteUrl(boroughPath(boroSlug(entry.boro))),
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
      <TopBar crumb="ZIP code" />

      <div className="detail-head">
        <h1>ZIP {entry.zip}</h1>
        <p className="detail-sub">{place} · New York City</p>
        <nav className="jump" aria-label="Related">
          {entry.boros.map((b) => (
            <Link key={b} href={boroughPath(boroSlug(b))}>
              ← All of {boroName(b)}
            </Link>
          ))}
          <Link href={LEADERBOARDS_PATH}>Citywide leaderboards</Link>
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
        <h2>The roll in {entry.zip}</h2>
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
            { label: 'Borough', value: place, dim: true },
          ]}
        />
        <CoopValueNote />
      </section>

      <section className="section">
        <h2>
          Largest owners in {entry.zip} — top {num(AREA_OWNER_LIMIT)} by parcels on
          the roll
        </h2>
        <OwnerRankTable
          rows={localOwnerRows(owners)}
          rollLabel={`On roll in ${entry.zip}`}
          fmvLabel={`Value in ${entry.zip}`}
        />
        <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
          Counts cover this ZIP code only — an owner&rsquo;s page carries their
          full city-wide portfolio. Values are DOF estimates; co-op buildings and
          their units may both appear.
        </p>
      </section>

      <section className="section">
        <h2>
          Most expensive properties in {entry.zip} — top {num(AREA_PROPERTY_LIMIT)}{' '}
          on the roll
        </h2>
        <RankedPropertyTable rows={properties} showBorough={entry.boros.length > 1} />
      </section>

      <AboutNote />
    </div>
  );
}
