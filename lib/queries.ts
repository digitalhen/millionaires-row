import { query, queryOne } from './db';
import { onSupplementalSql, ownerCountsSql, schemaFlags, tierSql } from './schema';
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
/**
 * Size of the uniform (non-eligible) part of the citywide overview sample.
 * Plus the ~29k always-included eligible parcels this lands at ~105k points:
 * 4.6MB of JSON, 1.4MB over the wire gzipped, fetched once and cached hard.
 * That is the ceiling worth paying — past it the marks overlap so heavily that
 * extra points add no visible density, only bytes and a slower first paint.
 */
export const OVERVIEW_LIMIT = 76_000;
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
  // NUL is rejected by Postgres as a text parameter, which turned `?q=PARK%00`
  // into a 500; strip before anything else so it degrades to a normal search.
  return raw.replace(/\0/g, '').trim().replace(/\s+/g, ' ').toUpperCase();
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
  // Postgres rejects a bare constant in ORDER BY, so on the pre-city-roll
  // schema — where "on the supplemental roll" degrades to the literal `true` —
  // the term is dropped instead: every parcel is on the roll there anyway.
  const suppOrder = flags.hasOnSupplemental ? 'p.on_supplemental DESC,' : '';

  /**
   * Rank, in order:
   *
   *  1. match quality — exact, then prefix, then anything containing the term;
   *  2. on the supplemental roll, then not — the roll is what this site is
   *     about, so at equal match quality a roll parcel outranks a city-only
   *     one ("PARK AVENUE" used to return a page of NYCHA/DCAS/Parks slivers);
   *  3. matches DOF's surcharge criteria, then not (`eligible` is a strict
   *     subset of `on_supplemental`, so this only sorts inside the roll);
   *  4. DOF value, biggest money first, then parid for a stable page 2.
   *
   * The address arms of the quality CASE require the parcel to carry a house
   * number. ~27,800 rows are street beds and slivers filed under a bare street
   * name ("PARK AVENUE", "5 AVENUE"), 96% of them city-owned and off the roll;
   * counting those as an *exact address match* is what put 47 untitled lots
   * above every building on the avenue. A parcel with no house number is not a
   * building, so it ranks as a plain containment match. Owner matching is
   * untouched, which is what keeps `DCAS`, `TRUMP` and `WINTOUR` exact-first.
   */
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
                 WHEN p.owner_norm = $2 THEN 0
                 WHEN p.address = $2 AND COALESCE(p.housenum_lo, '') <> '' THEN 0
                 WHEN p.address ILIKE $3 ESCAPE '\\'
                      AND COALESCE(p.housenum_lo, '') <> '' THEN 1
                 WHEN p.owner_norm ILIKE $3 ESCAPE '\\' THEN 2
                 ELSE 3
               END,
               ${suppOrder}
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
      `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv,
              ${ownerCountsSql(flags)}
         FROM owners o WHERE o.owner_norm = $1`,
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
    `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv,
            ${ownerCountsSql(flags)}
       FROM owners o WHERE o.owner_norm = $1`,
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

/** The few fields the social card and the page metadata need — one round trip,
 *  no owner portfolio, no full row. */
export type PropertyCard = {
  parid: string;
  address: string;
  boro: number;
  zip_code: string | null;
  block: number;
  lot: number;
  tax_class: string;
  bldg_class: string | null;
  fmv: number | null;
  owner: string | null;
  owner_norm: string | null;
  eligible: boolean;
  on_supplemental: boolean;
  owner_display: string | null;
  property_count: number;
};

export async function getPropertyCard(parid: string): Promise<PropertyCard | null> {
  const flags = await schemaFlags();
  return queryOne<PropertyCard>(
    `SELECT p.parid, p.address, p.boro, p.zip_code, p.block, p.lot,
            p.tax_class, p.bldg_class, p.fmv, p.owner, p.owner_norm, p.eligible,
            ${onSupplementalSql(flags)} AS on_supplemental,
            o.display_name AS owner_display,
            COALESCE(o.property_count, 1)::int AS property_count
       FROM properties p
       LEFT JOIN owners o ON o.owner_norm = p.owner_norm
      WHERE p.parid = $1`,
    [parid],
  );
}

export async function getOwnerCard(ownerNorm: string): Promise<OwnerSummary | null> {
  const flags = await schemaFlags();
  return queryOne<OwnerSummary>(
    `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv,
            ${ownerCountsSql(flags)}
       FROM owners o WHERE o.owner_norm = $1`,
    [ownerNorm],
  );
}

/** Sitemap size: the roll has ~1M parcels, which is pointless to submit. Only
 *  the highest-value parcels and the largest portfolios are listed. */
export const SITEMAP_PROPERTY_LIMIT = 20_000;
export const SITEMAP_OWNER_LIMIT = 5_000;

/** Top parcels by DOF value. `fmv IS NOT NULL` keeps this on the
 *  `properties (fmv DESC)` index instead of sorting the whole table. */
