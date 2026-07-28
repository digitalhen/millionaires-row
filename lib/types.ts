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
  property_count: number;
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

export type StatsResponse = {
  properties: number;
  withCoords: number;
  owners: number;
  multiOwners: number;
  totalFmv: number;
  /** parcels on the 2027 supplemental roll (equals `properties` until the
   *  full city roll is loaded) */
  supplementalCount: number;
  /** parcels matching DOF's surcharge criteria */
  eligibleCount: number;
  eligibleFmv: number;
  topOwners: OwnerSummary[];
};

export type SearchMode = 'all' | 'owner' | 'address';
