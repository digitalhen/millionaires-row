import Link from 'next/link';
import type { BuildingBlock, PropertyListItem } from '@/lib/types';
import { addressLabel, money, num, unitCountPhrase } from '@/lib/format';
import { EligibleMark } from './EligibleBadge';

/**
 * "In this building" — the other parcels stacked on this one's map point.
 *
 * An apartment house is many lines of the tax roll at one coordinate: a co-op
 * files a building-level record whose FMV is the aggregate plus a row per
 * apartment, and a condominium files nothing but units. Clicking the dot lands
 * on an arbitrary one of those, so every unit page carries the rest of the
 * building — and, crucially, says out loud which figure is an aggregate.
 *
 * Presentational and hook-free, so the server-rendered property page and the
 * client-side map panel share it. The panel passes `onNavigate` to swap its own
 * contents in place instead of leaving the map; the rows stay real links either
 * way, so middle-click and "open in new tab" still work.
 */
export default function BuildingUnits({
  building,
  currentParid,
  rowCap,
  seeAllParid,
  onNavigate,
}: {
  building: BuildingBlock;
  /** The parcel whose page/panel this section sits on — marked in the list. */
  currentParid?: string;
  /** Show at most this many rows (the panel is a 45dvh sheet on a phone). */
  rowCap?: number;
  /** Parcel whose full page carries the untruncated list. */
  seeAllParid?: string;
  onNavigate?: (parid: string) => void;
}) {
  const { buildingRecord, isBuildingRecord, recordUnitCount, unitCount, units } = building;
  // A condo number can span a row of attached houses (2103-2125 57th St is
  // one condominium: twelve houses, apartments 1-3 in each). Labelled by
  // apartment alone the table reads "1, 3, 1, 3…" at identical values — like
  // duplicate rows. When the siblings span more than one street address, the
  // rows carry their full address instead.
  const multiAddress =
    new Set(units.map(baseAddress).filter(Boolean)).size > 1;
  let shown = rowCap != null ? units.slice(0, rowCap) : units;
  // The viewed record must never fall off the capped list — its absence is
  // what made the section read as a different building's units.
  if (currentParid && units.some((u) => u.parid === currentParid)
      && !shown.some((u) => u.parid === currentParid)) {
    const current = units.find((u) => u.parid === currentParid) as PropertyListItem;
    shown = [...shown.slice(0, -1), current];
  }
  const withheld = unitCount > shown.length;
  // The aggregate covers the co-op's own apartments, which is not always every
  // sibling: a co-op inside a condominium sits alongside commercial units and a
  // billing lot whose values are not in that figure.
  const aggregate = `${money(buildingRecord?.fmv)} — aggregate of ${unitCountPhrase(recordUnitCount)}`;

  const link = (parid: string, children: React.ReactNode, className?: string) => (
    <Link
      href={`/property/${encodeURIComponent(parid)}`}
      className={className}
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate(parid);
            }
          : undefined
      }
    >
      {children}
    </Link>
  );

  return (
    <>
      {buildingRecord && !isBuildingRecord ? (
        <p className="bldg-line">
          <span className="label">Building</span>
          {link(buildingRecord.parid, addressLabel(buildingRecord.address), 'bldg-addr')}
          <span className="crumb">{aggregate}</span>
        </p>
      ) : (
        <p className="bldg-line">
          <span className="label">
            {isBuildingRecord
              ? 'This record'
              : multiAddress
                ? 'Same condominium'
                : 'Same building'}
          </span>
          <span className="crumb">
            {isBuildingRecord ? aggregate : `${num(unitCount)} units, each valued separately`}
          </span>
        </p>
      )}

      {shown.length > 0 && (
        <div
          className={`table-wrap${
            // Only the full page ever gets a long list — the panel is capped to
            // a dozen rows, and a scroller inside the bottom sheet's own
            // scroller is a trap.
            rowCap == null && shown.length > 25 ? ' bldg-scroll' : ''
          }`}
        >
          <table className="ledger ledger--tight">
            <thead>
              <tr>
                <th>Apt</th>
                <th className="num">Full market value</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.parid}>
                  <td>
                    {u.eligible ? <EligibleMark /> : null}
                    {u.parid === currentParid ? (
                      <>
                        <strong>{unitLabel(u, multiAddress)}</strong>
                        <span className="crumb"> · this record</span>
                      </>
                    ) : (
                      link(u.parid, unitLabel(u, multiAddress))
                    )}
                  </td>
                  <td className={`num${u.eligible ? ' num-eligible' : ''}`}>{money(u.fmv)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {withheld && (
        <p className="crumb bldg-more">
          Showing {num(shown.length)} of {num(unitCount)}
          {seeAllParid ? (
            <>
              {' · '}
              <Link href={`/property/${encodeURIComponent(seeAllParid)}`}>Full list →</Link>
            </>
          ) : null}
        </p>
      )}

      <p className="bldg-note">
        Unit values are assessed individually; the building figure is their aggregate.
      </p>
    </>
  );
}

/**
 * Apartment designation, falling back to the address: a condominium's billing
 * lot and its commercial spaces are siblings too and carry no apartment number.
 * When the sibling set spans several street addresses, the full address (which
 * carries the apartment clause) is the label — the bare apartment number would
 * repeat across houses.
 */
function unitLabel(u: PropertyListItem, multiAddress = false): string {
  const apt = (u.aptno ?? '').trim();
  if (multiAddress || !apt) return addressLabel(u.address);
  return apt;
}

/** The address with its apartment clause removed — the house, not the unit. */
function baseAddress(u: PropertyListItem): string {
  const a = (u.address ?? '').trim();
  const apt = (u.aptno ?? '').trim();
  const suffix = apt ? `, APT ${apt}` : '';
  return suffix && a.endsWith(suffix) ? a.slice(0, -suffix.length) : a;
}
