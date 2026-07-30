#!/usr/bin/env bash
# Build map_dots: one map dot per building/parcel group.
#
# Stacked records collapse into a single dot:
#   - condo rows (condo_number set, unit lot or R-class) group by
#     (boro, block, condo_number) — the whole development is one dot at its
#     modal coordinate, so 1 Irving Place's 651 units become one dot and a
#     stray-geocoded billing lot cannot spawn a phantom twin;
#   - co-op '-U' unit rows group with their parent building record by bbl;
#   - everything else is its own dot.
#
# Dot fields: representative parid (co-op parent first — clicking a building
# should open the building record where one exists — then eligible members, so
# a red CONDO dot opens a flagged home rather than the tower's biggest
# commercial unit, then max FMV), tier (red if ANY member eligible, else white
# if any on the supplemental roll, else grey), display fmv (co-op parent
# aggregate, else member sum), member count, eligible member count.
#
# Run AFTER import/import_avroll/geocode. Idempotent. MROW_DB overrides db.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${MROW_DB:-mrow}"
PSQL=(docker exec -i mrow-postgres psql -v ON_ERROR_STOP=1 -U mrow)

"${PSQL[@]}" -d "$DB" <<'SQL'
SET max_parallel_workers_per_gather = 0;

DROP TABLE IF EXISTS map_dots;
CREATE TABLE map_dots AS
WITH
-- One condominium = one dot. A condo's rows are geocoded inconsistently —
-- units on one point, the R0 billing lot a few metres off (403 Greenwich's
-- sat 8m away, spawning a phantom second dot for the same building), 5,951
-- condos split across two or more coordinates. The app's own "in this
-- building" block already treats the whole condo as one building, so the map
-- says the same: every member maps to the development's modal coordinate.
condo_modal AS (
  SELECT boro, block, condo_number, longitude AS mlng, latitude AS mlat
    FROM (SELECT p.boro, p.block, p.condo_number, p.longitude, p.latitude,
                 row_number() OVER (PARTITION BY p.boro, p.block, p.condo_number
                                    ORDER BY count(*) DESC, p.longitude, p.latitude) AS rk
            FROM properties p
           WHERE p.condo_number IS NOT NULL AND p.longitude IS NOT NULL
           GROUP BY 1, 2, 3, 4, 5) g
   WHERE rk = 1
),
members AS (
  SELECT p.*,
    COALESCE(m.mlng, p.longitude) AS glng,
    COALESCE(m.mlat, p.latitude) AS glat,
    p.parid NOT LIKE '%-U%'
      AND EXISTS (SELECT 1 FROM properties c
                   WHERE c.bbl = p.bbl AND c.parid LIKE p.parid || '-U%')
      AS is_coop_parent,
    -- A parent whose own apartments include a flagged one: the record a red
    -- dot should open, since its page lists those apartments with their red
    -- marks. Distinct from is_coop_parent for "condop" groups, where several
    -- parents and commercial units share one 'C:' group and only one co-op's
    -- units are flagged.
    p.parid NOT LIKE '%-U%'
      AND EXISTS (SELECT 1 FROM properties c
                   WHERE c.bbl = p.bbl AND c.parid LIKE p.parid || '-U%'
                     AND c.eligible)
      AS is_parent_of_flagged,
    CASE
      -- Unit lots start at 1001 on modern condos, but pre-1980s conversions
      -- numbered units below that (340 E 64 St runs 201-950), which left 510
      -- units outside their building's group — a 123-dot stack on one pixel.
      -- An R-class row with a condo number is a condo unit whatever its lot.
      WHEN p.condo_number IS NOT NULL
           AND (p.lot >= 1001 OR upper(trim(COALESCE(p.bldg_class, ''))) LIKE 'R%')
        THEN 'C:' || p.boro || ':' || p.block || ':' || p.condo_number
      WHEN p.parid LIKE '%-U%'
        OR EXISTS (SELECT 1 FROM properties c
                    WHERE c.bbl = p.bbl AND c.parid LIKE p.parid || '-U%')
        THEN 'B:' || p.bbl
      ELSE 'P:' || p.parid
    END AS gid
  FROM properties p
  LEFT JOIN condo_modal m
    ON m.boro = p.boro AND m.block = p.block AND m.condo_number = p.condo_number
  WHERE p.longitude IS NOT NULL
)
SELECT
  gid,
  -- What a click opens, in order of preference:
  --   1. a co-op parent whose own apartments carry the flag — the building
  --      page, with the red rows in its list ("31 MERCER STREET", not
  --      "APT 5A"; also the right pick for condop 'C:' groups, where the
  --      naive non-unit-first order used to surface a commercial unit);
  --   2. an eligible member — a red CONDO dot (no parent row) must open a
  --      record that is itself flagged, not the tower's biggest office suite;
  --   3. any co-op parent (white co-op dots open their building);
  --   4. biggest FMV, then parid for determinism.
  (array_agg(parid ORDER BY is_parent_of_flagged DESC, eligible DESC,
             is_coop_parent DESC, fmv DESC NULLS LAST, parid))[1]
    AS parid,
  (array_agg(glng ORDER BY is_parent_of_flagged DESC, eligible DESC,
             is_coop_parent DESC, fmv DESC NULLS LAST, parid))[1]
    AS longitude,
  (array_agg(glat ORDER BY is_parent_of_flagged DESC, eligible DESC,
             is_coop_parent DESC, fmv DESC NULLS LAST, parid))[1]
    AS latitude,
  CASE WHEN bool_or(eligible) THEN 2
       WHEN bool_or(on_supplemental) THEN 1
       ELSE 0 END AS tier,
  -- Co-op '-U' unit values are already aggregated inside their parent
  -- building record's fmv, so counting both double-counts; parents always
  -- share their units' group. Sum only non-unit rows (a group that is ONLY
  -- units, with no parent — doesn't occur — would fall back to the unit sum).
  COALESCE(sum(fmv) FILTER (WHERE parid NOT LIKE '%-U%'), sum(fmv)) AS fmv,
  -- Counted the way a reader counts: apartments/units, not roll records. The
  -- co-op parent is the building, not a unit, and a condominium's R0 billing
  -- lot is an administrative row — a 2-apartment co-op used to read "2 of 3
  -- may be subject" because its own building record made the 3. The fallback
  -- to 1 covers a group that is nothing but such rows (a lone R0 dot).
  GREATEST(count(*) FILTER (WHERE NOT is_coop_parent
             AND upper(trim(COALESCE(bldg_class, ''))) <> 'R0'), 1)::int
    AS member_count,
  -- How many members are themselves flagged. The tooltip needs it: a red dot
  -- over an 865-unit tower where 4 units qualify must not read as the whole
  -- building's valuation being flagged.
  count(*) FILTER (WHERE eligible)::int AS eligible_count
FROM members
GROUP BY gid;

-- NOTE on colliding coordinates: distinct buildings are sometimes geocoded to
-- the IDENTICAL point (2,600+ collisions; one Battery Park City pixel holds
-- 11 red towers). The dots deliberately stay at their true shared coordinate
-- — displacing them read as dots on the wrong buildings. The client makes the
-- stack navigable instead: hover names the strongest dot and counts the rest,
-- click opens the strongest and lists every building at the point.
ALTER TABLE map_dots ADD PRIMARY KEY (gid);
CREATE INDEX map_dots_geo ON map_dots (longitude, latitude);
CREATE INDEX map_dots_fmv ON map_dots (fmv DESC NULLS LAST);
CREATE INDEX map_dots_tier ON map_dots (tier) WHERE tier = 2;
ANALYZE map_dots;

SELECT count(*) AS dots,
       count(*) FILTER (WHERE tier = 2) AS red,
       count(*) FILTER (WHERE member_count > 1) AS consolidated,
       max(member_count) AS biggest
FROM map_dots;
SQL
echo "build_map_dots complete for $DB"
