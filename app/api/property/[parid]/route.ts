import { NextResponse } from 'next/server';
import { getProperty } from '@/lib/queries';
import { rateLimit } from '@/lib/rateLimit';
import { decodeParam } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ parid: string }> },
) {
  const limited = rateLimit(req);
  if (limited) return limited;

  const { parid } = await params;
  try {
    const data = await getProperty(decodeParam(parid).trim());
    if (!data) {
      return NextResponse.json({ error: 'property not found' }, { status: 404 });
    }
    return NextResponse.json(data, {
      headers: {
        // Read-only for the life of a deploy; a short shared-cache window plus
        // stale-while-revalidate absorbs the repeat hits a crawler generates.
        'Cache-Control':
          'public, max-age=300, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (err) {
    console.error('[api/property]', err);
    return NextResponse.json({ error: 'lookup failed' }, { status: 500 });
  }
}
