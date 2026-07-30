'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { MapStackEntry } from './MapExplorer';
import type { PropertyResponse } from '@/lib/types';
import {
  BUILDING_SCALE_CAPTION,
  addressLabel,
  boroName,
  buildingClassLabel,
  formatBbl,
  isBuildingScaleRecord,
  money,
  num,
  recordScopeNote,
  shareSummary,
  taxClassLabel,
  unitCountPhrase,
} from '@/lib/format';
import BuildingUnits from './BuildingUnits';
import EligibleBadge, { EligibleMark, NotOnRollNote } from './EligibleBadge';
import OwnerCounts from './OwnerCounts';
import ShareButton from './ShareButton';
import { withBase } from '@/lib/basePath';

/**
 * Units listed in the sheet before it falls back to "full list →". On a phone
 * the panel is 45dvh, so a 200-row table would bury the close button under a
 * scroll nobody asked for; twelve rows is enough to show what kind of building
 * this is, and the property page carries the rest.
 */
const PANEL_UNIT_ROWS = 12;

/** Address labels for stacked-building rows, cached for the session. */
const stackAddrCache = new Map<string, string>();

/**
 * One building in the "N buildings at this map point" list. The stack entries
 * arrive from the map with no address (dots carry only parids), so each row
 * fetches its own — cached, and there are rarely more than a handful. The
 * representative can be a unit; its apartment clause is dropped the same way
 * the map tooltip drops it, because the row stands for the whole building.
 */
function StackRow({
  entry,
  active,
  onPick,
}: {
  entry: MapStackEntry;
  active: boolean;
  onPick?: (parid: string) => void;
}) {
  const [addr, setAddr] = useState<string | null>(
    stackAddrCache.get(entry.parid) ?? null,
  );
  useEffect(() => {
    if (stackAddrCache.has(entry.parid)) {
      setAddr(stackAddrCache.get(entry.parid) ?? null);
      return;
    }
    let gone = false;
    fetch(withBase(`/api/property/${encodeURIComponent(entry.parid)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.property || gone) return;
        let label = addressLabel(d.property.address, d.property);
        const apt = (d.property.aptno ?? '').trim();
        const suffix = apt ? `, APT ${apt}` : '';
        if (entry.members > 1 && suffix && label.endsWith(suffix)) {
          label = label.slice(0, -suffix.length);
        }
        stackAddrCache.set(entry.parid, label);
        setAddr(label);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [entry.parid, entry.members]);

  const name = addr ?? entry.parid;
  return (
    <li className="stack-row">
      {entry.tier === 2 ? <EligibleMark /> : null}
      {active ? (
        <strong>{name}</strong>
      ) : (
        <button type="button" className="stack-link" onClick={() => onPick?.(entry.parid)}>
          {name}
        </button>
      )}
      <span className="crumb">
        {' '}
        {entry.members > 1 ? `${num(entry.members)} units · ` : ''}
        {money(entry.fmv)}
      </span>
    </li>
  );
}

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
  stack,
  onClose,
  onSelect,
  onSelectStacked,
}: {
  parid: string | null;
  data: PropertyResponse | null;
  loading: boolean;
  error: boolean;
  /** Other buildings geocoded to the clicked map point, strongest first. */
  stack?: MapStackEntry[] | null;
  onClose: () => void;
  /** Swap the panel to another parcel without leaving the map. */
  onSelect?: (parid: string) => void;
  /** Like onSelect, but keeps the stacked-buildings list in place. */
  onSelectStacked?: (parid: string) => void;
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
  const bldg = p ? buildingClassLabel(p.bldg_class, p.parid) : null;
  /** R9/R0 building rows only — a `-U` row is one apartment, never a house. */
  const buildingScale = p ? isBuildingScaleRecord(p.bldg_class, p.parid) : false;
  const scopeNote = p ? recordScopeNote(p, building?.isBuildingRecord ?? false) : null;

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

            {/* Several buildings can be geocoded to one map point; the clicked
                dot only opens the strongest. Listing the rest here is what
                keeps them reachable — the dots stay on their true, shared
                coordinate instead of fanning out to places they are not. A
                zoomed-out tap also sweeps in genuine neighbours; those are a
                separate list and are called nearby, never "at this point". */}
            {(() => {
              if (!stack || stack.length < 2) return null;
              const atPoint = stack.filter((s) => s.atPoint);
              const nearby = stack.filter((s) => !s.atPoint).slice(0, 8);
              return (
                <>
                  {atPoint.length > 1 && (
                    <div className="panel-stack">
                      <span className="label">
                        {num(atPoint.length)} buildings share this map point
                      </span>
                      <ul>
                        {atPoint.map((s) => (
                          <StackRow
                            key={s.parid}
                            entry={s}
                            active={s.parid === p.parid}
                            onPick={onSelectStacked}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {nearby.length > 0 && (
                    <div className="panel-stack">
                      <span className="label">
                        {num(nearby.length)} other nearby building
                        {nearby.length === 1 ? '' : 's'}
                      </span>
                      <ul>
                        {nearby.map((s) => (
                          <StackRow
                            key={s.parid}
                            entry={s}
                            active={s.parid === p.parid}
                            onPick={onSelectStacked}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}

            {(p.eligible || !p.on_supplemental) && (
              <p style={{ margin: '10px 0 0' }}>
                {p.eligible ? <EligibleBadge /> : <NotOnRollNote />}
              </p>
            )}

            {/* What this record *is* — whole building, co-op aggregate, or
                co-op share — said before the figure below, which is otherwise
                misread. */}
            {scopeNote && (
              <p
                className="crumb"
                style={{ margin: '10px 0 0', textTransform: 'none' }}
              >
                {scopeNote}
              </p>
            )}

            <div className="panel-fmv-block">
              {/* Named as an aggregate right here, not only in the building
                  section below: the co-op building record's figure is the whole
                  house and reads as a single flat otherwise. */}
              <span className="label">
                {building?.isBuildingRecord
                  ? `Full market value — aggregate of ${unitCountPhrase(building.recordUnitCount)}`
                  : 'Full market value'}
              </span>
              <div className="panel-fmv">{money(p.fmv)}</div>
              <span className="crumb">
                DOF estimate{buildingScale ? ` · ${BUILDING_SCALE_CAPTION}` : ''} · tax
                year {p.tax_year}
              </span>
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

            <div className="panel-actions">
              <Link href={`/property/${encodeURIComponent(p.parid)}`} className="badge panel-full">
                Full details →
              </Link>
              <ShareButton
                path={`/?p=${encodeURIComponent(p.parid)}`}
                title={addressLabel(p.address, p)}
                text={shareSummary(p, owner?.property_count)}
              />
            </div>

            {/* Last in the sheet on purpose: on a phone the panel is 45dvh, and
                the value, the owner and the way out must all be reachable
                without scrolling past a block of flat numbers. */}
            {building && (
              <section className="panel-bldg">
                <h3>In this building</h3>
                <BuildingUnits
                  building={building}
                  currentParid={p.parid}
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
