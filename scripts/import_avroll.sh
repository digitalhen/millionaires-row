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
#   35-45, 46-56 and 57-67. Groups 4 and 5 are byte-identical across the whole
#   file and match the supplemental roll's FMV for 100.000% of shared parcels;
#   groups 1-3 match only 0.3% / 96.9% / 100.0%. We therefore use group 4,
#   whose 11 fields decode as:
#     46 full market LAND value        52 transitional AV total
#     47 full market TOTAL value = FMV 53 transitional exempt value
#     48 actual assessed LAND value    54 billable AV total
#     49 actual assessed TOTAL value   55 billable exempt value
#     50 actual EXEMPT value           56 tax class
#     51 transitional AV land
#   (Group 2's field 25 is the *changed-by-notice* value and is NOT the right
#   one -- it disagrees with the supplemental roll on ~28k parcels. Field 45 is
#   group 3's trailing tax class and is what this script loads as TAX_CLASS;
#   it is identical to field 56.)
#
#   FIELDS 49/50 VERIFIED EMPIRICALLY. 49 is exactly the tax-class assessment
#   ratio applied to FMV (6% for class 1, 45% for class 4). 50 equals 49 for
#   parcels that must be wholly exempt and is 0 or a few percent for ordinary
#   homes:
#     1011110001 Central Park / NYC PARKS      49 = 50 = 3,300,050,700
#     3001491102 NYC HPD, 138 Willoughby       49 = 50 =    85,162,663
#     1000160215 NYC DEPT OF EDUCATION         49 = 50 =    78,593,850
#     1013830038 REPUBLIC OF ITALY, 690 Park   49 = 50 =     3,152,940
#     1010301082 220 Central Park South APT 50 49 = 6,999,235, 50 = 0
#     4005190026 ordinary Queens A1 with STAR  49 =    46,500, 50 = 4,130
#   Across all 1,163,446 parcels: 833,194 have no exemption, 254,717 a partial
#   one (clustering at 1-9% = STAR/co-op abatement and at 50%), 60,380 are >=95%
#   exempt. The top owners of that >=95% set are NYC PARKS DEPT, DCAS,
#   DEPARTMENT OF EDUCATION, HPD, NYC HOUSING AUTHORITY — i.e. exactly right.
#   Fields 54/55 (billable) tell the same story and disagree with 49/50 on only
#   663 parcels; we load the *actual* pair, which is DOF's headline AV/exempt.
#
# MERGE SEMANTICS
#   - Rows already in `properties` (loaded from the supplemental roll) are
#     authoritative: their owner/address/FMV/co-op handling is left untouched.
#     They are only marked on_supplemental = true and given assessed_av /
#     exempt_av.
#   - Rows whose trimmed PARID is not already present are inserted with
#     source_file='AVROLL', on_supplemental=false, eligible=false,
#     city_name=NULL, coop_num=NULL, and the same owner_norm / address
#     normalization rules as the supplemental import.
#   - The synthetic '-U' co-op unit rows have no full-roll counterpart (their
#     parid carries a suffix), so their assessed_av / exempt_av stay NULL. We
#     deliberately do NOT copy the parent building's values down: the parent's
#     AV covers the whole building, and attributing it to a unit would be wrong.
#
# ELIGIBLE FINALIZATION
#   Because the exemption values only exist here, this script owns the final
#   state of `properties.eligible` (scripts/import.sh sets it provisionally).
#   Required order: import.sh -> import_avroll.sh. See step 4 below.
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
  fmv          text,
  assessed_av  text,
  exempt_av    text
);
SQL

# Project the 17 needed fields to CSV. Every field is trimmed of the layout's
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
          q($110) "," q($47) "," q($49) "," q($50)
  }
  END { printf "%d %d %d\n", total, easement, kept > stats }
' "$AVROLL_TXT" \
| "${PSQL[@]}" -d "$DB" -c \
    "COPY staging_avroll FROM STDIN WITH (FORMAT csv);"