export async function getTopPropertyIds(limit = SITEMAP_PROPERTY_LIMIT): Promise<string[]> {
  const flags = await schemaFlags();
  const rows = await query<{ parid: string }>(
    `SELECT p.parid
       FROM properties p
      WHERE p.fmv IS NOT NULL AND ${onSupplementalSql(flags)}
      ORDER BY p.fmv DESC
      LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
  return rows.map((r) => r.parid);
}

/** Largest portfolios — uses the `owners (property_count DESC)` index. */
export async function getTopOwnerIds(limit = SITEMAP_OWNER_LIMIT): Promise<string[]> {
  const rows = await query<{ owner_norm: string }>(
    `SELECT owner_norm
       FROM owners
      ORDER BY property_count DESC, total_fmv DESC
      LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
  return rows.map((r) => r.owner_norm);
}

/** Headline figures for the default social card. Deliberately narrower (and
 *  cheaper) than getStats(): three aggregates over `properties`, no join. */
export type HeadlineStats = {
  rollCount: number;
  rollFmv: number;
  eligibleCount: number;
};

export async function getHeadlineStats(): Promise<HeadlineStats | null> {
  const flags = await schemaFlags();
  const supp = onSupplementalSql(flags);
  const row = await queryOne<{
    roll_count: number;
    roll_fmv: number | null;
    eligible_count: number;
  }>(
    `SELECT count(*) FILTER (WHERE ${supp})::int AS roll_count,
            COALESCE(sum(p.fmv) FILTER (WHERE ${supp}), 0) AS roll_fmv,
            count(*) FILTER (WHERE p.eligible)::int AS eligible_count
       FROM properties p`,
  );
  if (!row || !row.roll_count) return null;
  return {
    rollCount: row.roll_count,
    rollFmv: row.roll_fmv ?? 0,
    eligibleCount: row.eligible_count,
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
 *   2. a uniform pseudo-random sample of everything else — all ~1.17M
 *      remaining parcels across both the supplemental roll and the wider city
 *      assessment roll — ordered by md5(parid). Uniform, not top-FMV, because a
 *      value-weighted sample makes on-screen density wildly unrepresentative
 *      (Staten Island's ~120k parcels barely registered under the old rule) and
 *      because sampling the tiers at one rate is what makes the grey/white
 *      contrast on the map an honest picture of how much of the city is on the
 *      roll: each tier keeps its true share of the marks.
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

/**
 * Parcels inside the current viewport, shaped exactly like the citywide
 * overview: every eligible parcel, then a uniform md5(parid) sample of the
 * rest. Zooming past DETAIL_ZOOM therefore swaps one point set for another
 * without the mix of tiers changing character.
 *
 * The uniform sample matters most here. Ranking the remainder by FMV — or, as
 * an earlier cut did, by tier — meant a capped viewport over Staten Island
 * returned 40,000 white parcels and *zero* grey ones, so the background tier
 * silently vanished at exactly the zoom where it should start to be legible.
 */
export async function getPointsInBbox(
  minLng: number,
  minLat: number,
  maxLng: number,
  maxLat: number,
  limit = 20_000,
): Promise<MapPoint[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || 20_000), POINTS_MAX_LIMIT);
  const flags = await schemaFlags();
  const tier = tierSql(flags);
  const box = `p.longitude BETWEEN $1 AND $3 AND p.latitude BETWEEN $2 AND $4`;
  const rows = await query<PointRow>(
    `(SELECT p.longitude AS lng, p.latitude AS lat, p.fmv, p.parid, ${tier} AS tier
        FROM properties p
       WHERE ${box} AND p.eligible)
     UNION ALL
     (SELECT p.longitude AS lng, p.latitude AS lat, p.fmv, p.parid, ${tier} AS tier
        FROM properties p
       WHERE ${box} AND NOT p.eligible
       ORDER BY md5(p.parid)
       LIMIT $5)`,
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
      supplemental_fmv: number | null;
    }>(
      // One pass over `properties` produces all three tiers' counts and FMV
      // sums; the FILTER clauses are free next to the scan itself.
      `SELECT count(*)::int AS properties,
              count(p.longitude)::int AS with_coords,
              COALESCE(sum(p.fmv), 0) AS total_fmv,
              count(*) FILTER (WHERE p.eligible)::int AS eligible_count,
              COALESCE(sum(p.fmv) FILTER (WHERE p.eligible), 0) AS eligible_fmv,
              count(*) FILTER (WHERE ${onSupplementalSql(flags)})::int AS supplemental_count,
              COALESCE(sum(p.fmv) FILTER (WHERE ${onSupplementalSql(flags)}), 0) AS supplemental_fmv
         FROM properties p`,
    ),
    queryOne<{ owners: number; multi_owners: number }>(
      `SELECT count(*)::int AS owners,
              count(*) FILTER (WHERE property_count > 1)::int AS multi_owners
         FROM owners`,
    ),
    query<OwnerSummary>(
      `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv,
              ${ownerCountsSql(flags)}
         FROM owners o
        ORDER BY o.property_count DESC, o.total_fmv DESC, o.owner_norm
        LIMIT 20`,
    ),
  ]);

  const allProperties = props?.properties ?? 0;
  return {
    allProperties,
    properties: allProperties,
    withCoords: props?.with_coords ?? 0,
    owners: owners?.owners ?? 0,
    multiOwners: owners?.multi_owners ?? 0,
    totalFmv: props?.total_fmv ?? 0,
    supplementalCount: props?.supplemental_count ?? 0,
    supplementalFmv: props?.supplemental_fmv ?? 0,
    eligibleCount: props?.eligible_count ?? 0,
    eligibleFmv: props?.eligible_fmv ?? 0,
    topOwners,
  };
}
