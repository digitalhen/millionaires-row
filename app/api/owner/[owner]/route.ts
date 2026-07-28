import { NextResponse } from 'next/server';
import { getOwner } from '@/lib/queries';
import { decodeParam } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ owner: string }> },
) {
  const { owner } = await params;
  try {
    const data = await getOwner(decodeParam(owner).trim());
    if (!data) {
      return NextResponse.json({ error: 'owner not found' }, { status: 404 });
    }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('[api/owner]', err);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}
