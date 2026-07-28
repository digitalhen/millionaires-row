#!/usr/bin/env bash
# Millionaires' Row — step 1: (re)create the `mrow` database and import the raw
# 2027 supplemental tax roll CSVs (tier 2 / tier 3 of the site).
#
# PIPELINE ORDER (each step is idempotent; run them in this sequence):
#   1. scripts/import.sh         supplemental roll  -> properties (on_supplemental=true)
#   2. scripts/import_avroll.sh  full FY27 roll     -> properties (on_supplemental=false)
#   3. scripts/geocode.sh        PLUTO -> latitude/longitude for every row
#   4. scripts/build_owners.sh   derive owners, indexes, ANALYZE
#   5. scripts/dump_seed.sh      pg_dump -Fc -> data/seed/mrow.dump
#
# Idempotent: drops and recreates the database from scratch every run.
# NOTE: this destroys pluto_coords, the avroll rows and any geocoding, so the
# later steps must be re-run after it (the PLUTO download and the extracted
# avroll text file are both cached on disk, so re-runs are cheap).
#
# Usage: scripts/import.sh
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
PSQL=(docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mrow)

TC1=data/raw/supplemental_roll_TC1_2027.csv
TC2=data/raw/supplemental_roll_TC2_2027.csv

for f in "$TC1" "$TC2" scripts/schema.sql; do
  [ -f "$f" ] || { echo "FATAL: missing $f" >&2; exit 1; }
done

# Source row counts (excluding header) for the drop check at the end.
SRC_TC1=$(( $(wc -l < "$TC1") - 1 ))
SRC_TC2=$(( $(wc -l < "$TC2") - 1 ))
SRC_TOTAL=$(( SRC_TC1 + SRC_TC2 ))
echo "==> source rows: TC1=$SRC_TC1 TC2=$SRC_TC2 total=$SRC_TOTAL"

echo "==> recreating database $DB"
"${PSQL[@]}" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();" >/dev/null
"${PSQL[@]}" -d postgres -c "DROP DATABASE IF EXISTS $DB;"
"${PSQL[@]}" -d postgres -c "CREATE DATABASE $DB;"

echo "==> applying scripts/schema.sql"
"${PSQL[@]}" -d "$DB" < scripts/schema.sql

echo "==> creating staging table"
"${PSQL[@]}" -d "$DB" <<'SQL'
DROP TABLE IF EXISTS staging_roll;
CREATE UNLOGGED TABLE staging_roll (
  parid             text,
  boro              text,
  block             text,
  lot               text,
  taxyr             text,
  rectype           text,
  tax_class         text,
  bldg_class        text,
  owner             text,
  housenum_lo       text,
  housenum_hi       text,
  street_name       text,
  aptno             text,
  zip_code          text,
  cityname          text,
  coop_bldg_num     text,
  coop_bldg_suffix  text,
  coop_num          text,
  condo_number      text,
  fmv               text,
  source_file       text
);
SQL

copy_csv() {
  local file="$1" tag="$2"
  echo "==> COPY $file -> staging_roll ($tag)"
  cat "$file" | "${PSQL[@]}" -d "$DB" -c \
    "COPY staging_roll (parid,boro,block,lot,taxyr,rectype,tax_class,bldg_class,owner,housenum_lo,housenum_hi,street_name,aptno,zip_code,cityname,coop_bldg_num,coop_bldg_suffix,coop_num,condo_number,fmv) FROM STDIN WITH (FORMAT csv, HEADER true);"
  "${PSQL[@]}" -d "$DB" -c "UPDATE staging_roll SET source_file = '$tag' WHERE source_file IS NULL;" >/dev/null
}

copy_csv "$TC1" TC1
copy_csv "$TC2" TC2

STAGED=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM staging_roll;")
echo "==> staged rows: $STAGED"
if [ "$STAGED" -ne "$SRC_TOTAL" ]; then
  echo "FATAL: staged $STAGED != source $SRC_TOTAL" >&2
  exit 1
fi

# --- typed insert with the SPEC.md normalization rules -----------------------
#
# PARID collisions: 764 co-op buildings carry both a RECTYPE='1' building record
# and RECTYPE='U' per-unit records that all repeat the *building* BBL (36,677
# extra rows). `properties.parid` is the primary key, so the building record
# keeps the bare PARID and unit records get a deterministic `-U<nnnn>` suffix.
# `bbl` stays the real (building) BBL so geocoding still works for them.
echo "==> normalizing into properties"
"${PSQL[@]}" -d "$DB" <<'SQL'
INSERT INTO properties (
  parid, bbl, boro, block, lot, tax_year, tax_class, bldg_class,
  owner, owner_norm, housenum_lo, housenum_hi, street_name, aptno,
  zip_code, city_name, coop_num, condo_number, fmv, address,
  latitude, longitude, source_file, on_supplemental)
