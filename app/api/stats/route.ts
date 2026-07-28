import { NextResponse } from 'next/server';
import { getStats } from '@/lib/queries';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getStats();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    console.error('[api/stats]', err);
    return NextResponse.json({ error: 'stats query failed' }, { status: 500 });
  }
}
