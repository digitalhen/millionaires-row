#!/usr/bin/env bash
# Millionaires' Row — step 3: fetch PLUTO bbl -> lat/lon and geocode `properties`.
# Run after scripts/import.sh and scripts/import_avroll.sh; see the pipeline
# order comment at the top of scripts/import.sh. Geocodes every row in
# `properties`, both tiers, so it is safe (and required) to re-run after a merge.
#
# Source: NYC Open Data (Socrata) resource 64uk-42ks — "Primary Land Use Tax Lot
# Output (PLUTO)". Downloaded in pages of $PAGE rows and cached under data/pluto/
# (gitignored); re-runs reuse the cache unless FORCE_DOWNLOAD=1.
#
# Matching strategy, in order (each pass only touches still-unmatched rows):
#   1. direct BBL match against PLUTO
#   2. condo unit lots (>=1001): PLUTO condo *billing* lot 7501-7599 on the same
#      boro+block
#   3. condo unit lots (>=1001): centroid (mean lat/lng) of the boro+block
#   4. any remaining unmatched lot: centroid of the boro+block
#   5. still unmatched -> latitude/longitude stay NULL
#
# Usage: scripts/geocode.sh    [FORCE_DOWNLOAD=1 to refetch PLUTO]
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
# The postgres container has docker's default 64 MB /dev/shm, too small for
# parallel hash joins at full-roll scale ("could not resize shared memory
# segment"). Pipeline sessions run single-threaded; the app is unaffected.
PSQL=(docker exec -e PGOPTIONS=-cmax_parallel_workers_per_gather=0 -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mrow)

PLUTO_DIR=data/pluto
RESOURCE="https://data.cityofnewyork.us/resource/64uk-42ks.csv"
PAGE="${PLUTO_PAGE_SIZE:-500000}"
mkdir -p "$PLUTO_DIR"

# --- 1. download -------------------------------------------------------------
fetch_page() {
  local off="$1" out="$2" attempt
  for attempt in 1 2 3 4 5; do
    if curl -sS --fail --compressed --max-time 1200 \
         -G "$RESOURCE" \
         --data-urlencode '$select=bbl,latitude,longitude' \
         --data-urlencode '$order=bbl' \
         --data-urlencode "\$limit=$PAGE" \
         --data-urlencode "\$offset=$off" \
         -o "${out}.part"; then
      mv "${out}.part" "$out"
      return 0
    fi
    echo "    download of offset $off failed (attempt $attempt), backing off..." >&2
    rm -f "${out}.part"
    sleep $(( attempt * 10 ))
  done
  return 1
}

EXPECTED=$(curl -sS --fail --max-time 120 -G "$RESOURCE" \
             --data-urlencode '$select=count(bbl)' | tail -n1 | tr -d '"' || echo "")
echo "==> PLUTO lots reported by Socrata: ${EXPECTED:-unknown}"

if [ "${FORCE_DOWNLOAD:-0}" = "1" ]; then rm -f "$PLUTO_DIR"/pluto_*.csv; fi

offset=0
total=0
pages=()
while :; do
  f="$PLUTO_DIR/pluto_${offset}.csv"
  if [ ! -s "$f" ]; then
    echo "==> downloading PLUTO offset $offset (limit $PAGE)"
    fetch_page "$offset" "$f" || { echo "FATAL: could not download PLUTO offset $offset" >&2; exit 1; }
  else
    echo "==> using cached $f"
  fi
  rows=$(( $(wc -l < "$f") - 1 ))
  [ "$rows" -lt 0 ] && rows=0
  [ "$rows" -eq 0 ] && break
  pages+=("$f")
  total=$(( total + rows ))
  [ "$rows" -lt "$PAGE" ] && break
  offset=$(( offset + PAGE ))
done
echo "==> PLUTO rows downloaded: $total"

if [ -n "$EXPECTED" ] && [ "$total" -ne "$EXPECTED" ]; then
  echo "WARN: downloaded $total rows but Socrata reports $EXPECTED" >&2
fi

# --- 2. load into pluto_coords ----------------------------------------------
echo "==> loading pluto_coords"
"${PSQL[@]}" -d "$DB" <<'SQL'
DROP TABLE IF EXISTS pluto_raw;
CREATE UNLOGGED TABLE pluto_raw (bbl text, lat text, lng text);
SQL

for f in "${pages[@]}"; do
  cat "$f" | "${PSQL[@]}" -d "$DB" -c \
    "COPY pluto_raw (bbl, lat, lng) FROM STDIN WITH (FORMAT csv, HEADER true);"
done

"${PSQL[@]}" -d "$DB" <<'SQL'
DROP TABLE IF EXISTS pluto_coords;
CREATE TABLE pluto_coords (
  bbl bigint PRIMARY KEY,
  lat double precision,
  lng double precision
);

-- bbl arrives as a Socrata float string ("1000750043.00000000"); coords are
-- blank for a small number of lots. Keep one row per bbl.
INSERT INTO pluto_coords (bbl, lat, lng)
SELECT DISTINCT ON (b) b, l, g
FROM (
  SELECT (btrim(bbl))::numeric::bigint      AS b,
         nullif(btrim(lat), '')::double precision AS l,
         nullif(btrim(lng), '')::double precision AS g
  FROM pluto_raw
  WHERE btrim(coalesce(bbl, '')) <> ''
) x
WHERE l IS NOT NULL AND g IS NOT NULL
  AND l BETWEEN 40.0 AND 41.2 AND g BETWEEN -74.6 AND -73.5