read -r SRC_TOTAL EASEMENT KEPT < "$STATS"; rm -f "$STATS"
echo "==> avroll rows: $SRC_TOTAL total, $EASEMENT easement rows skipped, $KEPT normal parcels"

STAGED=$("${PSQL[@]}" -tAd "$DB" -c "SELECT count(*) FROM staging_avroll;")
[ "$STAGED" -eq "$KEPT" ] || { echo "FATAL: staged $STAGED != projected $KEPT" >&2; exit 1; }

# Values arrive as signed zero-padded strings ("+00000203743"); normalize in place.
"${PSQL[@]}" -d "$DB" <<'SQL'
-- assessed_av / exempt_av deliberately keep a genuine zero as 0 rather than
-- folding it to NULL the way fmv does: 833k parcels have no exemption at all
-- and 15k carry no assessed value, and NULLing those would make
-- `assessed_av IS NULL` mean two different things. After this, NULL means
-- exactly "this row has no full-roll counterpart" (the '-U' co-op unit rows).
UPDATE staging_avroll
SET fmv         = nullif(regexp_replace(fmv, '^\+?0*', ''), ''),
    assessed_av = CASE WHEN btrim(assessed_av) = '' THEN NULL ELSE
                    coalesce(nullif(regexp_replace(assessed_av, '^\+?0*', ''), ''), '0') END,
    exempt_av   = CASE WHEN btrim(exempt_av) = '' THEN NULL ELSE
                    coalesce(nullif(regexp_replace(exempt_av, '^\+?0*', ''), ''), '0') END,
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
-- The source_file guard keeps this idempotent: on a re-run, rows this script
-- previously inserted (tier 1 only) must NOT be promoted to on_supplemental.
UPDATE properties SET on_supplemental = true
WHERE NOT on_supplemental AND source_file <> 'AVROLL';

-- DOF assessed / exempt values for every parcel that exists on the full roll,
-- including the supplemental rows already present (see FIELD MAP above).
UPDATE properties p
SET assessed_av = a.assessed_av::bigint,
    exempt_av   = a.exempt_av::bigint
FROM staging_avroll a
WHERE p.parid = a.parid
  AND (p.assessed_av IS DISTINCT FROM a.assessed_av::bigint
    OR p.exempt_av   IS DISTINCT FROM a.exempt_av::bigint);

INSERT INTO properties (
  parid, bbl, boro, block, lot, tax_year, tax_class, bldg_class,
  owner, owner_norm, housenum_lo, housenum_hi, street_name, aptno,
  zip_code, city_name, coop_num, condo_number, fmv, address,
  latitude, longitude, source_file, eligible, on_supplemental,
  assessed_av, exempt_av)
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
  false,                                   -- on_supplemental
  a.assessed_av::bigint,
  a.exempt_av::bigint
FROM staging_avroll a
CROSS JOIN LATERAL (
  SELECT regexp_replace(
           regexp_replace(upper(btrim(coalesce(a.owner, ''))), '\s+', ' ', 'g'),
           '[,.\s]+$', '') AS v
) nrm
WHERE NOT EXISTS (SELECT 1 FROM properties p WHERE p.parid = a.parid);

DROP TABLE staging_avroll;
SQL

