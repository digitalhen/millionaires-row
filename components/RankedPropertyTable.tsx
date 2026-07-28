import Link from 'next/link';
import type { RankedProperty } from '@/lib/aggregates';
import { boroName, money, num } from '@/lib/format';
import { ownerPath, propertyPath } from '@/lib/seo';
import { EligibleMark, NotOnRollMark } from './EligibleBadge';

/**
 * A league table of parcels: position, the parcel, its owner of record and the
 * DOF value. The tier marks in the first column are the same vocabulary the
 * map and `PropertyTable` use — red ■ may be subject, grey □ not on the
 * supplemental roll — so a leaderboard reads the same way as a portfolio.
 *
 * `PropertyTable` stays the component for an owner's holdings; this one exists
 * because a ranking needs a position and an owner column, and a portfolio
 * needs neither.
 */
export default function RankedPropertyTable({
  rows,
  showBorough = true,
}: {
  rows: RankedProperty[];
  showBorough?: boolean;
}) {
  if (!rows.length) return <p className="crumb">No properties.</p>;
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th className="rank">#</th>
            <th>Address</th>
            {showBorough && <th>Borough</th>}
            <th>Owner of record</th>
            <th className="num">Full market value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.parid}>
              <td className="rank">{num(i + 1)}</td>
              <td>
                {r.eligible ? <EligibleMark /> : !r.on_supplemental ? <NotOnRollMark /> : null}
                <Link href={propertyPath(r.parid)}>{r.address}</Link>
              </td>
              {showBorough && <td className="nowrap">{boroName(r.boro)}</td>}
              <td>
                {r.owner_norm ? (
                  <Link href={ownerPath(r.owner_norm)}>
                    {r.owner_display || r.owner}
                  </Link>
                ) : (
                  <span style={{ color: 'var(--grey-2)' }}>{r.owner || '—'}</span>
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