SELECT
  CASE WHEN rectype = '1' THEN parid
       ELSE parid || '-U' || lpad(
              (row_number() OVER (PARTITION BY parid, rectype
                                  ORDER BY aptno, fmv, coop_bldg_num,
                                           coop_bldg_suffix, s.ctid))::text, 4, '0')
  END                                                       AS parid,
  parid::bigint                                             AS bbl,
  boro::smallint,
  block::integer,
  lot::integer,
  taxyr::smallint,
  btrim(tax_class),
  nullif(btrim(bldg_class), ''),
  nullif(btrim(owner), '')                                  AS owner,
  -- owner_norm: uppercase, whitespace-collapsed, trailing , and . stripped.
  -- Placeholder / no-name values become NULL (excluded from `owners`).
  CASE
    WHEN nrm.v IS NULL OR nrm.v = '' THEN NULL
    WHEN nrm.v IN ('NAME NOT ON FILE','UNAVAILABLE OWNER','NOT ON FILE',
                   'NO NAME ON FILE','OWNER UNKNOWN','UNKNOWN','UNKNOWN OWNER',
                   'N/A','NA','NONE','NO NAME','-','--','X','XX','XXX',
                   'OWNER','OWNER OF RECORD','TO BE DETERMINED','TBD')
      THEN NULL
    ELSE nrm.v
  END                                                       AS owner_norm,
  nullif(btrim(housenum_lo), ''),
  nullif(btrim(housenum_hi), ''),
  nullif(btrim(street_name), ''),
  nullif(btrim(aptno), ''),
  nullif(btrim(zip_code), ''),
  nullif(btrim(cityname), ''),
  nullif(btrim(coop_num), ''),
  nullif(btrim(condo_number), ''),
  nullif(btrim(fmv), '')::bigint,
  -- address: "<housenum_lo> <street_name>[, APT <aptno>]", upper, single-spaced.
  -- 'RES'/'RESI' are roll-internal markers for the residential portion of a
  -- parcel, not apartment numbers, so they are not emitted. Matched exactly
  -- (not as a RES% prefix) so real unit strings like 'RES1' or 'RESD' survive.
  btrim(regexp_replace(
    upper(
      btrim(concat_ws(' ', nullif(btrim(housenum_lo), ''), nullif(btrim(street_name), '')))
      || CASE WHEN nullif(btrim(aptno), '') IS NOT NULL
                   AND upper(btrim(aptno)) NOT IN ('RES', 'RESI')
              THEN ', APT ' || btrim(aptno) ELSE '' END
    ), '\s+', ' ', 'g'))                                    AS address,
  NULL::double precision,
  NULL::double precision,
  source_file,
  true                                                      AS on_supplemental
FROM staging_roll s
CROSS JOIN LATERAL (
  SELECT regexp_replace(
           regexp_replace(upper(btrim(coalesce(s.owner, ''))), '\s+', ' ', 'g'),
           '[,.\s]+$', '') AS v
) nrm;
SQL

LOADED=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM properties;")
echo "==> properties rows: $LOADED"

# --- eligible flag -----------------------------------------------------------
# Best-effort match of DOF's stated surcharge criteria (see scripts/schema.sql):
# 1-3 family homes (class A*/B*/C0) over $5M, or condo units (R*) / co-op units
# (synthetic '-U' parid) at $1M or more. Run as a post-load UPDATE because the
# co-op-unit test depends on the parid synthesized above.
echo "==> flagging eligible properties"
"${PSQL[@]}" -d "$DB" <<'SQL'
UPDATE properties SET eligible = true
WHERE on_supplemental AND (
      (tax_class LIKE '1%'
       AND (bldg_class LIKE 'A%' OR bldg_class LIKE 'B%' OR bldg_class = 'C0')
       AND fmv > 5000000)
   OR (bldg_class LIKE 'R%' AND fmv >= 1000000)
   OR (parid LIKE '%-U%' AND fmv >= 1000000));
SQL

echo "==> dropping staging table"
"${PSQL[@]}" -d "$DB" -c "DROP TABLE staging_roll;" >/dev/null

# --- drop check --------------------------------------------------------------
DROPPED=$(( SRC_TOTAL - LOADED ))
PCT=$(awk -v d="$DROPPED" -v t="$SRC_TOTAL" 'BEGIN{printf "%.4f", (t?100*d/t:0)}')
echo "==> dropped $DROPPED / $SRC_TOTAL rows (${PCT}%)"
if awk -v p="$PCT" 'BEGIN{exit !(p > 0.1)}'; then
  echo "FATAL: row drop ${PCT}% exceeds the 0.1% tolerance" >&2
  exit 1
fi

"${PSQL[@]}" -d "$DB" <<'SQL'
\echo '--- rows by source_file ---'
SELECT source_file, count(*) FROM properties GROUP BY 1 ORDER BY 1;
\echo '--- rows by borough ---'
SELECT boro, count(*) FROM properties GROUP BY 1 ORDER BY 1;
\echo '--- null-ish columns ---'
SELECT count(*) FILTER (WHERE owner_norm IS NULL) AS null_owner_norm,
       count(*) FILTER (WHERE fmv IS NULL)        AS null_fmv,
       count(*) FILTER (WHERE address = '')       AS empty_address,
       count(*) FILTER (WHERE lot >= 1001)        AS condo_unit_lots,
       count(*) FILTER (WHERE eligible)           AS eligible
FROM properties;
SQL

echo "==> import complete"
