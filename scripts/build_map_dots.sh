#!/usr/bin/env bash
# Build map_dots: one map dot per building/parcel group.
#
# Stacked records collapse into a single dot:
#   - condo units (condo_number set, lot >= 1001) group by
#     (boro, block, condo_number, coords) — every unit shares the building's
#     billing-lot coordinate, so 1 Irving Place's 651 units become one dot;
#   - co-op '-U' unit rows group with their parent building record by bbl;
#   - everything else is its own dot.
#
# Dot fields: representative parid (eligible member preferred — a red dot must
# open a record that is itself flagged — then co-op parent, then max FMV
# member), tier (red if ANY member eligible, else white if any on the
# supplemental roll, else grey), display fmv (co-op parent aggregate, else
# member sum), member count, eligible member count.
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
WITH members AS (
  SELECT p.*,
    CASE
      WHEN p.condo_number IS NOT NULL AND p.lot >= 1001
        THEN 'C:' || p.boro || ':' || p.block || ':' || p.condo_number || ':'
             || p.longitude || ':' || p.latitude
      WHEN p.parid LIKE '%-U%'
        OR EXISTS (SELECT 1 FROM properties c
                    WHERE c.bbl = p.bbl AND c.parid LIKE p.parid || '-U%')
        THEN 'B:' || p.bbl
      ELSE 'P:' || p.parid
    END AS gid
  FROM properties p
  WHERE p.longitude IS NOT NULL
)
SELECT
  gid,
  -- Eligible members first: 1,423 red dots used to open a not-eligible record
  -- (the group's biggest member is often a commercial condo unit), which read
  -- as the map flagging something the record then denied. For tier<2 groups
  -- the eligible term is a no-op and the old order stands: co-op parent, then
  -- biggest FMV.
  (array_agg(parid ORDER BY eligible DESC, (parid LIKE '%-U%'), fmv DESC NULLS LAST, parid))[1]
    AS parid,
  (array_agg(longitude ORDER BY eligible DESC, (parid LIKE '%-U%'), fmv DESC NULLS LAST, parid))[1]
    AS longitude,
  (array_agg(latitude ORDER BY eligible DESC, (parid LIKE '%-U%'), fmv DESC NULLS LAST, parid))[1]
    AS latitude,
  CASE WHEN bool_or(eligible) THEN 2
       WHEN bool_or(on_supplemental) THEN 1
       ELSE 0 END AS tier,
  -- Co-op '-U' unit values are already aggregated inside their parent
  -- building record's fmv, so counting both double-counts; parents always
  -- share their units' group. Sum only non-unit rows (a group that is ONLY
  -- units, with no parent — doesn't occur — would fall back to the unit sum).
  COALESCE(sum(fmv) FILTER (WHERE parid NOT LIKE '%-U%'), sum(fmv)) AS fmv,
  count(*)::int AS member_count,
  -- How many members are themselves flagged. The tooltip needs it: a red dot
  -- over an 865-unit tower where 4 units qualify must not read as the whole
  -- building's valuation being flagged.
  count(*) FILTER (WHERE eligible)::int AS eligible_count
FROM members
GROUP BY gid;

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
