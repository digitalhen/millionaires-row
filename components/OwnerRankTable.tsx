import Link from 'next/link';
import type { LocalOwner } from '@/lib/aggregates';
import { money, num } from '@/lib/format';
import { ownerPath } from '@/lib/seo';
import type { OwnerSummary } from '@/lib/types';

/**
 * One row of a ranked owner table, flattened by the caller so the same
 * component serves both a city-wide ranking (counts over every holding) and a
 * borough or ZIP ranking (counts over that area only).
 */
export type OwnerRankRow = {
  owner_norm: string;
  display_name: string;
  /** parcels on the supplemental roll, within whatever scope the table covers */
  rollCount: number;
  /** of those, how many match DOF's surcharge criteria */
  eligibleCount: number;
  /** summed DOF full market value over the same scope */
  fmv: number;
  /** every parcel held city-wide — omitted on the area-scoped tables */
  propertyCount?: number;
};

/** City-wide ranking: the counts are every holding the owner has anywhere. */
export function cityOwnerRows(owners: OwnerSummary[]): OwnerRankRow[] {
  return owners.map((o) => ({
    owner_norm: o.owner_norm,
    display_name: o.display_name,
    rollCount: o.roll_count ?? o.property_count,
    eligibleCount: o.eligible_count ?? 0,
    fmv: o.total_fmv,
    propertyCount: o.property_count,
  }));
}

/** Borough / ZIP ranking: the counts cover that area only. */
export function localOwnerRows(owners: LocalOwner[]): OwnerRankRow[] {
  return owners.map((o) => ({
    owner_norm: o.owner_norm,
    display_name: o.display_name,
    rollCount: o.roll_count,
    eligibleCount: o.eligible_count,
    fmv: o.roll_fmv,
  }));
}

export default function OwnerRankTable({
  rows,
  rollLabel = 'On roll',
  fmvLabel = 'Full market value',
}: {
  rows: OwnerRankRow[];
  rollLabel?: string;
  fmvLabel?: string;
}) {
  if (!rows.length) return <p className="crumb">No owners.</p>;
  const showTotal = rows.some((r) => r.propertyCount != null);
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Owner of record</th>
            {showTotal && <th className="num">Properties</th>}
            <th className="num">{rollLabel}</th>
            <th className="num">May be subject</th>
            <th className="num">{fmvLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.owner_norm}>
              <td className="rank">{num(i + 1)}</td>
              <td>
                <Link href={ownerPath(r.owner_norm)}>{r.display_name}</Link>
              </td>
              {showTotal && <td className="num">{num(r.propertyCount ?? 0)}</td>}
              <td className="num">{num(r.rollCount)}</td>
              {/* The one red column, and only when there is something to say. */}
              <td className={`num${r.eligibleCount > 0 ? ' num-eligible' : ''}`}>
                {r.eligibleCount > 0 ? (
                  num(r.eligibleCount)
                ) : (
                  <span style={{ color: 'var(--grey-2)' }}>—</span>
                )}
              </td>
              <td className="num">{money(r.fmv)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
