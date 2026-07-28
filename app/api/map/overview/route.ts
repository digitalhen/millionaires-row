import { NextResponse } from 'next/server';
import { getOverviewPoints, OVERVIEW_LIMIT } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? OVERVIEW_LIMIT);
  try {
    const points = await getOverviewPoints(limit);
    return NextResponse.json(points, {
      headers: {
        // Deterministic result set over read-only data: cache hard.
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/map/overview]', err);
    return NextResponse.json({ error: 'overview query failed' }, { status: 500 });
  }
}
