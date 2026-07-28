#!/usr/bin/env bash
# Build the mrow_dev sample database: ~10k rows, FAKE random coordinates.
# Requires mrow-postgres container running (docker compose -f docker-compose.dev.yml up -d).
set -euo pipefail
cd "$(dirname "$0")/.."

PSQL="docker exec -i mrow-postgres psql -v ON_ERROR_STOP=1 -U mrow"

$PSQL -d postgres -c "DROP DATABASE IF EXISTS mrow_dev;"
$PSQL -d postgres -c "CREATE DATABASE mrow_dev;"
$PSQL -d mrow_dev < scripts/schema.sql

$PSQL -d mrow_dev <<'SQL'
CREATE TEMP TABLE staging (
  parid text, boro text, block text, lot text, taxyr text, rectype text,
  tax_class text, bldg_class text, owner text, housenum_lo text,
  housenum_hi text, street_name text, aptno text, zip_code text,
  cityname text, coop_bldg_num text, coop_bldg_suffix text, coop_num text,
  condo_number text, fmv text
);
SQL

# Stream samples into a persistent staging table via one session
{
  echo "CREATE TABLE IF NOT EXISTS staging_dev (parid text, boro text, block text, lot text, taxyr text, rectype text, tax_class text, bldg_class text, owner text, housenum_lo text, housenum_hi text, street_name text, aptno text, zip_code text, cityname text, coop_bldg_num text, coop_bldg_suffix text, coop_num text, condo_number text, fmv text); TRUNCATE staging_dev;"
} | $PSQL -d mrow_dev

awk 'NR>1 && NR<=7001' data/raw/supplemental_roll_TC1_2027.csv | \
  $PSQL -d mrow_dev -c "COPY staging_dev FROM STDIN WITH (FORMAT csv)"
awk 'NR>1 && NR<=3001' data/raw/supplemental_roll_TC2_2027.csv | \
  $PSQL -d mrow_dev -c "COPY staging_dev FROM STDIN WITH (FORMAT csv)"

$PSQL -d mrow_dev <<'SQL'
INSERT INTO properties (parid, bbl, boro, block, lot, tax_year, tax_class,
  bldg_class, owner, owner_norm, housenum_lo, housenum_hi, street_name, aptno,
  zip_code, city_name, coop_num, condo_number, fmv, address, latitude,
  longitude, source_file)
SELECT
  parid,
  parid::bigint,
  boro::smallint, block::int, lot::int, taxyr::smallint,
  tax_class, nullif(bldg_class,''),
  nullif(owner,''),
  CASE WHEN owner IS NULL OR btrim(owner) = ''
         OR upper(btrim(owner)) IN ('NAME NOT ON FILE','UNAVAILABLE OWNER','NOT ON FILE')
       THEN NULL
       ELSE regexp_replace(regexp_replace(upper(btrim(owner)), '\s+', ' ', 'g'), '[,.]+$', '')
  END,
  nullif(housenum_lo,''), nullif(housenum_hi,''), nullif(street_name,''),
  nullif(aptno,''), nullif(zip_code,''), nullif(cityname,''),
  nullif(coop_num,''), nullif(condo_number,''),
  nullif(fmv,'')::bigint,
  regexp_replace(upper(btrim(concat_ws(' ', nullif(housenum_lo,''), nullif(street_name,''))
    || CASE WHEN nullif(aptno,'') IS NOT NULL AND upper(btrim(aptno)) NOT IN ('RES','RESI') THEN ', APT ' || aptno ELSE '' END)), '\s+', ' ', 'g'),
  -- FAKE coordinates for dev only: random point in NYC bbox
  40.50 + random() * 0.42,
  -74.25 + random() * 0.55,
  CASE WHEN tax_class LIKE '1%' THEN 'TC1' ELSE 'TC2' END
FROM staging_dev
ON CONFLICT (parid) DO NOTHING;

-- Sample rows all come from the supplemental roll (tier 2); mark eligibility
-- with the same rule as import.sh (tier 3).
UPDATE properties SET on_supplemental = true;
UPDATE properties SET eligible = true WHERE
     (tax_class LIKE '1%' AND (bldg_class LIKE 'A%' OR bldg_class LIKE 'B%' OR bldg_class = 'C0') AND fmv > 5000000)
  OR (bldg_class LIKE 'R%' AND fmv >= 1000000)
  OR (parid LIKE '%-U%' AND fmv >= 1000000);

INSERT INTO owners (owner_norm, display_name, property_count, roll_count, eligible_count, total_fmv)
SELECT owner_norm,
       (array_agg(owner ORDER BY owner))[1],
       count(*),
       count(*) FILTER (WHERE on_supplemental),
       count(*) FILTER (WHERE eligible),
       coalesce(sum(fmv),0)
FROM properties WHERE owner_norm IS NOT NULL
GROUP BY owner_norm;

CREATE INDEX IF NOT EXISTS properties_owner_trgm ON properties USING gin (owner_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS properties_address_trgm ON properties USING gin (address gin_trgm_ops);
CREATE INDEX IF NOT EXISTS properties_bbl ON properties (bbl);
CREATE INDEX IF NOT EXISTS properties_fmv ON properties (fmv DESC);
CREATE INDEX IF NOT EXISTS properties_geo ON properties (longitude, latitude) WHERE longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS owners_count ON owners (property_count DESC);
DROP TABLE staging_dev;
ANALYZE;
SQL

$PSQL -d mrow_dev -c "SELECT count(*) AS properties FROM properties; SELECT count(*) AS owners FROM owners; SELECT count(*) AS multi FROM owners WHERE property_count > 1;"
echo "mrow_dev sample ready"
