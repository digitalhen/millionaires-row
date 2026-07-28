import { query, queryOne } from './db';
import type {
  MapPoint,
  OwnerResponse,
  OwnerSummary,
  Property,
  PropertyListItem,
  PropertyResponse,
  SearchMode,
  SearchResponse,
  SearchResult,
  StatsResponse,
} from './types';

/** Shortest query we will run. Below this a trigram index cannot help and a
 *  full scan of ~1M rows per keystroke is not acceptable. */
export const MIN_QUERY_LENGTH = 3;
export const SEARCH_MAX_LIMIT = 100;
/** Exact counts are capped so a query like "STREET" cannot cost a full scan. */
export const SEARCH_COUNT_CAP = 10_000;
export const OWNER_PROPERTY_CAP = 500;
export const OVERVIEW_LIMIT = 40_000;
export const POINTS_MAX_LIMIT = 50_000;

/** Escape LIKE/ILIKE wildcards in user input. Used with ESCAPE '\'. */
function escapeLike(s: string): string {
  return s.replace(/([\\%_])/g, '\\$1');
}

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toUpperCase();
}

const SEARCH_FILTER: Record<SearchMode, string> = {
  all: '(p.address ILIKE $1 ESCAPE \'\\\' OR p.owner_norm ILIKE $1 ESCAPE \'\\\')',
  owner: "p.owner_norm ILIKE $1 ESCAPE '\\'",
  address: "p.address ILIKE $1 ESCAPE '\\'",
};

