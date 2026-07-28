import { query, queryOne } from './db';
import {
  onSupplementalSql,
  ownerCountsSql,
  ownerRollCountSql,
  schemaFlags,
} from './schema';
import { isNycZip } from './format';
import { memoize } from './memo';
import type { OwnerSummary } from './types';

/**
 * Aggregates for the leaderboard, borough and ZIP pages.
 *
 * Every figure here is derived from a roll that is loaded once and never
 * written to, so all of it is static for the life of the process and is held by
 * `lib/memo` — see there for why the promise rather than the value is stored,
 * and `resetMemo()` for the test seam. The key space is bounded by the data:
 * one leaderboard, five boroughs, ~240 ZIPs, one ZIP directory.
 */

export const LEADERBOARD_OWNER_LIMIT = 50;
export const LEADERBOARD_PROPERTY_LIMIT = 100;
export const LEADERBOARD_ELIGIBLE_LIMIT = 50;
export const AREA_OWNER_LIMIT = 10;
export const AREA_PROPERTY_LIMIT = 25;

/** A parcel as it appears in a ranked table: value, place and owner of record. */
export type RankedProperty = {
  parid: string;
  address: string;
  boro: number;
  zip_code: string | null;
  fmv: number | null;
  eligible: boolean;
  on_supplemental: boolean;
  owner: string | null;
  owner_norm: string | null;
  owner_display: string | null;
};

/** An owner's holdings *within one borough or ZIP*, not city-wide. */
export type LocalOwner = {
  owner_norm: string;
  display_name: string;
  roll_count: number;
  eligible_count: number;
  roll_fmv: number;
};

/** The three tiers counted over one area, plus the value of the middle tier. */
export type AreaStats = {
  allCount: number;
  rollCount: number;
  eligibleCount: number;
  rollFmv: number;
  /** median FMV across the area's supplemental-roll parcels */
  rollMedianFmv: number | null;
};

const RANKED_COLUMNS = (supp: string) => `p.parid, p.address, p.boro, p.zip_code, p.fmv,
            p.eligible, ${supp} AS on_supplemental, p.owner, p.owner_norm,
            o.display_name AS owner_display`;

type AreaRow = {
  all_count: number;
  roll_count: number;
  eligible_count: number;
  roll_fmv: number | null;
  roll_median: number | null;
};

/**
 * One index-only scan over the area's slice of `properties_boro_zip_fmv`
 * produces all five figures — the FILTERed aggregates cost nothing next to the
 * scan, so the median rides along with the counts instead of being a second
 * pass. `percentile_cont` over a borough's ~380k parcels measured at 88 ms.
 */
function areaStatsSql(supp: string, where: string): string {
  return `SELECT count(*)::int AS all_count,
                 count(*) FILTER (WHERE ${supp})::int AS roll_count,
                 count(*) FILTER (WHERE p.eligible)::int AS eligible_count,
                 COALESCE(sum(p.fmv) FILTER (WHERE ${supp}), 0) AS roll_fmv,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY p.fmv)
                   FILTER (WHERE ${supp} AND p.fmv IS NOT NULL) AS roll_median
            FROM properties p
           WHERE ${where}`;
}

function toAreaStats(row: AreaRow | null): AreaStats | null {
  if (!row || !row.all_count) return null;
  return {
    allCount: row.all_count,
    rollCount: row.roll_count,
    eligibleCount: row.eligible_count,
    rollFmv: row.roll_fmv ?? 0,
    rollMedianFmv: row.roll_median == null ? null : Math.round(row.roll_median),
  };
}

/* ---------------------------------------------------------------- boroughs */

export function getBoroughStats(boro: number): Promise<AreaStats | null> {
  return memoize(`boro:stats:${boro}`, async () => {
    const flags = await schemaFlags();
    const row = await queryOne<AreaRow>(
      areaStatsSql(onSupplementalSql(flags), 'p.boro = $1'),
      [boro],
    );
    return toAreaStats(row);
  });
}

/**
 * Biggest portfolios inside one area. The counts are deliberately local — an
 * owner with 400 parcels city-wide but three in Staten Island is listed here
 * with three, and the link goes to their full portfolio page.
 *
 * The grouping runs first and `owners` is joined to the surviving handful of
 * rows afterwards, because every column the aggregate touches (`owner_norm`,
 * `eligible`, `fmv`) lives in `properties_boro_zip_fmv` and the whole pass is
 * therefore index-only. Joining `owners` up front instead — to pick a display
 * name off the roll — drags 320k heap rows into the join and takes Queens from
 * 136 ms to 566 ms.
 */
