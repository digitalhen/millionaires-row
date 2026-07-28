import { Pool, types } from 'pg';

// bigint (int8, oid 20) arrives as a string by default so precision is not lost.
// Every bigint in this schema (bbl, fmv, total_fmv) fits comfortably in a JS
// number, so parse them to numbers for convenient JSON serialisation.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// numeric (oid 1700) comes back from sum() as a string.
types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const DEFAULT_URL = 'postgres://mrow:mrow@localhost:5435/mrow_dev';

declare global {
  // eslint-disable-next-line no-var
  var __mrowPool: Pool | undefined;
}

/**
 * Nothing this app asks for is slow: the worst indexed query (a containment
 * search over 1.2M rows) lands around 150ms. So anything still running after
 * five seconds is pathological — a scraper's degenerate input, or a plan that
 * fell off an index — and the useful thing to do is kill it rather than let it
 * hold a pool connection while other requests queue behind it. Postgres raises
 * 57014 (query_canceled), the route logs it and returns its 500.
 */
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS || 5_000);

/**
 * JIT off.
 *
 * Postgres decides to JIT-compile from the planner's *cost estimate*, not from
 * how long the query actually takes. The viewport query trips the default
 * `jit_above_cost` of 100,000 — its estimate is ~102,000 because of the sort —
 * and then spends ~38ms emitting machine code for a query that executes in ~65.
 * Nothing here runs long enough for that to ever pay for itself. Measured on
 * the midtown viewport: 81ms with JIT, 65ms without.
 */
const SESSION_OPTIONS = '-c jit=off';

function makePool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_URL,
    // Sized against the container's Postgres, which allows 100 connections and
    // has to leave room for the second instance and for psql. Past ~15 the
    // extra concurrency buys nothing anyway: the box has fewer cores than that,
    // so deeper pools just move the queue from the app into the database.
    max: Number(process.env.PGPOOL_MAX || 15),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    options: SESSION_OPTIONS,
    application_name: 'millionaires-row',
  });
}

// Re-use the pool across hot reloads in dev.
export const pool: Pool = globalThis.__mrowPool ?? makePool();
if (process.env.NODE_ENV !== 'production') globalThis.__mrowPool = pool;

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params as unknown[]);
  return res.rows as T[];
}

export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length ? rows[0] : null;
}

/**
 * Liveness probe for `/api/health`. Bounded by its own timer rather than the
 * pool's `connectionTimeoutMillis`, because a health check that blocks for ten
 * seconds is worse than one that reports "database not answering" in one.
 */
export async function pingDb(timeoutMs = 1_000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('db ping timeout')), timeoutMs);
    });
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
