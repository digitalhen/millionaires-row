import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AboutNote from '@/components/AboutNote';
import BuildingUnits from '@/components/BuildingUnits';
import EligibleBadge, { NotOnRollNote } from '@/components/EligibleBadge';
import JsonLd from '@/components/JsonLd';
import MiniMap from '@/components/MiniMap';
import OwnerCounts from '@/components/OwnerCounts';
import PropertyTable from '@/components/PropertyTable';
import ShareButton from '@/components/ShareButton';
import TopBar from '@/components/TopBar';
import { getProperty, getPropertyCard } from '@/lib/queries';
import {
  SITE_NAME,
  absoluteUrl,
  boroughPath,
  decodeParam,
  ownerPath,
  propertyPath,
  zipPath,
} from '@/lib/seo';
import {
  BUILDING_SCALE_CAPTION,
  addressLabel,
  boroName,
  boroSlug,
  buildingClassLabel,
  formatBbl,
  isBuildingScaleRecord,
  isNycZip,
  money,
  num,
  recordScopeNote,
  shareSummary,
  taxClassLabel,
  tierOf,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ parid: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { parid } = await params;
  const p = await getPropertyCard(decodeParam(parid).trim());
  if (!p) {
    return { title: 'Record not found', robots: { index: false, follow: true } };
  }

  const label = addressLabel(p.address, p);
  const title = p.fmv != null ? `${label} — ${money(p.fmv)}` : label;
  const bldg = buildingClassLabel(p.bldg_class, p.parid);
  const description = [
    `${label}, ${boroName(p.boro)}.`,
    `Owner of record: ${p.owner_norm ? p.owner_display || p.owner : 'none on file'}.`,
    `DOF full market value ${money(p.fmv)}.`,
    `Tax class ${p.tax_class}${
      p.bldg_class ? `, building class ${p.bldg_class}${bldg ? ` (${bldg})` : ''}` : ''
    }.`,
    p.eligible
      ? "This parcel may be subject to NYC's non-primary residence surcharge."
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const url = absoluteUrl(propertyPath(p.parid));
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
    twitter: { card: 'summary_large_image', title: `${title} | ${SITE_NAME}`, description },
  };
}

function Cell({
  label,
  value,
  dim,
}: {
  label: string;
  value: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div className="cell">
      <span className="label">{label}</span>
      <span className={`value${dim ? ' dim' : ''}`}>{value}</span>
    </div>
  );
}

const DASH = <span style={{ color: 'var(--grey-2)' }}>—</span>;

