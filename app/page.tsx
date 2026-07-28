import MapExplorer from '@/components/MapExplorer';
import SearchBox from '@/components/SearchBox';
import { getStats } from '@/lib/queries';
import { moneyCompact, num } from '@/lib/format';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let stats: StatsResponse | null = null;
  try {
    stats = await getStats();
  } catch (err) {
    console.error('[home] stats unavailable', err);
  }

  return (
    <main className="map-shell">
      <MapExplorer />
      <div className="map-overlay">
        <div className="hero">
          <h1>Millionaires&rsquo; Row</h1>
          <p className="tagline">
            Every property on the New York City Department of Finance 2027
            supplemental roll — the parcels within reach of the non-primary-residence
            surcharge. Search any name or address.
          </p>
          <SearchBox autoFocus />
          {stats && (
            <div className="hero-stats">
              <span>
                <b>{num(stats.properties)}</b> parcels
              </span>
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
          )}
        </div>
      </div>
    </main>
  );
}
