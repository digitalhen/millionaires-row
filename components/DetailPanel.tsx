'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PropertyResponse } from '@/lib/types';
import {
  addressLabel,
  boroName,
  buildingClassLabel,
  formatBbl,
  money,
  num,
  taxClassLabel,
} from '@/lib/format';
import BuildingUnits from './BuildingUnits';
import EligibleBadge, { NotOnRollNote } from './EligibleBadge';
import OwnerCounts from './OwnerCounts';

/**
 * Units listed in the sheet before it falls back to "full list →". On a phone
 * the panel is 45dvh, so a 200-row table would bury the close button under a
 * scroll nobody asked for; twelve rows is enough to show what kind of building
 * this is, and the property page carries the rest.
 */
const PANEL_UNIT_ROWS = 12;

/**
 * Selected-property details. A right-hand side panel on desktop, a bottom sheet
 * on phones (same component, swapped by media query). Clicking another point
 * swaps the content in place; the map stays visible and interactive.
 */
export default function DetailPanel({
  parid,
  data,
  loading,
  error,
  onClose,
  onSelect,
}: {
  parid: string | null;
  data: PropertyResponse | null;
  loading: boolean;
  error: boolean;
  onClose: () => void;
  /** Swap the panel to another parcel without leaving the map. */
  onSelect?: (parid: string) => void;
}) {
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);

  // Escape closes the panel.
  useEffect(() => {
    if (!parid) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [parid, onClose]);

  useEffect(() => setDragY(0), [parid]);

  if (!parid) return null;

  const p = data?.property ?? null;
  const owner = data?.owner ?? null;
  const building = data?.building ?? null;
  const bldg = p ? buildingClassLabel(p.bldg_class) : null;

  return (
    <aside
      className="panel"
      role="dialog"
      aria-label="Property details"
      style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
    >
      <div
        className="panel-grab"
        aria-hidden="true"
        onTouchStart={(e) => {
          startY.current = e.touches[0].clientY;
        }}
        onTouchMove={(e) => {
          if (startY.current == null) return;
          setDragY(Math.max(0, e.touches[0].clientY - startY.current));
        }}
        onTouchEnd={() => {
          if (dragY > 70) onClose();
          else setDragY(0);
          startY.current = null;
        }}
      />
      <button type="button" className="panel-close" onClick={onClose} aria-label="Close details">
        ✕
      </button>

      <div className="panel-body">
        {!p ? (
          <p className="label" style={{ paddingTop: 6 }}>
            {error ? 'Record unavailable' : loading ? 'Loading…' : 'Not found'}
          </p>
        ) : (
          <>
            <span className="label">Parcel</span>
            <h2 className="panel-addr">{addressLabel(p.address, p)}</h2>
            <p className="panel-sub">
              {boroName(p.boro)}
              {p.zip_code ? ` · ${p.zip_code}` : ''} · BBL{' '}
              {formatBbl(p.boro, p.block, p.lot)}
            </p>

            {(p.eligible || !p.on_supplemental) && (
              <p style={{ margin: '10px 0 0' }}>
                {p.eligible ? <EligibleBadge /> : <NotOnRollNote />}
              </p>
            )}

            <div className="panel-fmv-block">
              {/* Named as an aggregate right here, not only in the building
                  section below: the co-op building record's figure is the whole
                  house and reads as a single flat otherwise. */}
              <span className="label">
                {building?.isBuildingRecord
                  ? `Full market value — aggregate of ${num(building.recordUnitCount)} units`
                  : 'Full market value'}
              </span>
              <div className="panel-fmv">{money(p.fmv)}</div>
              <span className="crumb">DOF estimate · tax year {p.tax_year}</span>
            </div>

            <dl className="panel-rows">
              <div>
                <dt className="label">Owner</dt>
                <dd>
                  {p.owner_norm ? p.owner : 'No owner on file'}
                  {owner && owner.property_count > 1 && (
                    <>
                      {' '}
                      <Link
                        href={`/owner/${encodeURIComponent(owner.owner_norm)}`}
                        className="badge"
                      >
                        ▣ {num(owner.property_count)} properties
                      </Link>
                      <OwnerCounts owner={owner} />
                    </>
                  )}
                </dd>
              </div>
              <div>
                <dt className="label">Tax class</dt>
                <dd>
                  {p.tax_class}
                  <span className="dim"> · {taxClassLabel(p.tax_class)}</span>
                </dd>
              </div>
              <div>
                <dt className="label">Building class</dt>
                <dd>
                  {p.bldg_class || '—'}
                  {bldg && <span className="dim"> · {bldg}</span>}
                </dd>
              </div>
              <div>
                <dt className="label">PARID</dt>
                <dd>{p.parid}</dd>
              </div>
            </dl>

            <Link href={`/property/${encodeURIComponent(p.parid)}`} className="badge panel-full">
              Full details →
            </Link>

            {/* Last in the sheet on purpose: on a phone the panel is 45dvh, and
                the value, the owner and the way out must all be reachable
                without scrolling past a block of flat numbers. */}
            {building && (
              <section className="panel-bldg">
                <h3>In this building</h3>
                <BuildingUnits
                  building={building}
                  rowCap={PANEL_UNIT_ROWS}
                  seeAllParid={p.parid}
                  onNavigate={onSelect}
                />
              </section>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