export default async function PropertyPage({ params }: Params) {
  const { parid } = await params;
  const data = await getProperty(decodeParam(parid).trim());
  if (!data) notFound();

  const { property: p, owner, otherProperties, building } = data;
  const label = addressLabel(p.address, p);
  const bldgLabel = buildingClassLabel(p.bldg_class, p.parid);
  /** R9/R0 building rows only — a `-U` row is one apartment, never a house. */
  const buildingScale = isBuildingScaleRecord(p.bldg_class, p.parid);
  const scopeNote = recordScopeNote(p, building?.isBuildingRecord ?? false);
  const hasCoords = p.longitude != null && p.latitude != null;
  const houseRange =
    p.housenum_hi && p.housenum_hi !== p.housenum_lo
      ? `${p.housenum_lo ?? ''}–${p.housenum_hi}`
      : p.housenum_lo || null;

  const url = absoluteUrl(propertyPath(p.parid));
  /**
   * Structured data. A parcel is modelled as a `Place` (the roll covers houses,
   * condo units and co-op shares alike, so a more specific residence type would
   * be a guess) with the DOF valuation as a `PropertyValue` — it is an
   * assessment estimate, not an offer, so it is deliberately not an `Offer`.
   */
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Place',
    '@id': url,
    url,
    name: label,
    description: `${label}, ${boroName(p.boro)} — New York City Department of Finance 2027 supplemental property roll record.`,
    address: {
      '@type': 'PostalAddress',
      streetAddress: label,
      addressLocality: boroName(p.boro),
      addressRegion: 'NY',
      postalCode: p.zip_code || undefined,
      addressCountry: 'US',
    },
    geo: hasCoords
      ? {
          '@type': 'GeoCoordinates',
          latitude: p.latitude,
          longitude: p.longitude,
        }
      : undefined,
    identifier: [
      { '@type': 'PropertyValue', name: 'BBL', value: formatBbl(p.boro, p.block, p.lot) },
      { '@type': 'PropertyValue', name: 'PARID', value: p.parid },
    ],
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'DOF full market value',
        value: p.fmv ?? undefined,
        unitCode: 'USD',
        description: `New York City Department of Finance full market value estimate, tax year ${p.tax_year}`,
      },
      { '@type': 'PropertyValue', name: 'Tax class', value: p.tax_class },
      p.bldg_class
        ? {
            '@type': 'PropertyValue',
            name: 'Building class',
            value: p.bldg_class,
            description: bldgLabel ?? undefined,
          }
        : undefined,
      {
        '@type': 'PropertyValue',
        name: 'On the 2027 supplemental roll',
        value: p.on_supplemental,
      },
      {
        '@type': 'PropertyValue',
        name: "May be subject to NYC's non-primary residence surcharge",
        value: p.eligible,
      },
      // schema.org has no `owner` on Place, and the roll mixes people with
      // companies, so the owner of record travels as a plain value.
      owner
        ? {
            '@type': 'PropertyValue',
            name: 'Owner of record',
            value: owner.display_name,
            url: absoluteUrl(ownerPath(owner.owner_norm)),
          }
        : undefined,
    ].filter(Boolean),
  };

  return (
    <div className="page">
      <JsonLd data={jsonLd} />
      <TopBar crumb="Property" />

      <div className="detail-head">
        <div className="detail-title-row">
          <h1>{label}</h1>
          <ShareButton
            path={`/?p=${encodeURIComponent(p.parid)}`}
            title={label}
            text={shareSummary(p, owner?.property_count)}
          />
        </div>
        {/* Borough and ZIP double as links up to their aggregate pages. The
            ZIP only links when it is a real NYC ZIP — the roll also carries
            placeholders like '0' and the odd ZIP+4 string, which have no page. */}
        <p className="detail-sub">
          <Link href={boroughPath(boroSlug(p.boro))}>{boroName(p.boro)}</Link>
          {p.zip_code ? (
            <>
              {' · '}
              {isNycZip(p.zip_code) ? (
                <Link href={zipPath(p.zip_code)}>{p.zip_code}</Link>
              ) : (
                p.zip_code
              )}
            </>
          ) : null}
          {p.city_name ? ` · ${p.city_name}` : ''} · BBL{' '}
          {formatBbl(p.boro, p.block, p.lot)}
        </p>
        <p style={{ marginTop: 12 }}>
          {p.eligible ? (
            <EligibleBadge />
          ) : p.on_supplemental ? (
            <span className="crumb">
              On the supplemental roll · does not match the published surcharge
              criteria
            </span>
          ) : (
            <NotOnRollNote />
          )}
        </p>
        {/* What this record *is* — whole building, co-op aggregate, or co-op
            share. Said once, next to the address, before any reader gets to
            the figure. */}
        {scopeNote && (
          <p className="crumb" style={{ marginTop: 10, textTransform: 'none' }}>
            {scopeNote}
          </p>
        )}
      </div>

      <div className="fmv-block">
        <div>
          {/* A co-op's building record files one figure for the whole house.
              Left as a bare "full market value" it reads as an $11m apartment,
              so the aggregate is named in the headline, not further down. */}
          <span className="label">
            {building?.isBuildingRecord
              ? `Full market value — aggregate of ${num(building.recordUnitCount)} units`
              : 'Full market value'}
          </span>
          <div className="fmv">{money(p.fmv)}</div>
        </div>
        <span className="crumb">
          DOF estimate{buildingScale ? ` · ${BUILDING_SCALE_CAPTION}` : ''} · tax year{' '}
          {p.tax_year} · roll {p.source_file}
        </span>
      </div>

      {building && (
        <section className="section">
          <h2>In this building</h2>
          <BuildingUnits building={building} />
        </section>
      )}

      <section className="section">
        <h2>Classification</h2>
        <div className="grid">
          <Cell label="Tax class" value={p.tax_class} />
          <Cell label="Tax class meaning" value={taxClassLabel(p.tax_class)} dim />
          <Cell label="Building class" value={p.bldg_class || DASH} />
          <Cell label="Building type" value={bldgLabel ?? DASH} dim />
        </div>
      </section>

      <section className="section">
        <h2>Parcel identifiers</h2>
        <div className="grid">
          <Cell label="PARID" value={p.parid} />
          <Cell label="BBL" value={formatBbl(p.boro, p.block, p.lot)} />
          <Cell label="BBL (numeric)" value={String(p.bbl)} dim />
          <Cell label="Borough code" value={`${p.boro} · ${boroName(p.boro)}`} />
          <Cell label="Block" value={String(p.block)} />
          <Cell label="Lot" value={String(p.lot)} />
          <Cell label="Apartment" value={p.aptno || DASH} />
          <Cell label="Co-op number" value={p.coop_num || DASH} />
          <Cell label="Condo number" value={p.condo_number || DASH} />
          <Cell label="House number" value={houseRange || DASH} />
          <Cell label="Street" value={p.street_name || DASH} />
          <Cell label="ZIP code" value={p.zip_code || DASH} />
          <Cell label="Source roll" value={`${p.source_file} · ${p.tax_year}`} />
          <Cell
            label="Supplemental roll"
            value={p.on_supplemental ? 'Listed' : 'Not listed'}
            dim={!p.on_supplemental}
          />
        </div>
      </section>

      <section className="section">
        <h2>Owner of record</h2>
        <div className="owner-line">
          <span className="owner-name">
            {p.owner_norm ? p.owner : 'No owner on file'}
          </span>
          {owner && owner.property_count > 1 && (
            <Link href={`/owner/${encodeURIComponent(owner.owner_norm)}`} className="badge">
              ▣ {num(owner.property_count)} properties
            </Link>
          )}
        </div>
        {owner ? (
          <>
            <OwnerCounts owner={owner} />
            <div className="grid" style={{ marginTop: 14 }}>
              <Cell label="Normalized name" value={owner.owner_norm} dim />
              <Cell label="Combined full market value" value={money(owner.total_fmv)} />
            </div>
          </>
        ) : (
          <p className="crumb" style={{ marginTop: 10, textTransform: 'none' }}>
            The roll carries {p.owner ? `“${p.owner}”` : 'a blank'} here, which is a
            placeholder rather than a name — this parcel is not counted toward any
            owner.
          </p>
        )}
      </section>

      {owner && otherProperties.length > 0 && (
        <section className="section">
          <h2>
            Other properties held by {owner.display_name} —{' '}
            {owner.property_count - 1 > otherProperties.length
              ? `${num(otherProperties.length)} of ${num(owner.property_count - 1)}`
              : num(otherProperties.length)}
          </h2>
          <PropertyTable rows={otherProperties} />
          {owner.property_count - 1 > otherProperties.length && (
            <p className="crumb" style={{ marginTop: 10 }}>
              <Link href={`/owner/${encodeURIComponent(owner.owner_norm)}`}>
                See all {num(owner.property_count)} properties →
              </Link>
            </p>
          )}
        </section>
      )}

      <section className="section">
        <h2>Location</h2>
        {hasCoords ? (
          <>
            <div className="mini-map">
              <MiniMap
                longitude={p.longitude as number}
                latitude={p.latitude as number}
                fmv={p.fmv}
                parid={p.parid}
                tier={tierOf(p)}
              />
            </div>
            <p className="crumb" style={{ marginTop: 8 }}>
              {(p.latitude as number).toFixed(5)}, {(p.longitude as number).toFixed(5)}
            </p>
          </>
        ) : (
          <p className="crumb">No coordinate could be resolved for this parcel.</p>
        )}
      </section>

      <AboutNote />
    </div>
  );
}
