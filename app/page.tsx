import HomeView from '@/components/HomeView';
import { getStats } from '@/lib/queries';
import type { StatsResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let stats: StatsResponse | null = null;
  try {
    stats = await getStats();
  } catch (err) {
    console.error('[home] stats unavailable', err);
  }

  return <HomeView stats={stats} />;
}