# --- 4. finalize `eligible`: drop wholly tax-exempt parcels -------------------
# The surcharge is an addition to a property tax bill, so it cannot reach a
# parcel that is wholly exempt from property tax. scripts/import.sh cannot make
# this call — DOF's exemption values only exist on the full roll loaded above —
# so the final state of `properties.eligible` is decided here.
#
# FULLY EXEMPT := assessed_av > 0 AND exempt_av >= 95% of assessed_av.
# (assessed_av = 0 is excluded: those parcels carry no value at all — e.g. Port
# Authority JFK rows are all zeros — and 0 >= 0.95*0 would sweep them in on a
# technicality. They are never eligible anyway, since eligibility needs FMV.)
#
# ONE CARVE-OUT. The same test also catches 421-a / 421-g new-construction
# incentives, which are granted to an entire new condo development and can run
# at ~100% of assessed value for years. Those units are private homes that will
# be taxed when the benefit phases out, and they are precisely the kind of
# property the surcharge targets — 15 Hudson Yards (553 West 30 Street, 285/285
# units exempt), 400 West 61st Street (160/160), 252 East 57 Street (95/95),
# 15 West 53 Street (245/245), 50 Riverside Blvd (218/218). Demoting them would
# be a worse error than the one we are fixing. They are distinguished from
# institutional exemptions structurally: an incentive exemption blankets the
# whole development, while a consulate or a foundation owns one unit in an
# otherwise taxable building. So a fully-exempt parcel is spared when >= 90% of
# the units in its condo development are also fully exempt.
#
# Verified on this roll: of 921 eligible rows that are fully exempt, the 745
# sitting in a >=90%-exempt development have zero institutional owners (377
# person-name owners, 345 LLC/trust/corp), while the 176 that are demoted are
# NYC HPD, foreign missions and consulates (Italy, Japan, Saudi Arabia, the UAE,
# the Holy See, ...), HDFC housing companies, congregations and NYU School of
# Law — with only 3 person-name owners among them.
#
# Synthetic '-U' co-op unit rows have NULL assessed_av/exempt_av and are never
# demoted here; 14 of them sit under a fully-exempt parent (ground-leased ECF /
# Battery Park City buildings) and are left eligible on purpose.
echo "==> finalizing eligible flag (dropping wholly tax-exempt parcels)"
"${PSQL[@]}" -d "$DB" <<'SQL'
\timing on
\pset pager off

WITH dev AS (
  SELECT boro, block, condo_number,
         count(*)                                                      AS units,
         count(*) FILTER (WHERE assessed_av > 0
                            AND exempt_av >= 0.95 * assessed_av)       AS exempt_units
  FROM properties
  WHERE on_supplemental AND lot >= 1001 AND condo_number IS NOT NULL
  GROUP BY 1, 2, 3
),
incentive AS (   -- building-wide (421-a style) exemption: not a demotion
  SELECT boro, block, condo_number FROM dev
  WHERE units > 1 AND exempt_units::numeric / units >= 0.9
)
UPDATE properties p SET eligible = false
WHERE p.eligible
  AND p.assessed_av > 0
  AND p.exempt_av >= 0.95 * p.assessed_av
  AND NOT EXISTS (SELECT 1 FROM incentive i
                   WHERE i.boro = p.boro AND i.block = p.block
                     AND i.condo_number = p.condo_number AND p.lot >= 1001);

\echo '--- exemption coverage ---'
SELECT count(*) FILTER (WHERE assessed_av IS NULL)                      AS no_avroll_match,
       count(*) FILTER (WHERE assessed_av = 0)                          AS zero_assessed,
       count(*) FILTER (WHERE assessed_av > 0 AND exempt_av = 0)        AS no_exemption,
       count(*) FILTER (WHERE assessed_av > 0 AND exempt_av > 0
                          AND exempt_av < 0.95 * assessed_av)           AS partial_exemption,
       count(*) FILTER (WHERE assessed_av > 0
                          AND exempt_av >= 0.95 * assessed_av)          AS fully_exempt
FROM properties;
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
\echo '--- top 10 eligible by FMV (expect individual homes / penthouses) ---'
SELECT parid, bldg_class, left(coalesce(owner, ''), 34) AS owner,
       left(address, 34) AS address, fmv
FROM properties WHERE eligible ORDER BY fmv DESC LIMIT 10;
\echo '--- by source_file ---'
SELECT source_file, count(*) FROM properties GROUP BY 1 ORDER BY 1;
\echo '--- by borough ---'
SELECT boro,
       count(*)                                             AS all_props,
       count(*) FILTER (WHERE on_supplemental)              AS supplemental
FROM properties GROUP BY 1 ORDER BY 1;
SQL

echo "==> avroll merge complete (re-run scripts/geocode.sh, then build_owners.sh"
echo "    and build_map_dots.sh — map_dots caches the eligible flag as tier 2)"
