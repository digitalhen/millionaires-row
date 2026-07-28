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

function makePool(): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL || DEFAULT_URL,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
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