function topOwnersSql(supp: string, where: string, lastParam: string): string {
  return `SELECT g.owner_norm,
                 COALESCE(o.display_name, g.owner_norm) AS display_name,
                 g.roll_count, g.eligible_count, g.roll_fmv
            FROM (SELECT p.owner_norm,
                         count(*)::int AS roll_count,
                         count(*) FILTER (WHERE p.eligible)::int AS eligible_count,
                         COALESCE(sum(p.fmv), 0) AS roll_fmv
                    FROM properties p
                   WHERE ${where} AND ${supp} AND p.owner_norm IS NOT NULL
                   GROUP BY p.owner_norm
                   ORDER BY count(*) DESC, COALESCE(sum(p.fmv), 0) DESC, p.owner_norm
                   LIMIT ${lastParam}) g
            LEFT JOIN owners o ON o.owner_norm = g.owner_norm
           ORDER BY g.roll_count DESC, g.roll_fmv DESC, g.owner_norm`;
}

export function getBoroughTopOwners(
  boro: number,
  limit = AREA_OWNER_LIMIT,
): Promise<LocalOwner[]> {
  return memoize(`boro:owners:${boro}:${limit}`, async () => {
    const flags = await schemaFlags();
    return query<LocalOwner>(
      topOwnersSql(onSupplementalSql(flags), 'p.boro = $1', '$2'),
      [boro, limit],
    );
  });
}

export function getBoroughTopProperties(
  boro: number,
  limit = AREA_PROPERTY_LIMIT,
): Promise<RankedProperty[]> {
  return memoize(`boro:props:${boro}:${limit}`, async () => {
    const flags = await schemaFlags();
    const supp = onSupplementalSql(flags);
    return query<RankedProperty>(
      `SELECT ${RANKED_COLUMNS(supp)}
         FROM properties p
         LEFT JOIN owners o ON o.owner_norm = p.owner_norm
        WHERE p.boro = $1 AND ${supp} AND p.fmv IS NOT NULL
        ORDER BY p.fmv DESC, p.parid
        LIMIT $2`,
      [boro, limit],
    );
  });
}

/* -------------------------------------------------------------------- ZIPs */

/** One borough's slice of a ZIP code. Nine ZIPs straddle a borough line. */
export type ZipSlice = {
  zip: string;
  boro: number;
  allCount: number;
  rollCount: number;
  eligibleCount: number;
  rollFmv: number;
};

export type ZipEntry = {
  zip: string;
  /** the borough holding most of the ZIP's parcels — its filed home */
  boro: number;
  /** every borough the ZIP touches, most parcels first */
  boros: number[];
  allCount: number;
  rollCount: number;
  eligibleCount: number;
  rollFmv: number;
};

export type ZipDirectory = {
  /** every valid NYC ZIP present in the roll, keyed by ZIP */
  byZip: Map<string, ZipEntry>;
  /** per-borough ZIP lists, each slice counted *within that borough* */
  byBoro: Map<number, ZipSlice[]>;
  /** ZIPs in ascending order — the sitemap's source of truth */
  zips: string[];
};

/**
 * Every (borough, ZIP) slice in the roll, in one grouped index-only scan
 * (~170 ms). One query backs three things — the borough pages' ZIP lists, the
 * 404 gate on `/zip/[zip]`, and the sitemap — so no page pays for its own.
 *
 * The ZIP filter runs in SQL rather than over the results because the roll
 * carries 20k rows with a literal '0' ZIP plus a scattering of ZIP+4 strings.
 */
export function getZipDirectory(): Promise<ZipDirectory> {
  return memoize('zip:directory', async () => {
    const flags = await schemaFlags();
    const rows = await query<{
      zip_code: string;
      boro: number;
      all_count: number;
      roll_count: number;
      eligible_count: number;
      roll_fmv: number | null;
    }>(
      `SELECT p.zip_code, p.boro,
              count(*)::int AS all_count,
              count(*) FILTER (WHERE ${onSupplementalSql(flags)})::int AS roll_count,
              count(*) FILTER (WHERE p.eligible)::int AS eligible_count,
              COALESCE(sum(p.fmv) FILTER (WHERE ${onSupplementalSql(flags)}), 0) AS roll_fmv
         FROM properties p
        WHERE p.zip_code ~ '^1[01][0-9]{3}$'
        GROUP BY p.zip_code, p.boro
        ORDER BY p.zip_code, count(*) DESC`,
    );

    const byZip = new Map<string, ZipEntry>();
    const byBoro = new Map<number, ZipSlice[]>();

    for (const r of rows) {
      const slice: ZipSlice = {
        zip: r.zip_code,
        boro: r.boro,
        allCount: r.all_count,
        rollCount: r.roll_count,
        eligibleCount: r.eligible_count,
        rollFmv: r.roll_fmv ?? 0,
      };
      const list = byBoro.get(r.boro);
      if (list) list.push(slice);
      else byBoro.set(r.boro, [slice]);

      // Rows arrive ordered by ZIP then parcel count DESC, so the first slice
      // of a ZIP is the borough it is filed under.
      const entry = byZip.get(r.zip_code);
      if (!entry) {
        byZip.set(r.zip_code, { ...slice, boros: [r.boro] });
      } else {
        entry.boros.push(r.boro);
        entry.allCount += slice.allCount;
        entry.rollCount += slice.rollCount;
        entry.eligibleCount += slice.eligibleCount;
        entry.rollFmv += slice.rollFmv;
      }
    }

    for (const list of byBoro.values()) list.sort((a, b) => a.zip.localeCompare(b.zip));
    const zips = [...byZip.keys()].sort();
    return { byZip, byBoro, zips };
  });
}

