import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AboutNote from '@/components/AboutNote';
import PropertyTable from '@/components/PropertyTable';
import TopBar from '@/components/TopBar';
import { getOwner } from '@/lib/queries';
import { money, num } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ owner: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { owner } = await params;
  const data = await getOwner(decodeURIComponent(owner));
  if (!data) return { title: "Not found — Millionaires' Row" };
  return {
    title: `${data.owner.display_name} — Millionaires' Row`,
    description: `${data.owner.display_name} holds ${data.owner.property_count} properties on the NYC DOF 2027 supplemental roll, ${money(
      data.owner.total_fmv,
    )} in full market value.`,
  };
}

export default async function OwnerPage({ params }: Params) {
  const { owner: ownerParam } = await params;
  const data = await getOwner(decodeURIComponent(ownerParam).trim());
  if (!data) notFound();

  const { owner, properties, truncated } = data;
  const avg = owner.property_count ? owner.total_fmv / owner.property_count : 0;

  return (
    <div className="page">
      <TopBar crumb="Owner" />

      <div className="detail-head">
        <h1>{owner.display_name}</h1>
        <p className="detail-sub">
          {owner.property_count > 1 ? (
            <span className="badge">▣ {num(owner.property_count)} properties</span>
          ) : (
            <span>Single property</span>
          )}
        </p>
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
