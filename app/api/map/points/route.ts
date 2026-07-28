import { NextResponse } from 'next/server';
import { getPointsInBbox } from '@/lib/queries';
import { jsonResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bbox = url.searchParams.get('bbox');
  if (!bbox) {
    return NextResponse.json({ error: 'bbox required' }, { status: 400 });
  }
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return NextResponse.json(
      { error: 'bbox must be minLng,minLat,maxLng,maxLat' },
      { status: 400 },
    );
  }
  const [minLng, minLat, maxLng, maxLat] = parts;
  if (minLng > maxLng || minLat > maxLat) {
    return NextResponse.json({ error: 'bbox min must be <= max' }, { status: 400 });
  }
  const limit = Number(url.searchParams.get('limit') ?? 20_000);

  try {
    const points = await getPointsInBbox(minLng, minLat, maxLng, maxLat, limit);
    return jsonResponse(req, points, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    });
  } catch (err) {
    console.error('[api/map/points]', err);
    return NextResponse.json({ error: 'points query failed' }, { status: 500 });
  }
}