ORDER BY b;

DROP TABLE pluto_raw;

-- helper index for the boro+block fallbacks
CREATE INDEX pluto_coords_boroblock
  ON pluto_coords (((bbl / 1000000000)::int), (((bbl / 10000) % 100000)::int));

ANALYZE pluto_coords;
SELECT count(*) AS pluto_coords_rows FROM pluto_coords;
SQL

# --- 3. geocode properties ---------------------------------------------------
echo "==> geocoding properties"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on
UPDATE properties SET latitude = NULL, longitude = NULL;

-- pass 1: direct BBL match
UPDATE properties p
SET latitude = c.lat, longitude = c.lng
FROM pluto_coords c
WHERE c.bbl = p.bbl AND p.latitude IS NULL;
\echo '--- after pass 1 (direct BBL) ---'
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total FROM properties;

-- boro+block rollup of PLUTO, used by passes 2-4
DROP TABLE IF EXISTS pluto_block;
CREATE UNLOGGED TABLE pluto_block AS
SELECT (bbl / 1000000000)::int          AS boro,
       ((bbl / 10000) % 100000)::int    AS block,
       avg(lat)                         AS lat,
       avg(lng)                         AS lng,
       min(bbl) FILTER (WHERE (bbl % 10000) BETWEEN 7501 AND 7599) AS billing_bbl
FROM pluto_coords
GROUP BY 1, 2;
ALTER TABLE pluto_block ADD PRIMARY KEY (boro, block);
ANALYZE pluto_block;

-- pass 2: condo unit lots -> PLUTO condo billing lot (7501-7599) on same boro+block
UPDATE properties p
SET latitude = c.lat, longitude = c.lng
FROM pluto_block b
JOIN pluto_coords c ON c.bbl = b.billing_bbl
WHERE p.latitude IS NULL AND p.lot >= 1001
  AND b.boro = p.boro AND b.block = p.block;
\echo '--- after pass 2 (condo billing lot) ---'
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total FROM properties;

-- pass 3: condo unit lots -> boro+block centroid
UPDATE properties p
SET latitude = b.lat, longitude = b.lng
FROM pluto_block b
WHERE p.latitude IS NULL AND p.lot >= 1001
  AND b.boro = p.boro AND b.block = p.block;
\echo '--- after pass 3 (condo block centroid) ---'
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total FROM properties;

-- pass 4: any remaining lot -> boro+block centroid
UPDATE properties p
SET latitude = b.lat, longitude = b.lng
FROM pluto_block b
WHERE p.latitude IS NULL
  AND b.boro = p.boro AND b.block = p.block;
\echo '--- after pass 4 (block centroid, all lots) ---'
SELECT count(*) FILTER (WHERE latitude IS NOT NULL) AS with_coords, count(*) AS total FROM properties;

DROP TABLE pluto_block;
SQL

# --- 4. coverage report ------------------------------------------------------
echo "==> coverage report"
"${PSQL[@]}" -d "$DB" <<'SQL'
SELECT CASE boro WHEN 1 THEN 'Manhattan' WHEN 2 THEN 'Bronx' WHEN 3 THEN 'Brooklyn'
                 WHEN 4 THEN 'Queens'    WHEN 5 THEN 'Staten Island'
                 ELSE boro::text END                                AS borough,
       count(*)                                                     AS properties,
       count(latitude)                                              AS with_coords,
       round(100.0 * count(latitude) / nullif(count(*), 0), 2)       AS pct,
       count(*) FILTER (WHERE on_supplemental)                      AS supp,
       round(100.0 * count(latitude) FILTER (WHERE on_supplemental)
             / nullif(count(*) FILTER (WHERE on_supplemental), 0), 2) AS supp_pct
FROM properties GROUP BY boro ORDER BY boro;

SELECT 'ALL'                                                        AS borough,
       count(*)                                                     AS properties,
       count(latitude)                                              AS with_coords,
       round(100.0 * count(latitude) / nullif(count(*), 0), 2)       AS pct,
       count(*) FILTER (WHERE on_supplemental)                      AS supp,
       round(100.0 * count(latitude) FILTER (WHERE on_supplemental)
             / nullif(count(*) FILTER (WHERE on_supplemental), 0), 2) AS supp_pct
FROM properties;

\echo '--- rows still missing coordinates, by building class ---'
SELECT coalesce(bldg_class, '(none)') AS bldg_class, count(*)
FROM properties WHERE latitude IS NULL
GROUP BY 1 ORDER BY 2 DESC LIMIT 10;
SQL

COVERAGE=$("${PSQL[@]}" -tAd "$DB" -c \
  "SELECT round(100.0*count(latitude)/nullif(count(*),0), 3) FROM properties;")
echo "==> overall coordinate coverage: ${COVERAGE}%"
if awk -v c="$COVERAGE" 'BEGIN{exit !(c < 97)}'; then
  echo "WARN: coverage ${COVERAGE}% is below the 97% target" >&2
fi
echo "==> geocode complete"
