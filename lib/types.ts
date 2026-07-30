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
  /** Apartment designation, only selected where a list is unit-level (the
   *  "in this building" table). Absent from owner-portfolio rows. */
  aptno?: string | null;
};

/**
 * The other parcels stacked on the same map point as this one — the reason a
 * click on a Manhattan apartment house lands on an arbitrary line of the roll.
 *
 * Two kinds of building produce a sibling set:
 *   • a co-op, where the roll carries one building-level record (the BBL) whose
 *     FMV is the aggregate, plus a `<bbl>-U0001…` row per apartment;
 *   • a condominium, where every unit is its own BBL and the only thing tying
 *     them together is (boro, block, condo_number).
 * A condominium normally has no building-level record, so `buildingRecord` is
 * null for one and the section is headed by a plain unit count instead.
 */
export type BuildingBlock = {
  /** The co-op building record — the aggregate row — or null (condos). */
  buildingRecord: PropertyListItem | null;
  /** The parcel being viewed IS that aggregate record. */
  isBuildingRecord: boolean;
  /**
   * How many unit rows the aggregate actually covers — the co-op's own `-U`
   * children, which is not the same as `unitCount`: a co-op inside a
   * condominium also has commercial units and a billing lot as siblings, and
   * the building record's FMV does not include them.
   */
  recordUnitCount: number;
  /** Siblings excluding the viewed parcel and the building record. */
  unitCount: number;
  /** The first `BUILDING_UNIT_CAP` of them, biggest DOF value first. */
  units: PropertyListItem[];
  /** `units` is a capped slice of `unitCount`. */
  truncated: boolean;
};

export type PropertyResponse = {
  property: Property;
  owner: OwnerSummary | null;
  otherProperties: PropertyListItem[];
  /** Omitted entirely for a standalone parcel (nothing shares its point). */
  building?: BuildingBlock;
};

export type OwnerResponse = {
  owner: OwnerSummary;
  properties: PropertyListItem[];
  truncated: boolean;
};

/**
 * [lng, lat, fmv, parid, tier, members, eligibleMembers]
 *
 * One mark on the map is one *building*, not one line of the roll: a 651-unit
 * condominium files 651 records at a single billing-lot coordinate, and drawing
 * all of them stacked one dot deep made a tower and a townhouse look identical.
 * `map_dots` collapses each stack (see scripts/build_map_dots.sh), so:
 *   • `parid` is a representative member — the highest-value *eligible* member
 *     when the dot is red (a red dot must open a record that is itself
 *     flagged), else the co-op building record where there is one, else the
 *     highest-value unit. It is what a click opens, and the property page's
 *     "in this building" block lists the rest;
 *   • `fmv` is the group's aggregate value, not the representative's;
 *   • `tier` is the *strongest* tier any member reaches, so a single eligible
 *     apartment turns the whole building red;
 *   • `members` is how many roll records the dot stands for — 1 for an ordinary
 *     parcel, and omitted by callers that only ever draw one (MiniMap);
 *   • `eligibleMembers` is how many of them are flagged themselves — the
 *     tooltip's "4 of 865 units", so a red tower never reads as the whole
 *     building's valuation being flagged.
 *
 * tier 0 = any NYC property, 1 = on the supplemental roll, 2 = may be subject
 * to the surcharge.
 */
export type MapTier = 0 | 1 | 2;
export type MapPoint = [number, number, number | null, string, MapTier, number?, number?];

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
