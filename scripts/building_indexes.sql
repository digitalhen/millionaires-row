-- Index for the "in this building" block on a property page. Idempotent.
--
-- Sibling parcels are found two ways. Co-op unit rows carry their building's
-- BBL, so `properties_bbl` already answers that arm. Condo units are each their
-- own BBL and are only tied together by (boro, block, condo_number) — and that
-- had no index: the 3,858-unit condo on block 3944 in the Bronx cost a 359 ms
-- parallel sequential scan of all 1.2M parcels, once per page view.
--
-- Partial on `condo_number IS NOT NULL` because two thirds of the roll is not
-- in a condominium at all, and the arm is only ever run for a parcel that
-- carries a condo number. 12 MB, and it takes that lookup to under 2 ms.
--
--   docker exec -i mrow-postgres psql -U mrow -d mrow -f - < scripts/building_indexes.sql
CREATE INDEX IF NOT EXISTS properties_boro_block_condo
  ON properties (boro, block, condo_number)
  WHERE condo_number IS NOT NULL;
