import type { Metadata } from 'next';
import AboutNote, { CoopValueNote } from '@/components/AboutNote';
import JsonLd from '@/components/JsonLd';
import OwnerRankTable, { cityOwnerRows } from '@/components/OwnerRankTable';
import RankedPropertyTable from '@/components/RankedPropertyTable';
import TopBar from '@/components/TopBar';
import {
  LEADERBOARD_ELIGIBLE_LIMIT,
  LEADERBOARD_OWNER_LIMIT,
  LEADERBOARD_PROPERTY_LIMIT,
  getLeaderboards,
} from '@/lib/aggregates';
import { money, num } from '@/lib/format';
import {
  LEADERBOARDS_PATH,
  SITE_NAME,
  absoluteUrl,
  ownerPath,
  propertyPath,
} from '@/lib/seo';

export const dynamic = 'force-dynamic';

const TITLE = 'Leaderboards';
const DESCRIPTION =
  'The largest portfolios and the highest DOF valuations on the New York City ' +
  '2027 supplemental property roll: the owners holding the most parcels, the ' +
  'owners holding the most value, the most expensive parcels in the city, and ' +
  'the most expensive parcels that may be subject to the non-primary-residence ' +
  'surcharge.';

const SECTIONS = [
  { id: 'owners-by-roll', label: 'Owners by count' },
  { id: 'owners-by-value', label: 'Owners by value' },
  { id: 'most-expensive', label: 'Most expensive' },
  { id: 'may-be-subject', label: 'May be subject' },
] as const;

export async function generateMetadata(): Promise<Metadata> {
  const url = absoluteUrl(LEADERBOARDS_PATH);
  // The figures sharpen the description but must never decide whether the page
  // has metadata at all — the boards are memoised, so this costs no round trip.
  let description = DESCRIPTION;
  try {
    const { byRollCount, topProperties } = await getLeaderboards();
    const owner = byRollCount[0];
    const top = topProperties[0];
    if (owner && top) {
      description =
        `${DESCRIPTION} Led by ${owner.display_name} with ` +
        `${num(owner.roll_count ?? owner.property_count)} parcels, and by ` +
        `${top.address} at ${money(top.fmv)}.`;
    }
  } catch (err) {
    console.error('[leaderboards] metadata figures unavailable', err);
  }

  return {
    title: TITLE,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: SITE_NAME,
      title: `${TITLE} | ${SITE_NAME}`,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${TITLE} | ${SITE_NAME}`,
      description,
    },
  };
}

export default async function LeaderboardsPage() {
  const { byRollCount, byValue, topProperties, topEligible } = await getLeaderboards();
  const url = absoluteUrl(LEADERBOARDS_PATH);

  /**
   * Four rankings on one page, so the structured data is a CollectionPage
   * holding four `ItemList`s — one per section, each pointing at the same
   * owner and property pages the tables link to.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: `${TITLE} — ${SITE_NAME}`,
    description: DESCRIPTION,
    hasPart: [
      {
        '@type': 'ItemList',
        name: 'Top owners by properties on the 2027 supplemental roll',
        numberOfItems: byRollCount.length,
        itemListElement: byRollCount.map((o, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl(ownerPath(o.owner_norm)),
          name: o.display_name,
        })),
      },
      {
        '@type': 'ItemList',
        name: 'Top owners by combined DOF full market value',
        numberOfItems: byValue.length,
        itemListElement: byValue.map((o, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl(ownerPath(o.owner_norm)),
          name: o.display_name,
        })),
      },
      {
        '@type': 'ItemList',
        name: 'Most expensive properties in New York City',
        numberOfItems: topProperties.length,
        itemListElement: topProperties.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl(propertyPath(p.parid)),
          name: p.address,
        })),
      },
      {
        '@type': 'ItemList',
        name: 'Most expensive properties that may be subject to the surcharge',
        numberOfItems: topEligible.length,
        itemListElement: topEligible.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          url: absoluteUrl(propertyPath(p.parid)),
          name: p.address,
        })),
      },
    ],
  };

  return (
    <div className="page">
      <JsonLd data={jsonLd} />
      <TopBar crumb="Leaderboards" />

      <div className="detail-head">
        <h1>Leaderboards</h1>
        <p className="detail-sub">
          The largest portfolios and the highest valuations on the roll
        </p>
        <p className="crumb" style={{ marginTop: 12, textTransform: 'none', letterSpacing: 0 }}>
          Three tiers run through every table below. Every parcel here is on the
          city&rsquo;s FY27 assessment roll; a{' '}
          <span style={{ color: 'var(--tier-city)' }}>□</span> marks one that is{' '}
          <em>not</em> on the DOF 2027 supplemental roll, and a{' '}
          <span style={{ color: 'var(--red)' }}>■</span> marks one matching the
          criteria DOF published for the non-primary-residence surcharge —
          broadly, class 1 homes over $5M and condo or co-op units at $1M and
          above. A red mark means <strong style={{ color: 'var(--grey-1)' }}>may be subject</strong>,
          never that tax is owed.
        </p>
        <nav className="jump" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      <section className="section" id="owners-by-roll">
        <h2>
          Top owners by properties on the roll — {num(byRollCount.length)} of{' '}
          {num(LEADERBOARD_OWNER_LIMIT)}
        </h2>
        <OwnerRankTable
          rows={cityOwnerRows(byRollCount)}
          rollLabel="On supplemental roll"
          fmvLabel="Combined value"
        />
        <CoopValueNote />
      </section>

      <section className="section" id="owners-by-value">
        <h2>Top owners by total value — top {num(LEADERBOARD_OWNER_LIMIT)}</h2>
        <OwnerRankTable
          rows={cityOwnerRows(byValue)}
          rollLabel="On supplemental roll"
          fmvLabel="Combined value"
        />
        <CoopValueNote />
      </section>

      <section className="section" id="most-expensive">
        <h2>
          Most expensive properties in New York City — top{' '}
          {num(LEADERBOARD_PROPERTY_LIMIT)}
        </h2>
        <RankedPropertyTable rows={topProperties} />
        <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
          Every parcel in the city, ranked by DOF full market value — including
          the office towers and commercial buildings the surcharge was never
          aimed at.
        </p>
      </section>

      <section className="section" id="may-be-subject">
        <h2>
          Most expensive properties that may be subject — top{' '}
          {num(LEADERBOARD_ELIGIBLE_LIMIT)}
        </h2>
        <RankedPropertyTable rows={topEligible} />
        <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
          Restricted to the <span style={{ color: 'var(--red)' }}>■</span> parcels matching
          DOF&rsquo;s published criteria. Primary-residence use generally exempts
          an owner, so these may be subject to the surcharge — not liable for it.
        </p>
      </section>

      <AboutNote />
    </div>
  );
}
