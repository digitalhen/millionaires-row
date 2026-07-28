# Millionaires' Row — NYC Pied-à-Terre Tax Roll Explorer

A searchable, mapped explorer of NYC DOF's 2027 supplemental property roll
(the ~960k properties that *may* be subject to the new non-primary-residence
surcharge). Users can search any name or address, view full property details
(valuation, owner, class), see every property on a white-on-black map of NYC,
and see which owners hold multiple properties.

## Source data

- `data/raw/supplemental_roll_TC1_2027.csv` — 684,619 rows (tax class 1)
- `data/raw/supplemental_roll_TC2_2027.csv` — 275,091 rows (tax class 2)
- Columns: `PARID,BORO,BLOCK,LOT,TAXYR,RECTYPE,TAX_CLASS,BLDG_CLASS,OWNER,HOUSENUM_LO,HOUSENUM_HI,STREET_NAME,APTNO,ZIP_CODE,CITYNAME,COOP_BLDG_NUM,COOP_BLDG_SUFFIX,COOP_NUM,CONDO_NUMBER,FMV`
- `PARID` is the 10-digit BBL string (boro + 5-digit block + 4-digit lot).
- Coordinates come from NYC PLUTO (join on BBL). Condo unit lots (lot >= 1001)
  won't match PLUTO directly; resolve them via the condo *billing* BBL or fall
  back to the base lot / block centroid — the pipeline should get a coordinate
  for the vast majority of rows and record NULL where impossible.

## Local dev environment

- Postgres 16 in Docker (Docker Desktop context `desktop-linux`), container
  `mrow-postgres`, host port **5435** (5432-5434 are taken on this machine).
- Credentials: user `mrow`, password `mrow`.
- Two databases, identical schema:
  - `mrow` — the real thing, owned by the data pipeline.
  - `mrow_dev` — ~10k-row sample with FAKE random lat/lon (for UI dev while
    the pipeline runs). The webapp must not hardcode anything sample-specific.
- App env: `DATABASE_URL=postgres://mrow:mrow@localhost:5435/mrow_dev` during
  UI dev, switched to `/mrow` at integration.

## Database schema (contract — both agents build against exactly this)

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE properties (
  parid        text PRIMARY KEY,
  bbl          bigint NOT NULL,
  boro         smallint NOT NULL,        -- 1 MN, 2 BX, 3 BK, 4 QN, 5 SI
  block        integer NOT NULL,
  lot          integer NOT NULL,
  tax_year     smallint NOT NULL,
  tax_class    text NOT NULL,            -- as given: '1','2','2A','2B','2C',...
  bldg_class   text,
  owner        text,                     -- raw owner string from roll
  owner_norm   text,                     -- normalized; NULL for placeholders
  housenum_lo  text,
  housenum_hi  text,
  street_name  text,
  aptno        text,
  zip_code     text,
  city_name    text,
  coop_num     text,
  condo_number text,
  fmv          bigint,                   -- full market value, whole dollars
  address      text NOT NULL,            -- display address (see below)
  latitude     double precision,
  longitude    double precision,
  source_file  text NOT NULL             -- 'TC1' | 'TC2'
);

CREATE TABLE owners (
  owner_norm     text PRIMARY KEY,
  display_name   text NOT NULL,          -- most common raw spelling
  property_count integer NOT NULL,
  total_fmv      bigint NOT NULL
);

