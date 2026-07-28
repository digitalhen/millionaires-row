import { NextResponse } from 'next/server';
import { search } from '@/lib/queries';
import type { SearchMode } from '@/lib/types';

export const dynamic = 'force-dynamic';

const MODES: SearchMode[] = ['all', 'owner', 'address'];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const modeParam = (url.searchParams.get('mode') ?? 'all') as SearchMode;
  const mode = MODES.includes(modeParam) ? modeParam : 'all';
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const offset = Number(url.searchParams.get('offset') ?? 0);

  try {
    const data = await search(q, mode, limit, offset);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    });
  } catch (err) {
    console.error('[api/search]', err);
    return NextResponse.json({ error: 'search failed' }, { status: 500 });
  }
}
