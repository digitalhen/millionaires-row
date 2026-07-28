import { getOverviewPoints, OVERVIEW_LIMIT } from '@/lib/queries';
import { GZIP_LEVEL_CACHED, bufferResponse, gzipBuffer } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The overview set is deterministic and the underlying data is read-only, so
 * the serialised payload is built once per process and reused. That turns a
 * ~0.6s query + 3.7MB serialise into a buffer copy for every later request.
 *
 * Both forms are held. Once the JSON was cached, *compressing* it was the
 * entire cost of this route — 4.6MB per response, ~30 responses a second at 25
 * concurrent clients, every one of them re-deriving the same 1.4MB. Compressed
 * once, at the slower level (which pays for itself when it is amortised over
 * every request of a deploy), serving it is a memcpy.
 *
 * The sample size is deliberately *not* taken from the query string. It is the
 * one knob that would make a stranger re-run the 0.6s query and re-compress
 * 4.6MB at will, simply by counting upwards; the client has never sent it.
 * `OVERVIEW_SAMPLE` is the operator-side equivalent.
 *
 * Deliberately not rate limited: a session fetches this once, it is served from
 * memory, and it is the payload the map cannot start without.
 */
const SAMPLE = Number(process.env.OVERVIEW_SAMPLE || OVERVIEW_LIMIT) || OVERVIEW_LIMIT;

type Payload = { body: Buffer; gzipped: Buffer };
let cached: Payload | null = null;
/** In-flight build, so a cold start under load runs the query exactly once. */
let building: Promise<Payload> | null = null;

function payload(): Promise<Payload> {
  if (cached) return Promise.resolve(cached);
  if (!building) {
    building = (async () => {
      const points = await getOverviewPoints(SAMPLE);
      const body = Buffer.from(JSON.stringify(points));
      const next: Payload = { body, gzipped: await gzipBuffer(body, GZIP_LEVEL_CACHED) };
      cached = next;
      return next;
    })().finally(() => {
      building = null;
    });
  }
  return building;
}

export async function GET(req: Request) {
  try {
    const { body, gzipped } = await payload();
    return bufferResponse(req, body, {
      gzipped,
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
