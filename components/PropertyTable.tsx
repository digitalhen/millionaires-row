import Link from 'next/link';
import type { PropertyListItem } from '@/lib/types';
import { addressLabel, boroName, buildingClassLabel, money } from '@/lib/format';
import { EligibleMark, NotOnRollMark } from './EligibleBadge';

export default function PropertyTable({ rows }: { rows: PropertyListItem[] }) {
  if (!rows.length) return <p className="crumb">No properties.</p>;
  return (
    <div className="table-wrap">
      <table className="ledger">
        <thead>
          <tr>
            <th>Address</th>
            <th>Borough</th>
            <th>Class</th>
            <th className="num">Full market value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.parid}>
              <td>
                {r.eligible ? <EligibleMark /> : !r.on_supplemental ? <NotOnRollMark /> : null}
                <Link href={`/property/${encodeURIComponent(r.parid)}`}>
                  {addressLabel(r.address)}
                </Link>
              </td>
              <td className="nowrap">{boroName(r.boro)}</td>
              <td>
                {r.bldg_class ? (
                  <>
                    {r.bldg_class}
                    {buildingClassLabel(r.bldg_class, r.parid) ? (
                      <span className="hide-sm" style={{ color: 'var(--grey-2)' }}>
                        {' '}
                        · {buildingClassLabel(r.bldg_class, r.parid)}
                      </span>
                    ) : null}
                  </>
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
