import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import AboutNote from '@/components/AboutNote';
import MiniMap from '@/components/MiniMap';
import PropertyTable from '@/components/PropertyTable';
import TopBar from '@/components/TopBar';
import { getProperty } from '@/lib/queries';
import {
  boroName,
  buildingClassLabel,
  formatBbl,
  money,
  num,
  taxClassLabel,
} from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ parid: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { parid } = await params;
  const data = await getProperty(decodeURIComponent(parid));
  if (!data) return { title: "Not found — Millionaires' Row" };
  return {
    title: `${data.property.address}, ${boroName(data.property.boro)} — Millionaires' Row`,
    description: `${data.property.address} — DOF full market value ${money(
      data.property.fmv,
    )}. Owner: ${data.property.owner ?? 'not on file'}.`,
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
  const data = await getProperty(decodeURIComponent(parid).trim());
  if (!data) notFound();

  const { property: p, owner, otherProperties } = data;
  const bldgLabel = buildingClassLabel(p.bldg_class);
  const hasCoords = p.longitude != null && p.latitude != null;
  const houseRange =
    p.housenum_hi && p.housenum_hi !== p.housenum_lo
      ? `${p.housenum_lo ?? ''}–${p.housenum_hi}`
      : p.housenum_lo || null;

  return (
    <div className="page">
      <TopBar crumb="Property" />

      <div className="detail-head">
        <h1>{p.address}</h1>
        <p className="detail-sub">
          {boroName(p.boro)}
          {p.zip_code ? ` · ${p.zip_code}` : ''}
          {p.city_name ? ` · ${p.city_name}` : ''} · BBL {formatBbl(p.parid)}
        </p>
      </div>

      <div className="fmv-block">
        <div>
          <span className="label">Full market value</span>
          <div className="fmv">{money(p.fmv)}</div>
        </div>
        <span className="crumb">
          DOF estimate · tax year {p.tax_year} · roll {p.source_file}
        </span>
      </div>

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
          <Cell label="PARID / BBL" value={p.parid} />
          <Cell label="Formatted BBL" value={formatBbl(p.parid)} dim />
          <Cell label="Borough code" value={`${p.boro} · ${boroName(p.boro)}`} />
          <Cell label="Block" value={num(p.block)} />
          <Cell label="Lot" value={num(p.lot)} />
          <Cell label="Apartment" value={p.aptno || DASH} />
          <Cell label="Co-op number" value={p.coop_num || DASH} />
          <Cell label="Condo number" value={p.condo_number || DASH} />
          <Cell label="House number" value={houseRange || DASH} />
          <Cell label="Street" value={p.street_name || DASH} />
          <Cell label="ZIP code" value={p.zip_code || DASH} />
          <Cell label="Source roll" value={`${p.source_file} · ${p.tax_year}`} />
        </div>
      </section>

      <section className="section">
        <h2>Owner of record</h2>
        <div className="owner-line">
          <span className="owner-name">{p.owner || 'Name not on file'}</span>
          {owner && owner.property_count > 1 && (
            <Link href={`/owner/${encodeURIComponent(owner.owner_norm)}`} className="badge">
              ▣ {num(owner.property_count)} properties
            </Link>
          )}
        </div>
        {owner ? (
          <div className="grid" style={{ marginTop: 14 }}>
            <Cell label="Normalized name" value={owner.owner_norm} dim />
            <Cell label="Properties on this roll" value={num(owner.property_count)} />
            <Cell label="Combined full market value" value={money(owner.total_fmv)} />
          </div>
        ) : (
          <p className="crumb" style={{ marginTop: 10 }}>
            No usable owner name on this record — it is not counted toward any owner.
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
