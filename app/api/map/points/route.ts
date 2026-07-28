import { NextResponse } from 'next/server';
import { getPointsInBbox } from '@/lib/queries';
import { jsonResponse } from '@/lib/http';
import { NYC_BOUNDS } from '@/lib/mapStyle';
import { rateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

const [[WEST, SOUTH], [EAST, NORTH]] = NYC_BOUNDS;

/**
 * Ceiling on the *requested* box, in square degrees.
 *
 * The client's camera is pinned to `NYC_BOUNDS` (0.70 x 0.50 = 0.35 deg^2) and
 * only asks for a viewport at all from zoom 12 up, so nothing legitimate comes
 * close. The threshold still sits above that rather than at it, because a very
 * wide display at zoom 12 spans more longitude than the bounds themselves and
 * MapLibre hands back the wider box — 0.25 deg^2 would have started returning
 * 400s to real visitors on 4K screens. What actually bounds the *cost* is the
 * clamp below; this only turns obvious garbage (a world bbox, 64,800 deg^2)
 * away before it reaches Postgres.
 */
const MAX_BBOX_AREA_DEG2 = 1;

export async function GET(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;

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
  if ((maxLng - minLng) * (maxLat - minLat) > MAX_BBOX_AREA_DEG2) {
    return NextResponse.json(
      { error: `bbox may not exceed ${MAX_BBOX_AREA_DEG2} square degrees` },
      { status: 400 },
    );
  }

  // Clip to the city. There is no data outside these bounds, so trimming costs
  // nothing in results and keeps the worst query this route can be asked to run
  // — a scan and md5 sort of every parcel in the box — bounded by the size of
  // NYC rather than by whatever the caller typed.
  const west = Math.max(minLng, WEST);
  const south = Math.max(minLat, SOUTH);
  const east = Math.min(maxLng, EAST);
  const north = Math.min(maxLat, NORTH);
  if (west > east || south > north) return jsonResponse(req, []);

  const limit = Number(url.searchParams.get('limit') ?? 20_000);

  try {
    const points = await getPointsInBbox(west, south, east, north, limit);
    return jsonResponse(req, points, {
      headers: {
        // Deterministic for the life of a deploy, and panning back to a view
        // is the common case, so let the browser keep it for a few minutes.
        'Cache-Control':
          'public, max-age=300, s-maxage=300, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    console.error('[api/map/points]', err);
    return NextResponse.json({ error: 'points query failed' }, { status: 500 });
  }
}