-- Indexes (pipeline creates after load):
CREATE INDEX properties_owner_trgm ON properties USING gin (owner_norm gin_trgm_ops);
CREATE INDEX properties_address_trgm ON properties USING gin (address gin_trgm_ops);
CREATE INDEX properties_bbl ON properties (bbl);
CREATE INDEX properties_fmv ON properties (fmv DESC);
CREATE INDEX properties_geo ON properties (longitude, latitude) WHERE longitude IS NOT NULL;
CREATE INDEX owners_count ON owners (property_count DESC);
```

Rules:
- `address` = trim(housenum_lo + ' ' + street_name) + (aptno ? ', APT ' + aptno : ''),
  uppercase, single-spaced. Every row gets one even if parts are missing.
- `owner_norm` = raw owner uppercased, whitespace collapsed, trailing `,` and
  `.` stripped. Placeholder/no-name values (empty, `NAME NOT ON FILE`,
  `UNAVAILABLE OWNER`, `NOT ON FILE`, etc.) → `owner_norm NULL` and the row is
  excluded from `owners` (never flagged as multi-owner).
- `owners` is derived: one row per non-null `owner_norm` with counts and FMV sum.
- Multi-property flag in the UI = `owners.property_count > 1`.

## API (Next.js route handlers — the contract the UI consumes)

- `GET /api/search?q=...&mode=all|owner|address&limit=25&offset=0`
  → `{ results: [{parid, address, boro, owner, owner_norm, fmv, property_count}], total }`
  Case-insensitive; trigram/ILIKE on owner_norm and address. `property_count`
  joined from owners so multi-owners are flagged directly in results.
- `GET /api/property/{parid}` → full property row + owner summary
  (`property_count`, `total_fmv`) + that owner's other properties (up to 50).
- `GET /api/owner/{owner_norm}` (URL-encoded) → owner summary + all properties.
- `GET /api/map/points?bbox=minLng,minLat,maxLng,maxLat&limit=20000`
  → compact arrays `[[lng,lat,fmv,parid], ...]` for map rendering in view.
- `GET /api/map/overview` → downsampled full-city point set (~30–60k points,
  deterministic sample weighted toward higher FMV) served with long cache
  headers; used at low zoom.
- `GET /api/stats` → `{ properties, withCoords, owners, multiOwners, totalFmv, topOwners: [...] }`

## Frontend

- Next.js 15 App Router, TypeScript, plain CSS (no UI framework needed).
- Pages: `/` (hero + search + full-screen map), `/property/[parid]`,
  `/owner/[owner]` (all properties of one owner).
- Map: MapLibre GL JS with **no external tiles** — a blank black canvas with:
  - NYC borough outlines as thin white lines (GeoJSON committed to repo;
    NYC Open Data "Borough Boundaries" export).
  - Properties as small white squares (MapLibre `circle` or `symbol` square),
    subtle intensity by FMV; hover → address/FMV tooltip; click → property page.
  - Overview points at low zoom, bbox-fetched points when zoomed in.
- Aesthetic: strict white-on-black. `#000` background, `#fff` lines/text,
  greys only for hierarchy. Monospaced/utilitarian type (system mono stack is
  fine). Feels like a blueprint / tax ledger, not a SaaS dashboard.
- Multi-property owners: badge like `▣ 12 PROPERTIES` next to owner name in
  results and detail pages, linking to `/owner/...`.
- FMV formatted as `$12,015,000`. Borough names spelled out.

## Repeatable pipeline (scripts/, all idempotent)

1. `scripts/schema.sql` — the schema above.
2. `scripts/import.sh` — create db, apply schema, COPY both CSVs (staging
   table → typed insert with normalization rules).
3. `scripts/geocode.sh` (or .py/.ts) — fetch PLUTO bbl/lat/lon (NYC Open Data
   Socrata resource `64uk-42ks` supports
   `.csv?$select=bbl,latitude,longitude&$limit=...&$offset=...`; DCP zip
   download is a fallback), load to `pluto_coords(bbl,lat,lng)`, update
   `properties`, including the condo/co-op fallback strategy.
4. `scripts/build_owners.sh` — derive `owners`, create indexes, ANALYZE.
5. `scripts/dump_seed.sh` — `pg_dump -Fc` the finished `mrow` db to
   `data/seed/mrow.dump` for production seeding.

## Production packaging (Dokploy, x2 instances, git-based deploy)

- `Dockerfile` — multi-stage Next.js standalone build.
- `docker-compose.yml` — `app` + `postgres` (with volume) + one-shot `seed`
  service that `pg_restore`s `data/seed/mrow.dump` if the db is empty.
- Each Dokploy instance runs its own postgres from the same dump; data is
  read-only so no sync needed.
- `README.md` — local dev + Dokploy deploy steps.