/** The directory entry for a ZIP, or null — this is the `/zip/[zip]` 404 gate. */
export async function getZipEntry(zip: string): Promise<ZipEntry | null> {
  if (!isNycZip(zip)) return null;
  const { byZip } = await getZipDirectory();
  return byZip.get(zip) ?? null;
}

export function getZipStats(zip: string): Promise<AreaStats | null> {
  return memoize(`zip:stats:${zip}`, async () => {
    const flags = await schemaFlags();
    const row = await queryOne<AreaRow>(
      areaStatsSql(onSupplementalSql(flags), 'p.zip_code = $1'),
      [zip],
    );
    return toAreaStats(row);
  });
}

/**
 * The `boros` argument is not cosmetic. `properties_boro_zip_fmv` leads on
 * `boro`, so a ZIP-only predicate cannot use the index's ordering and the
 * planner falls back to walking `properties_fmv` from the top of the city —
 * 373 ms for a low-value ZIP. Naming the ZIP's boroughs (which the directory
 * already knows) turns it into a bounded index probe: 0.5 ms.
 */
export function getZipTopProperties(
  zip: string,
  boros: readonly number[],
  limit = AREA_PROPERTY_LIMIT,
): Promise<RankedProperty[]> {
  return memoize(`zip:props:${zip}:${limit}`, async () => {
    const flags = await schemaFlags();
    const supp = onSupplementalSql(flags);
    return query<RankedProperty>(
      `SELECT ${RANKED_COLUMNS(supp)}
         FROM properties p
         LEFT JOIN owners o ON o.owner_norm = p.owner_norm
        WHERE p.boro = ANY($1::smallint[]) AND p.zip_code = $2
          AND ${supp} AND p.fmv IS NOT NULL
        ORDER BY p.fmv DESC, p.parid
        LIMIT $3`,
      [[...boros], zip, limit],
    );
  });
}

export function getZipTopOwners(
  zip: string,
  boros: readonly number[],
  limit = AREA_OWNER_LIMIT,
): Promise<LocalOwner[]> {
  return memoize(`zip:owners:${zip}:${limit}`, async () => {
    const flags = await schemaFlags();
    return query<LocalOwner>(
      topOwnersSql(
        onSupplementalSql(flags),
        'p.boro = ANY($1::smallint[]) AND p.zip_code = $2',
        '$3',
      ),
      [[...boros], zip, limit],
    );
  });
}

/* ------------------------------------------------------------ leaderboards */

export type Leaderboards = {
  byRollCount: OwnerSummary[];
  byValue: OwnerSummary[];
  topProperties: RankedProperty[];
  topEligible: RankedProperty[];
};

/**
 * The four ranked tables of `/leaderboards`, fetched in parallel and memoised
 * as one unit. Three of the four are index-ordered top-N reads (`owners_roll_count`,
 * `properties_fmv`); the by-value owner ranking has no index and sorts the
 * 933k-row `owners` table, which measured at 120 ms.
 */
export function getLeaderboards(): Promise<Leaderboards> {
  return memoize('leaderboards', async () => {
    const flags = await schemaFlags();
    const counts = ownerCountsSql(flags);
    const rollCount = ownerRollCountSql(flags);
    const supp = onSupplementalSql(flags);

    const [byRollCount, byValue, topProperties, topEligible] = await Promise.all([
      query<OwnerSummary>(
        `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv, ${counts}
           FROM owners o
          ORDER BY ${rollCount} DESC, o.total_fmv DESC, o.owner_norm
          LIMIT $1`,
        [LEADERBOARD_OWNER_LIMIT],
      ),
      query<OwnerSummary>(
        `SELECT o.owner_norm, o.display_name, o.property_count, o.total_fmv, ${counts}
           FROM owners o
          ORDER BY o.total_fmv DESC, ${rollCount} DESC, o.owner_norm
          LIMIT $1`,
        [LEADERBOARD_OWNER_LIMIT],
      ),
      query<RankedProperty>(
        `SELECT ${RANKED_COLUMNS(supp)}
           FROM properties p
           LEFT JOIN owners o ON o.owner_norm = p.owner_norm
          WHERE p.fmv IS NOT NULL
          ORDER BY p.fmv DESC, p.parid
          LIMIT $1`,
        [LEADERBOARD_PROPERTY_LIMIT],
      ),
      query<RankedProperty>(
        `SELECT ${RANKED_COLUMNS(supp)}
           FROM properties p
           LEFT JOIN owners o ON o.owner_norm = p.owner_norm
          WHERE p.eligible AND p.fmv IS NOT NULL
          ORDER BY p.fmv DESC, p.parid
          LIMIT $1`,
        [LEADERBOARD_ELIGIBLE_LIMIT],
      ),
    ]);

    return { byRollCount, byValue, topProperties, topEligible };
  });
}
