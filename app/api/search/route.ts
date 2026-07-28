import { NextResponse } from 'next/server';
import { search } from '@/lib/queries';
import { rateLimit } from '@/lib/rateLimit';
import type { SearchMode } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MODES: SearchMode[] = ['all', 'owner', 'address'];

export async function GET(req: Request) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const modeParam = (url.searchParams.get('mode') ?? 'all') as SearchMode;
  const mode = MODES.includes(modeParam) ? modeParam : 'all';
  // `search()` clamps both against SEARCH_MAX_LIMIT / SEARCH_MAX_OFFSET;
  // parsing here only keeps a garbage string from arriving as NaN.
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  try {
    const data = await search(q, mode, limit, offset);
    return NextResponse.json(data, {
      headers: {
        // Static for the life of a deploy, so a browser (or anything caching in
        // front of the app) may hold it briefly and serve a stale copy while it
        // refreshes. Short, because a deploy does not bust this URL.
        'Cache-Control':
          'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    console.error('[api/search]', err);
    return NextResponse.json({ error: 'search failed' }, { status: 500 });
  }
}
