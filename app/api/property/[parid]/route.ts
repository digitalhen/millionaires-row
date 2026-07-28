import { NextResponse } from 'next/server';
import { getProperty } from '@/lib/queries';
import { decodeParam } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ parid: string }> },
) {
  const { parid } = await params;
  try {
    const data = await getProperty(decodeParam(parid).trim());
    if (!data) {
      return NextResponse.json({ error: 'property not found' }, { status: 404 });
    }
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    });
  } catch (err) {
    console.error('[api/property]', err);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}
