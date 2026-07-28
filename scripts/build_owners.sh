#!/usr/bin/env bash
# Millionaires' Row — step 3: rebuild the derived `owners` table, create the
# SPEC.md indexes, ANALYZE. Idempotent.
#
# Usage: scripts/build_owners.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
PSQL=(docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mrow)

echo "==> rebuilding owners"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on
TRUNCATE owners;

-- display_name = the most common raw spelling of the owner string,
-- ties broken alphabetically. Done in two grouped passes (one over
-- (owner_norm, owner), one over owner_norm) rather than a correlated
-- subquery, which would seq-scan properties once per owner.
INSERT INTO owners (owner_norm, display_name, property_count, total_fmv)
SELECT t.owner_norm, t.display_name, t.property_count, t.total_fmv
FROM (
  SELECT DISTINCT ON (g.owner_norm)
         g.owner_norm,
         g.owner                                        AS display_name,
         sum(g.n)         OVER (PARTITION BY g.owner_norm)::int    AS property_count,
         sum(g.fmv_sum)   OVER (PARTITION BY g.owner_norm)::bigint AS total_fmv
  FROM (
    SELECT owner_norm, owner,
           count(*)                  AS n,
           coalesce(sum(fmv), 0)     AS fmv_sum
    FROM properties
    WHERE owner_norm IS NOT NULL
    GROUP BY owner_norm, owner
  ) g
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
SQL

echo "==> ANALYZE"
"${PSQL[@]}" -d "$DB" -c "ANALYZE;"

"${PSQL[@]}" -d "$DB" <<'SQL'
\echo '--- summary ---'
SELECT (SELECT count(*) FROM properties)                          AS properties,
       (SELECT count(*) FROM properties WHERE latitude IS NOT NULL) AS with_coords,
       (SELECT count(*) FROM owners)                              AS owners,
       (SELECT count(*) FROM owners WHERE property_count > 1)     AS multi_owners,
       (SELECT coalesce(sum(fmv), 0) FROM properties)             AS total_fmv;
\echo '--- top 10 owners by property_count ---'
SELECT display_name, property_count, total_fmv
FROM owners ORDER BY property_count DESC, owner_norm LIMIT 10;
SQL

echo "==> build_owners complete"
