import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AboutNote from '@/components/AboutNote';
import JsonLd from '@/components/JsonLd';
import OwnerCounts from '@/components/OwnerCounts';
import PropertyTable from '@/components/PropertyTable';
import TopBar from '@/components/TopBar';
import { getOwner, getOwnerCard } from '@/lib/queries';
import {
  SITE_NAME,
  absoluteUrl,
  decodeParam,
  ownerPath,
  propertyPath,
} from '@/lib/seo';
import { money, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ owner: string }> };

/** "12 properties on the NYC DOF 2027 supplemental roll", or the city-wide
 *  count with the supplemental subset once the schema carries both. */
function holdings(o: { property_count: number; roll_count?: number }): string {
  const base = `${num(o.property_count)} ${
    o.property_count === 1 ? 'property' : 'properties'
  }`;
  return o.roll_count != null && o.roll_count !== o.property_count
    ? `${base}, ${num(o.roll_count)} of them on the NYC DOF 2027 supplemental roll`
    : `${base} on the NYC DOF 2027 supplemental roll`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner } = await params;
  const o = await getOwnerCard(decodeParam(owner).trim());
  if (!o) {
    return { title: 'Record not found', robots: { index: false, follow: true } };
  }

  const title = `${o.display_name} — ${num(o.property_count)} ${
    o.property_count === 1 ? 'property' : 'properties'
  }, ${money(o.total_fmv)}`;
  const description = `${o.display_name} holds ${holdings(o)} — ${money(
    o.total_fmv,
  )} in combined DOF full market value. Every parcel with its address, borough and value.`;
  const url = absoluteUrl(ownerPath(o.owner_norm));

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

export default async function OwnerPage({ params }: Params) {
  const { owner: ownerParam } = await params;
  const data = await getOwner(decodeParam(ownerParam).trim());
  if (!data) notFound();

  const { owner, properties, truncated } = data;
  const avg = owner.property_count ? owner.total_fmv / owner.property_count : 0;

  const url = absoluteUrl(ownerPath(owner.owner_norm));
  /**
   * A portfolio is a list of parcels, not a Person or Organization — the roll's
   * owner strings are names as printed, and identical names may be different
   * parties, so the page is typed as a collection rather than as an entity.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name: `${owner.display_name} — properties on the NYC DOF 2027 supplemental roll`,
    description: `${owner.display_name} holds ${holdings(owner)} — ${money(
      owner.total_fmv,
    )} in combined DOF full market value.`,
    mainEntity: {
      '@type': 'ItemList',
      name: `Properties held by ${owner.display_name}`,
      numberOfItems: owner.property_count,
      itemListElement: properties.slice(0, 50).map((row, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(propertyPath(row.parid)),
        name: row.address,
      })),
    },
  };

  return (
    <div className="page">
      <JsonLd data={jsonLd} />
      <TopBar crumb="Owner" />

      <div className="detail-head">
        <h1>{owner.display_name}</h1>
        {/* The ▣ badge is how a *link* to this page is labelled elsewhere;
            here the full three-tier breakdown replaces it. */}
        <OwnerCounts owner={owner} />
      </div>

      <div className="fmv-block">
        <div>
          <span className="label">Combined full market value</span>
          <div className="fmv">{money(owner.total_fmv)}</div>
        </div>
        <span className="crumb">
          {num(owner.property_count)} parcels · average {money(Math.round(avg))}
        </span>
      </div>

      <section className="section">
        <h2>
          Properties{' '}
          {truncated
            ? `(showing ${num(properties.length)} of ${num(owner.property_count)}, highest value first)`
            : `(${num(properties.length)})`}
        </h2>
        <PropertyTable rows={properties} />
        {truncated && (
          <p className="crumb" style={{ marginTop: 10 }}>
            List capped at {num(properties.length)} rows.
          </p>
        )}
      </section>

      <section className="section">
        <h2>Matching</h2>
        <p className="crumb" style={{ textTransform: 'none', letterSpacing: 0 }}>
          Owners are grouped by the normalized owner string{' '}
          <span style={{ color: 'var(--fg)' }}>{owner.owner_norm}</span> exactly as
          printed on the roll. Different spellings of the same person or company are
          not merged, and identical names may belong to different parties.
        </p>
      </section>

      <AboutNote />
    </div>
  );
}
