'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import DetailPanel from './DetailPanel';
import MapExplorer, { type MapStackEntry } from './MapExplorer';
import SearchBox from './SearchBox';
import { withBase } from '@/lib/basePath';
import { moneyCompact, num } from '@/lib/format';
import { LEADERBOARDS_PATH } from '@/lib/seo';
import type { PropertyResponse, StatsResponse } from '@/lib/types';

/**
 * Owns the "which parcel is selected" state shared by the map, the search box
 * and the details panel. Selection lives in the query string (`?p=<parid>`) so
 * the browser Back button closes the panel and a view can be linked.
 */
export default function HomeView({ stats }: { stats: StatsResponse | null }) {
  const [parid, setParid] = useState<string | null>(null);
  const [data, setData] = useState<PropertyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  /** Buildings sharing the clicked map point (set only by map clicks). */
  const [stack, setStack] = useState<MapStackEntry[] | null>(null);

  // Read the initial selection and follow Back/Forward.
  useEffect(() => {
    const read = () => {
      const p = new URLSearchParams(window.location.search).get('p');
      setParid(p && p.trim() ? p : null);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);

  const select = useCallback((next: string | null, nextStack?: MapStackEntry[]) => {
    setParid(next);
    // A click on a stacked point carries the other buildings; any other way
    // in (search, deep link, unit navigation) clears them.
    setStack(nextStack ?? null);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('p', next);
    else url.searchParams.delete('p');
    // Shallow update: no navigation, no refetch of the page itself.
    window.history.pushState({}, '', url);
  }, []);

  /** Swap the panel to a sibling of the stack without dropping the stack. */
  const selectWithinStack = useCallback(
    (next: string) => select(next, stack ?? undefined),
    [select, stack],
  );

  const close = useCallback(() => select(null), [select]);

  useEffect(() => {
    if (!parid) {
      setData(null);
      setError(false);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(false);
    fetch(withBase(`/api/property/${encodeURIComponent(parid)}`), { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: PropertyResponse) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setData(null);
        setError(true);
        setLoading(false);
      });
    return () => ac.abort();
  }, [parid]);

  // Stable identity so the map only animates when the target actually changes.
  const lng = data?.property?.longitude ?? null;
  const lat = data?.property?.latitude ?? null;
  const gotParid = data?.property?.parid ?? null;
  const focus = useMemo(
    () => (gotParid && lng != null && lat != null ? { lng, lat, parid: gotParid } : null),
    [gotParid, lng, lat],
  );

  return (
    <main className={`map-shell${parid ? ' has-panel' : ''}`}>
      <MapExplorer focus={focus} onSelect={select} />
      <div className="map-overlay">
        <div className="hero">
          <h1>Millionaires&rsquo; Row</h1>
          <p className="tagline">
            Every property in New York City, and the ones the Department of
            Finance put on its 2027 supplemental roll — the parcels within reach
            of the non-primary-residence surcharge. Search any name or address.
          </p>
          <SearchBox autoFocus syncQueryParam onSelect={(r) => select(r.parid)} />
          {stats && (
            <>
              {/* The three tiers, in the order the map draws them: the whole
                  city, then the roll, then the parcels that may be taxed. */}
              <div className="hero-stats">
                <span>
                  <b>{num(stats.allProperties)}</b> NYC properties
                </span>
                <span>
                  <b>{num(stats.supplementalCount)}</b> on the supplemental roll
                </span>
                <span className="stat-eligible">
                  <b>{num(stats.eligibleCount)}</b> may be subject
                </span>
              </div>
              <div className="hero-stats hero-stats--sub">
                <span>
                  <b>{num(stats.owners)}</b> owners
                </span>
                <span>
                  <b>{num(stats.multiOwners)}</b> hold more than one
                </span>
                <span>
                  <b>{moneyCompact(stats.totalFmv)}</b> full market value
                </span>
              </div>
            </>
          )}
          {/* The one way out of the map view: the city-wide rankings, and from
              there the borough and ZIP breakdowns. */}
          <p className="hero-links">
            <Link href={LEADERBOARDS_PATH} className="badge">
              Leaderboards
            </Link>
          </p>
        </div>
      </div>
      <DetailPanel
        parid={parid}
        data={data}
        loading={loading}
        error={error}
        stack={stack}
        onClose={close}
        onSelect={select}
        onSelectStacked={selectWithinStack}
      />
    </main>
  );
}
