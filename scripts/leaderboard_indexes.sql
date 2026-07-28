-- Indexes for the borough / ZIP aggregate pages. Idempotent; safe to re-run.
--
-- One covering index carries every geographic aggregate on the site. The
-- borough and ZIP pages all reduce to "scan one contiguous slice of the roll
-- and count / sum / group it", which without this index is a sequential scan
-- of all 1.2M parcels (measured: 343 ms for the top-owners-per-borough
-- grouping, 275 ms for a borough median) — one scan per section, per page.
--
-- Key columns are the two geographic filters plus the sort every table uses;
-- `owner_norm`, `eligible` and `on_supplemental` ride along as INCLUDE payload
-- so the tier counts, the FMV sums and the owner grouping are all answered by
-- an index-only scan without touching the heap. 67 MB, and it takes the same
-- grouping to 74 ms and the borough aggregate to 33 ms.
--
--   docker exec -i mrow-postgres psql -U mrow -d mrow -f - < scripts/leaderboard_indexes.sql
CREATE INDEX IF NOT EXISTS properties_boro_zip_fmv
  ON properties (boro, zip_code, fmv DESC)
  INCLUDE (owner_norm, eligible, on_supplemental);
