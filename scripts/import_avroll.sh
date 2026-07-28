#!/usr/bin/env bash
# Millionaires' Row — step 2: merge the FULL FY27 assessment roll (every NYC
# property) into `properties`, giving the site its tier-1 dataset.
#
# Run AFTER scripts/import.sh and BEFORE scripts/geocode.sh — see the pipeline
# order comment at the top of scripts/import.sh.
#
# Source: fy27_avroll1234.zip -> PROPMAST_ORE_2027_FIN.txt, tab-delimited, NO
# header, 1,167,963 rows, 140 fields, fixed-width-padded text fields.
#
# FIELD MAP (1-based). Validated against all 923,033 parcels the full roll shares
# with the supplemental roll: every field below matches the supplemental value
# for 100.000% of them.
#     1  PARID (space-padded, trimmed here)   72  BLDG_CLASS
#     2  BORO                                 73  OWNER (padded)
#     3  BLOCK                                75  HOUSENUM_LO
#     4  LOT                                  76  HOUSENUM_HI
#     5  easement code (blank = normal        77  STREET_NAME
#        parcel; non-blank rows are           78  ZIP_CODE
#        skipped and counted)                101  APTNO
#     8  TAXYR                               110  CONDO_NUMBER
#
#   Valuation fields come in five repeating 11-field groups at 13-23, 24-34,
#   35-45, 46-56 and 57-67. Within a group the 2nd field is the full market
#   TOTAL value (1st is land) and the 11th is the tax class. Groups 4 and 5 are
#   byte-identical across the whole file and match the supplemental roll's FMV
#   for 100.000% of shared parcels; groups 1-3 match only 0.3% / 96.9% / 100.0%.
#   We therefore use group 4:
#     46 land value   47 FMV (full market total)   45 TAX_CLASS
#   (Group 2's field 25 is the *changed-by-notice* value and is NOT the right
#   one -- it disagrees with the supplemental roll on ~28k parcels.)
#
# MERGE SEMANTICS
#   - Rows already in `properties` (loaded from the supplemental roll) are
#     authoritative: their owner/address/FMV/co-op handling is left untouched.
#     They are only marked on_supplemental = true.
#   - Rows whose trimmed PARID is not already present are inserted with
#     source_file='AVROLL', on_supplemental=false, eligible=false,
#     city_name=NULL, coop_num=NULL, and the same owner_norm / address
#     normalization rules as the supplemental import.
#
# Usage: scripts/import_avroll.sh
#   AVROLL_ZIP=/path/to/fy27_avroll1234.zip   (default ~/Downloads/...)
#   AVROLL_TXT=/path/to/PROPMAST_ORE_2027_FIN.txt  (skip extraction entirely)
set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${MROW_CONTAINER:-mrow-postgres}"
DB="${MROW_DB:-mrow}"
# The postgres container has docker's default 64 MB /dev/shm, too small for
# parallel hash joins at full-roll scale ("could not resize shared memory
# segment"). Pipeline sessions run single-threaded; the app is unaffected.
PSQL=(docker exec -e PGOPTIONS=-cmax_parallel_workers_per_gather=0 -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U mrow)

AVROLL_ZIP="${AVROLL_ZIP:-$HOME/Downloads/fy27_avroll1234.zip}"
AVROLL_DIR=data/raw/avroll
AVROLL_TXT="${AVROLL_TXT:-$AVROLL_DIR/PROPMAST_ORE_2027_FIN.txt}"

# --- 0. extract (cached; data/raw/ is gitignored) ----------------------------
if [ ! -s "$AVROLL_TXT" ]; then
  [ -f "$AVROLL_ZIP" ] || { echo "FATAL: no $AVROLL_TXT and no zip at $AVROLL_ZIP" >&2; exit 1; }
  echo "==> extracting $AVROLL_ZIP -> $AVROLL_DIR"
  mkdir -p "$AVROLL_DIR"
  unzip -o -j "$AVROLL_ZIP" -d "$AVROLL_DIR" >/dev/null
