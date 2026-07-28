#!/usr/bin/env bash
# Millionaires' Row — step 4: rebuild the derived `owners` table, create the
# SPEC.md indexes, ANALYZE. Idempotent. Run after scripts/geocode.sh; see the
# pipeline order comment at the top of scripts/import.sh.
#
# owners is derived across ALL properties (the full FY27 roll), with per-tier
# counts: property_count = every holding, roll_count = holdings on the
# supplemental roll, eligible_count = holdings flagged eligible.
#
# Usage: scripts/build_owners.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
# The postgres container has docker's default 64 MB /dev/shm, too small for
# parallel hash joins at full-roll scale ("could not resize shared memory
# segment"). Pipeline sessions run single-threaded; the app is unaffected.
PSQL=(docker exec -e PGOPTIONS=-cmax_parallel_workers_per_gather=0 -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mrow)

echo "==> rebuilding owners"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on
TRUNCATE owners;

-- display_name = the most common raw spelling of the owner string,
-- ties broken alphabetically. Done in two grouped passes (one over
-- (owner_norm, owner), one over owner_norm) rather than a correlated
-- subquery, which would seq-scan properties once per owner.
INSERT INTO owners (owner_norm, display_name, property_count, roll_count,
                    eligible_count, total_fmv)
SELECT t.owner_norm, t.display_name, t.property_count, t.roll_count,
       t.eligible_count, t.total_fmv
FROM (
  SELECT DISTINCT ON (g.owner_norm)
         g.owner_norm,
         g.owner                                        AS display_name,
         sum(g.n)         OVER w ::int                  AS property_count,
         sum(g.roll_n)    OVER w ::int                  AS roll_count,
         sum(g.elig_n)    OVER w ::int                  AS eligible_count,
         sum(g.fmv_sum)   OVER w ::bigint               AS total_fmv
  FROM (
    SELECT owner_norm, owner,
           count(*)                                   AS n,
           count(*) FILTER (WHERE on_supplemental)     AS roll_n,
           count(*) FILTER (WHERE eligible)            AS elig_n,
           coalesce(sum(fmv), 0)                       AS fmv_sum
    FROM properties
    WHERE owner_norm IS NOT NULL
    GROUP BY owner_norm, owner
  ) g
  WINDOW w AS (PARTITION BY g.owner_norm)
  ORDER BY g.owner_norm, g.n DESC, g.owner ASC
) t;

-- owner_norm is derived from owner, so display_name can only be NULL if every
-- raw spelling was NULL, which cannot happen; guard anyway.
UPDATE owners SET display_name = owner_norm WHERE display_name IS NULL;
SQL

echo "==> creating indexes"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on
CREATE INDEX IF NOT EXISTS properties_owner_trgm   ON properties USING gin (owner_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS properties_address_trgm ON properties USING gin (address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS properties_bbl          ON properties (bbl);
CREATE INDEX IF NOT EXISTS properties_fmv          ON properties (fmv DESC);
CREATE INDEX IF NOT EXISTS properties_geo          ON properties (longitude, latitude) WHERE longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS owners_count            ON owners (property_count DESC);
-- supports /api/property/{parid} -> "this owner's other properties" and
-- /api/owner/{owner_norm}
CREATE INDEX IF NOT EXISTS properties_owner_norm   ON properties (owner_norm);
-- partial index for the surcharge-eligible subset (set in scripts/import.sh)
CREATE INDEX IF NOT EXISTS properties_eligible     ON properties (eligible) WHERE eligible;
-- tier-2 map/search: bbox lookups restricted to supplemental-roll properties
CREATE INDEX IF NOT EXISTS properties_geo_supp     ON properties (longitude, latitude)
  WHERE on_supplemental AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS owners_roll_count       ON owners (roll_count DESC);
SQL

echo "==> ANALYZE"
"${PSQL[@]}" -d "$DB" -c "ANALYZE;"

"${PSQL[@]}" -d "$DB" <<'SQL'
\echo '--- summary ---'
SELECT (SELECT count(*) FROM properties)                            AS properties,
       (SELECT count(*) FROM properties WHERE on_supplemental)       AS on_supplemental,
       (SELECT count(*) FROM properties WHERE eligible)              AS eligible,
       (SELECT count(*) FROM properties WHERE latitude IS NOT NULL)  AS with_coords,
       (SELECT count(*) FROM owners)                                AS owners,
       (SELECT count(*) FROM owners WHERE property_count > 1)       AS multi_owners,
       (SELECT count(*) FROM owners WHERE roll_count > 1)           AS multi_on_roll,
       (SELECT coalesce(sum(fmv), 0) FROM properties)               AS total_fmv;
\echo '--- top 10 owners by property_count (all properties) ---'
SELECT display_name, property_count, roll_count, eligible_count, total_fmv
FROM owners ORDER BY property_count DESC, owner_norm LIMIT 10;
\echo '--- top 10 owners by roll_count (supplemental roll) ---'
SELECT display_name, property_count, roll_count, eligible_count, total_fmv
FROM owners ORDER BY roll_count DESC, owner_norm LIMIT 10;
SQL

echo "==> build_owners complete"
