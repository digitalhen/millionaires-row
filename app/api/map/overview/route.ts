import { getOverviewPoints, OVERVIEW_LIMIT } from '@/lib/queries';
import { bufferResponse } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The overview set is deterministic and the underlying data is read-only, so
 * the serialised payload is built once per process and reused. That turns a
 * ~0.6s query + 3.7MB serialise into a buffer copy for every later request.
 */
let cachedBody: Buffer | null = null;
let cachedLimit = -1;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get('limit') ?? OVERVIEW_LIMIT) || OVERVIEW_LIMIT;
  try {
    if (!cachedBody || cachedLimit !== limit) {
      const points = await getOverviewPoints(limit);
      cachedBody = Buffer.from(JSON.stringify(points));
      cachedLimit = limit;
    }
    return bufferResponse(req, cachedBody, {
      headers: {
        // Deterministic result set over read-only data: cache hard. Clients
        // request it with a per-build ?v= key, so a deploy always refetches.
        'Cache-Control':
          'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[api/map/overview]', err);
    return Response.json({ error: 'overview query failed' }, { status: 500 });
  }
}