fi
[ -s "$AVROLL_TXT" ] || { echo "FATAL: $AVROLL_TXT missing after extraction" >&2; exit 1; }
echo "==> avroll source: $AVROLL_TXT ($(wc -l < "$AVROLL_TXT" | tr -d ' ') rows)"

BEFORE=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM properties;")
echo "==> properties before merge: $BEFORE"

# --- 1. stage --------------------------------------------------------------
echo "==> creating staging_avroll"
"${PSQL[@]}" -d "$DB" <<'SQL'
DROP TABLE IF EXISTS staging_avroll;
CREATE UNLOGGED TABLE staging_avroll (
  parid        text,
  boro         text,
  block        text,
  lot          text,
  tax_class    text,
  taxyr        text,
  bldg_class   text,
  owner        text,
  housenum_lo  text,
  housenum_hi  text,
  street_name  text,
  zip_code     text,
  aptno        text,
  condo_number text,
  fmv          text
);
SQL

# Project the 15 needed fields to CSV. Every field is trimmed of the layout's
# padding and fully quoted, so owner strings containing commas, quotes or
# backslashes survive intact. Easement rows (field 5 non-blank) are dropped.
STATS=$(mktemp)
echo "==> projecting + COPY into staging_avroll (this reads ~2.1 GB)"
LC_ALL=C awk -F'\t' -v stats="$STATS" '
  function q(s) { gsub(/^[ \t]+|[ \t]+$/, "", s); gsub(/"/, "\"\"", s); return "\"" s "\"" }
  {
    total++
    e = $5; gsub(/[ \t]/, "", e)
    if (e != "") { easement++; next }
    kept++
    print q($1) "," q($2) "," q($3) "," q($4) "," q($45) "," q($8) "," q($72) "," \
          q($73) "," q($75) "," q($76) "," q($77) "," q($78) "," q($101) "," \
          q($110) "," q($47)
  }
  END { printf "%d %d %d\n", total, easement, kept > stats }
' "$AVROLL_TXT" \
| "${PSQL[@]}" -d "$DB" -c \
    "COPY staging_avroll FROM STDIN WITH (FORMAT csv);"

read -r SRC_TOTAL EASEMENT KEPT < "$STATS"; rm -f "$STATS"
echo "==> avroll rows: $SRC_TOTAL total, $EASEMENT easement rows skipped, $KEPT normal parcels"

STAGED=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM staging_avroll;")
[ "$STAGED" -eq "$KEPT" ] || { echo "FATAL: staged $STAGED != projected $KEPT" >&2; exit 1; }

# FMV arrives as a signed zero-padded string ("+00000203743"); normalize in place.
"${PSQL[@]}" -d "$DB" <<'SQL'
UPDATE staging_avroll
SET fmv = nullif(regexp_replace(fmv, '^\+?0*', ''), ''),
    parid = btrim(parid);
CREATE UNIQUE INDEX staging_avroll_parid ON staging_avroll (parid);
ANALYZE staging_avroll;
SQL

# --- 2. overlap report -------------------------------------------------------
echo "==> overlap"
"${PSQL[@]}" -d "$DB" <<'SQL'
\pset pager off
SELECT
  (SELECT count(*) FROM staging_avroll)                                   AS avroll_parcels,
  (SELECT count(*) FROM properties)                                       AS supplemental_rows,
  (SELECT count(*) FROM properties p JOIN staging_avroll a USING (parid))  AS matched,
  (SELECT count(*) FROM properties p
     WHERE NOT EXISTS (SELECT 1 FROM staging_avroll a WHERE a.parid = p.parid))
                                                                          AS supp_missing_from_avroll,
  (SELECT count(*) FROM staging_avroll a
     WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.parid = a.parid))
                                                                          AS avroll_new;
\echo 'supplemental rows with no avroll counterpart, by kind:'
SELECT CASE WHEN p.parid LIKE '%-U%' THEN 'synthetic co-op unit row'
            ELSE 'other' END AS kind, count(*)
