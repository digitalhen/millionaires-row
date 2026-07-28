import { query, queryOne } from './db';
import { onSupplementalSql, schemaFlags, tierSql } from './schema';
import type {
  MapPoint,
  MapTier,
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
/** Size of the uniform (non-eligible) part of the citywide overview sample. */
export const OVERVIEW_LIMIT = 55_000;
export const POINTS_MAX_LIMIT = 120_000;

/**
 * Eligibility — the rule the pipeline used to populate `properties.eligible`,
 * reproduced here for reference only (the app never recomputes it):
 *
 *   tax_class 1x  AND bldg_class Ax, Bx or C0  AND fmv >  $5,000,000
 *   OR bldg_class Rx (condo unit)             AND fmv >= $1,000,000
 *   OR co-op unit (parid contains '-U')       AND fmv >= $1,000,000
 *
 * DOF publishes the roll as "including but not limited to" properties that may
 * be subject to the surcharge, and primary-residence use generally exempts an
 * owner — so the UI always says *may be* subject, never that tax is owed.
 */

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
  const flags = await schemaFlags();

  // Rank: exact match first, then prefix match, then anything containing the
  // term. Ties broken by value (biggest money first) then parid for stability.
  const rows = await query<SearchResult>(
    `SELECT p.parid,
            p.address,
            p.boro,
            p.owner,
            p.owner_norm,
            p.fmv,
            p.eligible,
            ${onSupplementalSql(flags)} AS on_supplemental,
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
  const flags = await schemaFlags();
  const property = await queryOne<Property>(
    `SELECT p.*, ${onSupplementalSql(flags)} AS on_supplemental
       FROM properties p WHERE p.parid = $1`,
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
        `SELECT p.parid, p.address, p.boro, p.tax_class, p.bldg_class, p.fmv,
                p.eligible, ${onSupplementalSql(flags)} AS on_supplemental
           FROM properties p
          WHERE p.owner_norm = $1 AND p.parid <> $2
          ORDER BY p.fmv DESC NULLS LAST, p.parid
          LIMIT 50`,
        [property.owner_norm, parid],
      );
    }
  }

  return { property, owner, otherProperties };
}

export async function getOwner(ownerNorm: string): Promise<OwnerResponse | null> {
  const flags = await schemaFlags();
  const owner = await queryOne<OwnerSummary>(
    `SELECT owner_norm, display_name, property_count, total_fmv
       FROM owners WHERE owner_norm = $1`,
    [ownerNorm],
  );
  if (!owner) return null;

  const properties = await query<PropertyListItem>(
    `SELECT p.parid, p.address, p.boro, p.tax_class, p.bldg_class, p.fmv,
            p.eligible, ${onSupplementalSql(flags)} AS on_supplemental
       FROM properties p
      WHERE p.owner_norm = $1
      ORDER BY p.fmv DESC NULLS LAST, p.parid
      LIMIT $2`,
    [ownerNorm, OWNER_PROPERTY_CAP],
  );

  return {
    owner,
    properties,
    truncated: owner.property_count > properties.length,
  };
}

type PointRow = {
  lng: number;
  lat: number;
  fmv: number | null;
  parid: string;
  tier: number;
};

function toPoints(rows: PointRow[]): MapPoint[] {
  return rows.map((r) => [
    Math.round(r.lng * 1e5) / 1e5,
    Math.round(r.lat * 1e5) / 1e5,
    r.fmv,
    r.parid,
    (r.tier ?? 1) as MapTier,
  ]);
}

/**
 * Deterministic citywide downsample.
 *
 * Two parts, both stable across requests (which is what makes the long cache
 * headers safe):
 *   1. every eligible parcel, so the red marks never pop in and out with zoom;
 *   2. a uniform pseudo-random sample of everything else, ordered by
 *      md5(parid). Uniform — not top-FMV — because a value-weighted sample
 *      makes on-screen density wildly unrepresentative (Staten Island's ~120k
 *      parcels barely registered under the old top-FMV rule).
 */
export async function getOverviewPoints(limit = OVERVIEW_LIMIT): Promise<MapPoint[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || OVERVIEW_LIMIT), POINTS_MAX_LIMIT);
  const flags = await schemaFlags();
  const tier = tierSql(flags);
  const rows = await query<PointRow>(
    `(SELECT p.longitude AS lng, p.latitude AS lat, p.fmv, p.parid, ${tier} AS tier
        FROM properties p
       WHERE p.eligible AND p.longitude IS NOT NULL AND p.latitude IS NOT NULL)
     UNION ALL
     (SELECT p.longitude AS lng, p.latitude AS lat, p.fmv, p.parid, ${tier} AS tier
        FROM properties p
       WHERE NOT p.eligible AND p.longitude IS NOT NULL AND p.latitude IS NOT NULL
       ORDER BY md5(p.parid)
       LIMIT $1)`,
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
  const flags = await schemaFlags();
  const rows = await query<PointRow>(
    `SELECT p.longitude AS lng, p.latitude AS lat, p.fmv, p.parid,
            ${tierSql(flags)} AS tier
       FROM properties p
      WHERE p.longitude BETWEEN $1 AND $3
        AND p.latitude BETWEEN $2 AND $4
      ORDER BY ${tierSql(flags)} DESC, p.fmv DESC NULLS LAST, p.parid
      LIMIT $5`,
    [minLng, minLat, maxLng, maxLat, lim],
  );
  return toPoints(rows);
}

export async function getStats(): Promise<StatsResponse> {
  const flags = await schemaFlags();
  const [props, owners, topOwners] = await Promise.all([
    queryOne<{
      properties: number;
      with_coords: number;
      total_fmv: number | null;
      eligible_count: number;
      eligible_fmv: number | null;
      supplemental_count: number;
    }>(
      `SELECT count(*)::int AS properties,
              count(p.longitude)::int AS with_coords,
              COALESCE(sum(p.fmv), 0) AS total_fmv,
              count(*) FILTER (WHERE p.eligible)::int AS eligible_count,
              COALESCE(sum(p.fmv) FILTER (WHERE p.eligible), 0) AS eligible_fmv,
              count(*) FILTER (WHERE ${onSupplementalSql(flags)})::int AS supplemental_count
         FROM properties p`,
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
    supplementalCount: props?.supplemental_count ?? 0,
    eligibleCount: props?.eligible_count ?? 0,
    eligibleFmv: props?.eligible_fmv ?? 0,
    topOwners,
  };
}
