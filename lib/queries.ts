import { query, queryOne } from './db';
import { memoize } from './memo';
import {
  onSupplementalSql,
  ownerCountsSql,
  schemaFlags,
  type SchemaFlags,
} from './schema';
import type {
  BuildingBlock,
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
/**
 * Deepest page anyone may ask for. Postgres has to walk and discard every
 * skipped row, so an unbounded `offset` is a free way to turn a 40ms query into
 * a full sort of the match set; the UI never pages past the count cap anyway.
 */
export const SEARCH_MAX_OFFSET = 10_000;
/** Exact counts are capped so a query like "STREET" cannot cost a full scan. */
export const SEARCH_COUNT_CAP = 10_000;
export const OWNER_PROPERTY_CAP = 500;
/**
 * Units listed under "in this building". The biggest sibling set on the roll is
 * a 3,858-unit condominium; past a couple of hundred rows the section is a phone
 * book rather than context, and every row is a link the page has to render.
 */
export const BUILDING_UNIT_CAP = 200;
/**
 * Size of the uniform (non-red) part of the citywide overview sample.
 *
 * ~100k marks is the ceiling worth paying: past it they overlap so heavily that
 * extra points add no visible density, only bytes and a slower first paint. The
 * number that gets us there moved when the map switched from one dot per roll
 * record to one dot per *building* — consolidation turned 1.20M parcels into
 * 864k dots and, more to the point, 29k eligible parcels into 9,884 red dots.
 * Holding the old 76,000 would have quietly spent a fifth of the budget, so the
 * uniform sample takes the freed room instead: 90,000 + 9,884 = 99,884 marks,
 * the same picture at the same cost. (Taking all 864k dots is never cheaper —
 * it is 8.6x the payload for pixels that are already covered.)
 */
export const OVERVIEW_LIMIT = 90_000;
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
  const off = Math.min(Math.max(0, Math.floor(offset) || 0), SEARCH_MAX_OFFSET);
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
   * The page of results and the capped total are independent queries over the
   * same filter, and they were being awaited one after the other — so every
   * search paid both round trips end to end. Issued together they overlap, and
   * a search costs about what its slower half costs. Under saturation this is
   * a wash (the pool, not the wire, is the constraint), but that is not the
   * case anyone types into the box from.
   */
  const [rows, counted] = await Promise.all([
    /**
     * Rank, in order:
     *
     *  1. match quality — exact, then prefix, then anything containing the term;
     *  2. on the supplemental roll, then not — the roll is what this site is
     *     about, so at equal match quality a roll parcel outranks a city-only
     *     one ("PARK AVENUE" used to return a page of NYCHA/DCAS/Parks slivers);
     *  3. DOF value, biggest money first, then parid for a stable page 2.
     *
     * The address arms of the quality CASE require the parcel to carry a house
     * number. ~27,800 rows are street beds and slivers filed under a bare street
     * name ("PARK AVENUE", "5 AVENUE"), 96% of them city-owned and off the roll;
     * counting those as an *exact address match* is what put 47 untitled lots
     * above every building on the avenue. A parcel with no house number is not a
     * building, so it ranks as a plain containment match. Owner matching is
     * untouched, which is what keeps `DCAS`, `TRUMP` and `WINTOUR` exact-first.
     */
    query<SearchResult>(
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
    ),
    queryOne<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM (SELECT 1 FROM properties p WHERE ${where} LIMIT $2) s`,
      [contains, SEARCH_COUNT_CAP + 1],
    ),
  ]);

  const raw = counted?.n ?? 0;
  return {
    results: rows,
    total: Math.min(raw, SEARCH_COUNT_CAP),
    totalCapped: raw > SEARCH_COUNT_CAP,
  };
}

/**
 * "In this building" — the parcels stacked on the same map point as this one.
 *
 * Two arms, unioned:
 *   • same BBL, which gathers a co-op's building record and its `-U####` unit
 *     rows (they all carry the building's BBL);
 *   • same (boro, block, condo_number), which gathers a condominium, whose
 *     units are each their own BBL.
 * Both are index lookups — `properties_bbl` and `properties_boro_block_condo`
 * (scripts/building_indexes.sql) — combined by a BitmapOr. The second arm is
 * only added when the parcel actually carries a condo number, so a standalone
 * house costs exactly one BBL probe returning one row: itself.
 *
 * The building record is found without parsing `parid`, which is opaque: group
 * the siblings by BBL and take the BBL that holds both a plain row and at least
 * one `-U` row. That is a single hash aggregate, where the obvious correlated
 * "does a child exist" test degrades to O(n²) and cost 17ms on a 651-unit
 * condominium. Ties prefer the viewed parcel's own BBL, so a co-op unit always
 * resolves to its own building rather than to a neighbour in the same condo.
 */
async function getBuilding(
  property: Property,
  flags: SchemaFlags,
): Promise<BuildingBlock | undefined> {
  const params: unknown[] = [property.bbl];
  let siblings = 'p.bbl = $1';
  if (property.condo_number) {
    params.push(property.boro, property.block, property.condo_number);
    siblings = '(p.bbl = $1 OR (p.boro = $2 AND p.block = $3 AND p.condo_number = $4))';
  }

  const summary = await queryOne<{
    n: number;
    building_parid: string | null;
    record_units: number;
  }>(
    `WITH sib AS (SELECT p.parid, p.bbl FROM properties p WHERE ${siblings}),
          bld AS (
            SELECT g.parid, g.units
              FROM (SELECT s.bbl,
                           min(s.parid) FILTER (WHERE position('-U' in s.parid) = 0) AS parid,
                           count(*) FILTER (WHERE position('-U' in s.parid) > 0) AS units
                      FROM sib s
                     GROUP BY s.bbl) g
             WHERE g.parid IS NOT NULL AND g.units > 0
             ORDER BY (g.bbl = $1) DESC, g.units DESC, g.parid
             LIMIT 1
          )
     SELECT (SELECT count(*)::int FROM sib) AS n,
            (SELECT parid FROM bld) AS building_parid,
            COALESCE((SELECT units FROM bld), 0)::int AS record_units`,
    params,
  );

  // Only this parcel sits on the point — the standalone case, and the reason
  // the block is optional rather than an empty object on every property page.
  const total = summary?.n ?? 0;
  if (total < 2) return undefined;

  const buildingParid = summary?.building_parid ?? null;
  const isBuildingRecord = buildingParid === property.parid;
  // The building record is listed once, as the section's header line, so it is
  // kept out of the unit table along with the parcel being viewed.
  const skip = [property.parid];
  if (buildingParid && !isBuildingRecord) skip.push(buildingParid);
  const unitCount = Math.max(0, total - skip.length);

  const cols = `p.parid, p.address, p.boro, p.tax_class, p.bldg_class, p.aptno, p.fmv,
                p.eligible, ${onSupplementalSql(flags)} AS on_supplemental`;

  const [units, buildingRow] = await Promise.all([
    unitCount === 0
      ? Promise.resolve([] as PropertyListItem[])
      : query<PropertyListItem>(
          `SELECT ${cols}
             FROM properties p
            WHERE ${siblings} AND p.parid <> ALL($${params.length + 1}::text[])
            ORDER BY p.fmv DESC NULLS LAST, p.parid
            LIMIT $${params.length + 2}`,
          [...params, skip, BUILDING_UNIT_CAP],
        ),
    buildingParid && !isBuildingRecord
      ? queryOne<PropertyListItem>(
          `SELECT ${cols} FROM properties p WHERE p.parid = $1`,
          [buildingParid],
        )
      : Promise.resolve(null),
  ]);

  return {
    // Viewing the building record itself: it is already in hand, no round trip.
    buildingRecord: isBuildingRecord ? toListItem(property) : buildingRow,
    isBuildingRecord,
    recordUnitCount: buildingParid ? (summary?.record_units ?? 0) : 0,
    unitCount,
    units,
    truncated: units.length < unitCount,
  };
}

function toListItem(p: Property): PropertyListItem {
  return {
    parid: p.parid,
    address: p.address,
    boro: p.boro,
    tax_class: p.tax_class,
    bldg_class: p.bldg_class,
    aptno: p.aptno,
    fmv: p.fmv,
    eligible: p.eligible,
    on_supplemental: p.on_supplemental,
  };
}

/** The owner of record and the rest of their portfolio. */
async function getOwnerContext(
  property: Property,
  flags: SchemaFlags,
): Promise<{ owner: OwnerSummary | null; otherProperties: PropertyListItem[] }> {
  if (!property.owner_norm) return { owner: null, otherProperties: [] };

  const owner = await queryOne<OwnerSummary>(
    `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv,
            ${ownerCountsSql(flags)}
       FROM owners o WHERE o.owner_norm = $1`,
    [property.owner_norm],
  );
  if (!owner || owner.property_count <= 1) return { owner, otherProperties: [] };

  const otherProperties = await query<PropertyListItem>(
    `SELECT p.parid, p.address, p.boro, p.tax_class, p.bldg_class, p.fmv,
            p.eligible, ${onSupplementalSql(flags)} AS on_supplemental
       FROM properties p
      WHERE p.owner_norm = $1 AND p.parid <> $2
      ORDER BY p.fmv DESC NULLS LAST, p.parid
      LIMIT 50`,
    [property.owner_norm, property.parid],
  );
  return { owner, otherProperties };
}

export async function getProperty(parid: string): Promise<PropertyResponse | null> {
  const flags = await schemaFlags();
  const property = await queryOne<Property>(
    `SELECT p.*, ${onSupplementalSql(flags)} AS on_supplemental
       FROM properties p WHERE p.parid = $1`,
    [parid],
  );
  if (!property) return null;

  // Independent of each other, so the round trips overlap: the building lookup
  // costs a standalone parcel nothing it was not already waiting on.
  const [{ owner, otherProperties }, building] = await Promise.all([
    getOwnerContext(property, flags),
    getBuilding(property, flags),
  ]);

  return { property, owner, otherProperties, building };
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

/** Headline figures for the default social card — one figure per tier of the
 *  three-tier story. Deliberately narrower (and cheaper) than getStats(): four
 *  aggregates in a single pass over `properties`, no join. */
export type HeadlineStats = {
  /** Every parcel in the city, on the roll or not. */
  allCount: number;
  rollCount: number;
  rollFmv: number;
  eligibleCount: number;
};

export function getHeadlineStats(): Promise<HeadlineStats | null> {
  return memoize('headlineStats', async () => {
    const flags = await schemaFlags();
    const supp = onSupplementalSql(flags);
    const row = await queryOne<{
      all_count: number;
      roll_count: number;
      roll_fmv: number | null;
      eligible_count: number;
    }>(
      `SELECT count(*)::int AS all_count,
              count(*) FILTER (WHERE ${supp})::int AS roll_count,
              COALESCE(sum(p.fmv) FILTER (WHERE ${supp}), 0) AS roll_fmv,
              count(*) FILTER (WHERE p.eligible)::int AS eligible_count
         FROM properties p`,
    );
    if (!row || !row.roll_count) return null;
    return {
      allCount: row.all_count,
      rollCount: row.roll_count,
      rollFmv: row.roll_fmv ?? 0,
      eligibleCount: row.eligible_count,
    };
  });
}

type PointRow = {
  lng: number;
  lat: number;
  fmv: number | null;
  parid: string;
  tier: number;
  members: number | null;
};

function toPoints(rows: PointRow[]): MapPoint[] {
  return rows.map((r) => [
    Math.round(r.lng * 1e5) / 1e5,
    Math.round(r.lat * 1e5) / 1e5,
    r.fmv,
    r.parid,
    (r.tier ?? 1) as MapTier,
    r.members ?? 1,
  ]);
}

/**
 * Both map queries read `map_dots`, one row per building rather than per roll
 * record (scripts/build_map_dots.sh). Consolidation is what the map is *for*:
 * 1 Irving Place used to be 651 identical red marks on one coordinate — 651
 * points serialised, drawn and hit-tested to render a single dot — and 11,671
 * such stacks between them hid how few buildings the surcharge tier actually
 * covers. Collapsing them cut 1.20M parcels to 864k dots and, in the tier that
 * matters, 29k eligible parcels to 9,884 red buildings. Every field the map
 * needs is precomputed there, so neither query joins, filters on `eligible`, or
 * needs `schemaFlags()`: `map_dots.tier` already carries the three-tier rule.
 *
 * Sampling hash: `hashtext`, not `md5`. Both are deterministic (which is what
 * makes the long cache headers safe) and both are uniform over parids; md5
 * hashes into a 32-byte hex string and then sorts 854k of them, where hashtext
 * sorts int4s. On the citywide overview that is 342ms against 65ms.
 */

/**
 * Deterministic citywide downsample.
 *
 * Two parts:
 *   1. every tier-2 dot — all 9,884 of them — so the red marks never pop in and
 *      out with zoom;
 *   2. a uniform pseudo-random sample of everything else, across both the
 *      supplemental roll and the wider city assessment roll. Uniform, not
 *      top-FMV, because a value-weighted sample makes on-screen density wildly
 *      unrepresentative (Staten Island's ~120k parcels barely registered under
 *      the old rule) and because sampling the tiers at one rate is what makes
 *      the grey/white contrast an honest picture of how much of the city is on
 *      the roll: each tier keeps its true share of the marks.
 */
export async function getOverviewPoints(limit = OVERVIEW_LIMIT): Promise<MapPoint[]> {
  const lim = Math.min(Math.max(1, Math.floor(limit) || OVERVIEW_LIMIT), POINTS_MAX_LIMIT);
  const rows = await query<PointRow>(
    `(SELECT d.longitude AS lng, d.latitude AS lat, d.fmv, d.parid,
             d.tier, d.member_count AS members
        FROM map_dots d
       WHERE d.tier = 2)
     UNION ALL
     (SELECT d.longitude AS lng, d.latitude AS lat, d.fmv, d.parid,
             d.tier, d.member_count AS members
        FROM map_dots d
       WHERE d.tier <> 2
       ORDER BY hashtext(d.parid)
       LIMIT $1)`,
    [lim],
  );
  return toPoints(rows);
}

/**
 * Dots inside the current viewport, shaped exactly like the citywide overview:
 * every tier-2 dot, then a uniform hashtext(parid) sample of the rest. Zooming
 * past DETAIL_ZOOM therefore swaps one point set for another without the mix of
 * tiers changing character.
 *
 * The uniform sample matters most here. Ranking the remainder by FMV — or, as
 * an earlier cut did, by tier — meant a capped viewport over Staten Island
 * returned 40,000 white dots and *zero* grey ones, so the background tier
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
  const box = `d.longitude BETWEEN $1 AND $3 AND d.latitude BETWEEN $2 AND $4`;
  const cols = `d.longitude AS lng, d.latitude AS lat, d.fmv, d.parid,
                d.tier, d.member_count AS members`;
  const rows = await query<PointRow>(
    `(SELECT ${cols} FROM map_dots d WHERE ${box} AND d.tier = 2)
     UNION ALL
     (SELECT ${cols} FROM map_dots d
       WHERE ${box} AND d.tier <> 2
       ORDER BY hashtext(d.parid)
       LIMIT $5)`,
    [minLng, minLat, maxLng, maxLat, lim],
  );
  return toPoints(rows);
}

/**
 * Site-wide figures for the home page and `/api/stats`.
 *
 * Three full aggregate passes over 1.2M rows — ~600ms, and the home page is the
 * front door, so this used to be re-run for every visitor. The roll is read-only
 * for the life of the process, so it is computed once instead; under load that
 * moved the home page from 34 to well over a thousand renders a second.
 */
export function getStats(): Promise<StatsResponse> {
  return memoize('stats', computeStats);
}

async function computeStats(): Promise<StatsResponse> {
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
