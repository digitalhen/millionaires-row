export type Property = {
  parid: string;
  bbl: number;
  boro: number;
  block: number;
  lot: number;
  tax_year: number;
  tax_class: string;
  bldg_class: string | null;
  owner: string | null;
  owner_norm: string | null;
  housenum_lo: string | null;
  housenum_hi: string | null;
  street_name: string | null;
  aptno: string | null;
  zip_code: string | null;
  city_name: string | null;
  coop_num: string | null;
  condo_number: string | null;
  fmv: number | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  source_file: string;
  /** matches DOF's surcharge criteria — see the eligibility note in queries.ts */
  eligible: boolean;
  /** on the 2027 supplemental roll (vs. the full city assessment roll) */
  on_supplemental: boolean;
};

export type OwnerSummary = {
  owner_norm: string;
  display_name: string;
  /** every parcel held, city-wide — what the ▣ badge counts */
  property_count: number;
  /** of those, how many are on the 2027 supplemental roll. Optional because
   *  lightweight lookups (social cards) skip it and older schemas lack it. */
  roll_count?: number;
  /** of those, how many match DOF's surcharge criteria */
  eligible_count?: number;
  total_fmv: number;
};

export type SearchResult = {
  parid: string;
  address: string;
  boro: number;
  owner: string | null;
  owner_norm: string | null;
  fmv: number | null;
  property_count: number;
  eligible: boolean;
  on_supplemental: boolean;
};

export type SearchResponse = {
  results: SearchResult[];
  total: number;
  /** true when `total` hit the counting cap and is a lower bound */
  totalCapped: boolean;
};

export type PropertyListItem = {
  parid: string;
  address: string;
  boro: number;
  tax_class: string;
  bldg_class: string | null;
  fmv: number | null;
  eligible: boolean;
  on_supplemental: boolean;
};

export type PropertyResponse = {
  property: Property;
  owner: OwnerSummary | null;
  otherProperties: PropertyListItem[];
};

export type OwnerResponse = {
  owner: OwnerSummary;
  properties: PropertyListItem[];
  truncated: boolean;
};

/**
 * [lng, lat, fmv, parid, tier]
 * tier 0 = any NYC property, 1 = on the supplemental roll, 2 = may be subject
 * to the surcharge.
 */
export type MapTier = 0 | 1 | 2;
export type MapPoint = [number, number, number | null, string, MapTier];

/**
 * The three tiers, counted. `allProperties >= supplementalCount >=
 * eligibleCount`, and each `*Fmv` is the FMV sum over the same set.
 */
export type StatsResponse = {
  /** tier 1 — every NYC parcel on the FY27 assessment roll */
  allProperties: number;
  /** alias of `allProperties`, kept for callers written before the city roll */
  properties: number;
  withCoords: number;
  owners: number;
  multiOwners: number;
  /** FMV of every NYC parcel */
  totalFmv: number;
  /** tier 2 — parcels on the 2027 supplemental roll */
  supplementalCount: number;
  supplementalFmv: number;
  /** tier 3 — parcels matching DOF's surcharge criteria */
  eligibleCount: number;
  eligibleFmv: number;
  topOwners: OwnerSummary[];
};

export type SearchMode = 'all' | 'owner' | 'address';
