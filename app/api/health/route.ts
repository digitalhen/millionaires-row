import { NextResponse } from 'next/server';
import { pingDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Container health check (Dokploy / docker compose).
 *
 * Liveness, not readiness: the answer is 200 whenever the Node process can
 * still serve a request, with `db` reporting whether Postgres answered inside
 * a second. Restarting the app does not fix a database outage, so flipping the
 * container unhealthy for one would only take the site's static pages down
 * with it — `db: false` is the signal to alert on instead.
 *
 * Never rate limited: the probe runs on a fixed interval from the host and is
 * exactly the request you still want served when something is hammering the API.
 */
export async function GET() {
  const db = await pingDb(1_000);
  return NextResponse.json(
    { ok: true, db, buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
