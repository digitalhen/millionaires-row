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
  source_file  text NOT NULL
);

CREATE TABLE IF NOT EXISTS owners (
  owner_norm     text PRIMARY KEY,
  display_name   text NOT NULL,
  property_count integer NOT NULL,
  total_fmv      bigint NOT NULL
);
