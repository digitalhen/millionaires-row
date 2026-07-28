'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DetailPanel from './DetailPanel';
import MapExplorer from './MapExplorer';
import SearchBox from './SearchBox';
import { withBase } from '@/lib/basePath';
import { moneyCompact, num } from '@/lib/format';
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

  const select = useCallback((next: string | null) => {
    setParid(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('p', next);
    else url.searchParams.delete('p');
    // Shallow update: no navigation, no refetch of the page itself.
    window.history.pushState({}, '', url);
  }, []);

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
            Every property on the New York City Department of Finance 2027
            supplemental roll — the parcels within reach of the
            non-primary-residence surcharge. Search any name or address.
          </p>
          <SearchBox autoFocus onSelect={(r) => select(r.parid)} />
          {stats && (
            <div className="hero-stats">
              <span>
                <b>{num(stats.properties)}</b> parcels
              </span>
              {stats.supplementalCount < stats.properties && (
                <span>
                  <b>{num(stats.supplementalCount)}</b> on the supplemental roll
                </span>
              )}
              <span>
                <b>{num(stats.owners)}</b> owners
              </span>
              <span>
                <b>{num(stats.multiOwners)}</b> hold more than one
              </span>
              <span className="stat-eligible">
                <b>{num(stats.eligibleCount)}</b> may be subject
              </span>
              <span>
                <b>{moneyCompact(stats.totalFmv)}</b> full market value
              </span>
            </div>
          )}
        </div>
      </div>
      <DetailPanel
        parid={parid}
        data={data}
        loading={loading}
        error={error}
        onClose={close}
      />
    </main>
  );
}