export async function search(
  rawQ: string,
  mode: SearchMode = 'all',
  limit = 25,
  offset = 0,
): Promise<SearchResponse> {
  const q = normalizeQuery(rawQ);
  if (q.length < MIN_QUERY_LENGTH) return { results: [], total: 0, totalCapped: false };

  const lim = Math.min(Math.max(1, Math.floor(limit) || 25), SEARCH_MAX_LIMIT);
  const off = Math.max(0, Math.floor(offset) || 0);
  const esc = escapeLike(q);
  const contains = `%${esc}%`;
  const prefix = `${esc}%`;
  const where = SEARCH_FILTER[mode];

  // Rank: exact match first, then prefix match, then anything containing the
  // term. Ties broken by value (biggest money first) then parid for stability.
  const rows = await query<SearchResult>(
    `SELECT p.parid,
            p.address,
            p.boro,
            p.owner,
            p.owner_norm,
            p.fmv,
            COALESCE(o.property_count, 1)::int AS property_count
       FROM properties p
       LEFT JOIN owners o ON o.owner_norm = p.owner_norm
      WHERE ${where}
      ORDER BY CASE
                 WHEN p.owner_norm = $2 OR p.address = $2 THEN 0
                 WHEN p.address ILIKE $3 ESCAPE '\\' THEN 1
                 WHEN p.owner_norm ILIKE $3 ESCAPE '\\' THEN 2
                 ELSE 3
               END,
               p.fmv DESC NULLS LAST,
               p.parid
      LIMIT $4 OFFSET $5`,
    [contains, q, prefix, lim, off],
  );

  const counted = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM (SELECT 1 FROM properties p WHERE ${where} LIMIT $2) s`,
    [contains, SEARCH_COUNT_CAP + 1],
  );
  const raw = counted?.n ?? 0;
  return {
    results: rows,
    total: Math.min(raw, SEARCH_COUNT_CAP),
    totalCapped: raw > SEARCH_COUNT_CAP,
  };
}

export async function getProperty(parid: string): Promise<PropertyResponse | null> {
  const property = await queryOne<Property>(
    `SELECT * FROM properties WHERE parid = $1`,
    [parid],
  );
  if (!property) return null;

  let owner: OwnerSummary | null = null;
  let otherProperties: PropertyListItem[] = [];

  if (property.owner_norm) {
    owner = await queryOne<OwnerSummary>(
      `SELECT owner_norm, display_name, property_count, total_fmv
         FROM owners WHERE owner_norm = $1`,
      [property.owner_norm],
    );
    if (owner && owner.property_count > 1) {
      otherProperties = await query<PropertyListItem>(
        `SELECT parid, address, boro, tax_class, bldg_class, fmv
           FROM properties
          WHERE owner_norm = $1 AND parid <> $2
          ORDER BY fmv DESC NULLS LAST, parid
          LIMIT 50`,
        [property.owner_norm, parid],
      );
    }
  }

  return { property, owner, otherProperties };
}

export async function getOwner(ownerNorm: string): Promise<OwnerResponse | null> {
  const owner = await queryOne<OwnerSummary>(
    `SELECT owner_norm, display_name, property_count, total_fmv
       FROM owners WHERE owner_norm = $1`,
    [ownerNorm],
  );
  if (!owner) return null;

  const properties = await query<PropertyListItem>(
    `SELECT parid, address, boro, tax_class, bldg_class, fmv
       FROM properties
      WHERE owner_norm = $1
      ORDER BY fmv DESC NULLS LAST, parid
      LIMIT $2`,
    [ownerNorm, OWNER_PROPERTY_CAP],
  );

  return {
    owner,
    properties,
    truncated: owner.property_count > properties.length,
  };
}

type PointRow = { lng: number; lat: number; fmv: number | null; parid: string };

function toPoints(rows: PointRow[]): MapPoint[] {
  return rows.map((r) => [
    Math.round(r.lng * 1e5) / 1e5,
    Math.round(r.lat * 1e5) / 1e5,
    r.fmv,
    r.parid,
  ]);
}

/**
 * Deterministic, value-weighted downsample of the whole city. Top-N by FMV with
 * `parid` as a stable tiebreak means the same rows come back on every request,
 * which is what makes the long cache headers safe.
 */
export async function getOverviewPoints(limit = OVERVIEW_LIMIT): Promise<MapPoint[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || OVERVIEW_LIMIT), POINTS_MAX_LIMIT);
  const rows = await query<PointRow>(
    `SELECT longitude AS lng, latitude AS lat, fmv, parid
       FROM properties
      WHERE longitude IS NOT NULL AND latitude IS NOT NULL
      ORDER BY fmv DESC NULLS LAST, parid
      LIMIT $1`,
    [lim],
  );
  return toPoints(rows);
}

export async function getPointsInBbox(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  limit = 20_000,
): Promise<MapPoint[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || 20_000), POINTS_MAX_LIMIT);
  const rows = await query<PointRow>(
    `SELECT longitude AS lng, latitude AS lat, fmv, parid
       FROM properties
      WHERE longitude BETWEEN $1 AND $3
        AND latitude BETWEEN $2 AND $4
      ORDER BY fmv DESC NULLS LAST, parid
      LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, lim],
  );
  return toPoints(rows);
}

export async function getStats(): Promise<StatsResponse> {
  const [props, owners, topOwners] = await Promise.all([
    queryOne<{ properties: number; with_coords: number; total_fmv: number | null }>(
      `SELECT count(*)::int AS properties,
              count(longitude)::int AS with_coords,
              COALESCE(sum(fmv), 0) AS total_fmv
         FROM properties`,
    ),
    queryOne<{ owners: number; multi_owners: number }>(
      `SELECT count(*)::int AS owners,
              count(*) FILTER (WHERE property_count > 1)::int AS multi_owners
         FROM owners`,
    ),
    query<OwnerSummary>(
      `SELECT owner_norm, display_name, property_count, total_fmv
         FROM owners
        ORDER BY property_count DESC, total_fmv DESC, owner_norm
        LIMIT 20`,
    ),
  ]);

  return {
    properties: props?.properties ?? 0,
    withCoords: props?.with_coords ?? 0,
    owners: owners?.owners ?? 0,
    multiOwners: owners?.multi_owners ?? 0,
    totalFmv: props?.total_fmv ?? 0,
    topOwners,
  };
}