FROM properties p
WHERE NOT EXISTS (SELECT 1 FROM staging_avroll a WHERE a.parid = p.parid)
GROUP BY 1 ORDER BY 2 DESC;
SQL

# --- 3. merge ----------------------------------------------------------------
echo "==> marking supplemental rows and inserting new avroll parcels"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on

-- Existing rows came from the supplemental roll and stay authoritative.
UPDATE properties SET on_supplemental = true WHERE NOT on_supplemental;

INSERT INTO properties (
  parid, bbl, boro, block, lot, tax_year, tax_class, bldg_class,
  owner, owner_norm, housenum_lo, housenum_hi, street_name, aptno,
  zip_code, city_name, coop_num, condo_number, fmv, address,
  latitude, longitude, source_file, eligible, on_supplemental)
SELECT
  a.parid,
  a.parid::bigint,
  a.boro::smallint,
  a.block::integer,
  a.lot::integer,
  a.taxyr::smallint,
  btrim(a.tax_class),
  nullif(btrim(a.bldg_class), ''),
  nullif(btrim(a.owner), ''),
  -- identical owner_norm rules to the supplemental import
  CASE
    WHEN nrm.v IS NULL OR nrm.v = '' THEN NULL
    WHEN nrm.v IN ('NAME NOT ON FILE','UNAVAILABLE OWNER','NOT ON FILE',
                   'NO NAME ON FILE','OWNER UNKNOWN','UNKNOWN','UNKNOWN OWNER',
                   'N/A','NA','NONE','NO NAME','-','--','X','XX','XXX',
                   'OWNER','OWNER OF RECORD','TO BE DETERMINED','TBD')
      THEN NULL
    ELSE nrm.v
  END,
  nullif(btrim(a.housenum_lo), ''),
  nullif(btrim(a.housenum_hi), ''),
  nullif(btrim(a.street_name), ''),
  nullif(btrim(a.aptno), ''),
  nullif(btrim(a.zip_code), ''),
  NULL,                                    -- city_name: not on the full roll
  NULL,                                    -- coop_num:  not in this field map
  nullif(btrim(a.condo_number), ''),
  a.fmv::bigint,
  -- identical address rules, including the RES/RESI roll-marker exclusion
  btrim(regexp_replace(
    upper(
      btrim(concat_ws(' ', nullif(btrim(a.housenum_lo), ''), nullif(btrim(a.street_name), '')))
      || CASE WHEN nullif(btrim(a.aptno), '') IS NOT NULL
                   AND upper(btrim(a.aptno)) NOT IN ('RES', 'RESI')
              THEN ', APT ' || btrim(a.aptno) ELSE '' END
    ), '\s+', ' ', 'g')),
  NULL::double precision,
  NULL::double precision,
  'AVROLL',
  false,                                   -- eligible: supplemental roll only
  false                                    -- on_supplemental
FROM staging_avroll a
CROSS JOIN LATERAL (
  SELECT regexp_replace(
           regexp_replace(upper(btrim(coalesce(a.owner, ''))), '\s+', ' ', 'g'),
           '[,.\s]+$', '') AS v
) nrm
WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.parid = a.parid);

DROP TABLE staging_avroll;
SQL

AFTER=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM properties;")
echo "==> properties after merge: $AFTER (added $(( AFTER - BEFORE )))"

"${PSQL[@]}" -d "$DB" <<'SQL'
\pset pager off
\echo '--- tiers ---'
SELECT count(*)                                            AS all_properties,
       count(*) FILTER (WHERE on_supplemental)              AS on_supplemental,
       count(*) FILTER (WHERE eligible)                     AS eligible
FROM properties;
\echo '--- by source_file ---'
SELECT source_file, count(*) FROM properties GROUP BY 1 ORDER BY 1;
\echo '--- by borough ---'
SELECT boro,
       count(*)                                             AS all_props,
       count(*) FILTER (WHERE on_supplemental)              AS supplemental
FROM properties GROUP BY 1 ORDER BY 1;
SQL

echo "==> avroll merge complete (re-run scripts/geocode.sh next)"
