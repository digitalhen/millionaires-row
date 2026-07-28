-- Millionaires' Row schema (see SPEC.md). Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS properties (
  parid        text PRIMARY KEY,
  bbl          bigint NOT NULL,
  boro         smallint NOT NULL,
  block        integer NOT NULL,
  lot          integer NOT NULL,
  tax_year     smallint NOT NULL,
  tax_class    text NOT NULL,
  bldg_class   text,
  owner        text,
  owner_norm   text,
  housenum_lo  text,
  housenum_hi  text,
  street_name  text,
  aptno        text,
  zip_code     text,
  city_name    text,
  coop_num     text,
  condo_number text,
  fmv          bigint,
  address      text NOT NULL,
  latitude     double precision,
  longitude    double precision,
  source_file  text NOT NULL,          -- 'TC1' | 'TC2' | 'AVROLL'
  -- DOF's own assessed / exempt values for the parcel, from the FY27 assessment
  -- roll (PROPMAST_ORE_2027_FIN.txt, valuation group 4, fields 49 and 50 — see
  -- the FIELD MAP in scripts/import_avroll.sh).
  --   assessed_av = actual assessed total value (whole dollars)
  --   exempt_av   = portion of that assessed value covered by exemptions
  -- NULL means only "no full-roll counterpart": the synthetic '-U' co-op unit
  -- rows, and every row of the mrow_dev sample (no avroll load). A parcel that
  -- carries no assessed value, or no exemption, stores 0 rather than NULL.
  -- A parcel is "fully exempt" when assessed_av > 0 AND exempt_av >= 95% of
  -- assessed_av; ordinary homes sit at 0 or a few percent (STAR, veterans).
  assessed_av  bigint,
  exempt_av    bigint,
  -- Best-effort match of DOF's stated surcharge criteria (see data/LAYOUT.md):
  -- 1-3 family homes (class A*/B*/C0) with FMV > $5M, or condo units (R*) /
  -- co-op units (parid '-U' suffix) with FMV >= $1M. The roll itself is
  -- broader; this flag marks properties the criteria appear to cover.
  -- Set provisionally by scripts/import.sh and FINALIZED by
  -- scripts/import_avroll.sh, which demotes fully-exempt parcels once the
  -- exemption values above are loaded. See both scripts for the exclusions.
  eligible     boolean NOT NULL DEFAULT false,
  -- Tier 2: this parcel appears on the 2027 *supplemental* roll (the ~960k
  -- properties that may be subject to the surcharge). False for parcels that
  -- exist only on the full FY27 assessment roll (tier 1).
  on_supplemental boolean NOT NULL DEFAULT false
);

-- Idempotent upgrade path for databases created before these columns existed
-- (CREATE TABLE IF NOT EXISTS above is a no-op on them).
ALTER TABLE properties ADD COLUMN IF NOT EXISTS assessed_av bigint;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS exempt_av   bigint;

CREATE TABLE IF NOT EXISTS owners (
  owner_norm     text PRIMARY KEY,
  display_name   text NOT NULL,          -- most common raw spelling
  property_count integer NOT NULL,       -- all holdings (tier 1: full roll)
  roll_count     integer NOT NULL DEFAULT 0,  -- holdings on the supplemental roll (tier 2)
  eligible_count integer NOT NULL DEFAULT 0,  -- holdings flagged eligible (tier 3)
  total_fmv      bigint NOT NULL         -- summed over all holdings
);
