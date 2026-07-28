import type { MapTier } from './types';

/** 0 = any NYC parcel, 1 = on the supplemental roll, 2 = may be subject. */
export function tierOf(p: { eligible: boolean; on_supplemental: boolean }): MapTier {
  if (p.eligible) return 2;
  return p.on_supplemental ? 1 : 0;
}

export const BOROUGHS: Record<number, string> = {
  1: 'Manhattan',
  2: 'The Bronx',
  3: 'Brooklyn',
  4: 'Queens',
  5: 'Staten Island',
};

export function boroName(boro: number | null | undefined): string {
  if (boro == null) return 'Unknown';
  return BOROUGHS[boro] ?? `Borough ${boro}`;
}

/**
 * URL slugs for the five boroughs. Fixed strings rather than a slugify() of
 * `BOROUGHS` — "The Bronx" would slug to `the-bronx`, and these are permanent
 * public URLs, so they are written out and never derived.
 */
export const BOROUGH_SLUGS: Record<number, string> = {
  1: 'manhattan',
  2: 'bronx',
  3: 'brooklyn',
  4: 'queens',
  5: 'staten-island',
};

export const BOROUGH_CODES: readonly number[] = [1, 2, 3, 4, 5];

const SLUG_TO_BORO = new Map<string, number>(
  Object.entries(BOROUGH_SLUGS).map(([code, slug]) => [slug, Number(code)]),
);

export function boroSlug(boro: number): string {
  return BOROUGH_SLUGS[boro] ?? String(boro);
}

/** Borough code for a URL slug, or null when the slug is not one of the five. */
export function boroFromSlug(slug: string): number | null {
  return SLUG_TO_BORO.get(slug.trim().toLowerCase()) ?? null;
}

/**
 * NYC ZIP codes are all 10xxx (Manhattan, the Bronx, Staten Island) or 11xxx
 * (Brooklyn, Queens). The roll also carries a handful of out-of-range and
 * placeholder values ('0', ZIP+4 strings, four rows in 00xxx and 12xxx); this
 * is the gate that keeps them out of the URL space.
 */
export function isNycZip(zip: string): boolean {
  return /^1[01]\d{3}$/.test(zip);
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function money(v: number | null | undefined): string {
  if (v == null) return '—';
  return usd.format(v);
}

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function moneyCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  return `$${compact.format(v)}`;
}

const int = new Intl.NumberFormat('en-US');

export function num(v: number | null | undefined): string {
  if (v == null) return '—';
  return int.format(v);
}

/**
 * Human-readable BBL, built from the component columns.
 *
 * `parid` is an OPAQUE identifier and must never be parsed: co-op unit rows
 * that share a BBL with their building record carry a deterministic suffix
 * (e.g. `1000110014-U0001`), so it is neither numeric nor fixed-length.
 */
export function formatBbl(
  boro: number,
  block: number,
  lot: number,
): string {
  return `${boro}-${String(block).padStart(5, '0')}-${String(lot).padStart(4, '0')}`;
}

/**
 * Display label for a parcel.
 *
 * `address` is NOT NULL on the roll, but 46 parcels carry an *empty* one —
 * the source row has neither a house number nor a street name. Rendered raw
 * that produced an empty `<h1>`, a `<title>` opening with a stray em dash and
 * an empty JSON-LD `name`. Every parcel has a BBL, so that is the fallback
 * wherever the component columns are to hand; list rows, which only carry the
 * opaque `parid`, get a plain placeholder instead (`parid` must never be
 * parsed back into a BBL — see `formatBbl`).
 */
export function addressLabel(
  address: string | null | undefined,
  bbl?: { boro: number; block: number; lot: number },
): string {
  const trimmed = (address ?? '').trim();
  if (trimmed) return trimmed;
  return bbl ? `BBL ${formatBbl(bbl.boro, bbl.block, bbl.lot)}` : 'No address on roll';
}

/**
 * Building-scale roll records: one row standing for a whole house rather than
 * for somewhere anyone lives.
 *
 *   R9 — a co-op *within* a condominium: the co-op corporation's residential
 *        portion filed as a single lot, with no `-U` children of its own.
 *   R0 — a condominium's billing lot, the administrative row that carries the
 *        building's residential portion.
 *
 * Both are owned by a corporation and carry a whole-building FMV, so every
 * surface that prints a value has to say so — presented bare, CHURCHILL OWNERS
 * CORP's $185m reads as the asking price of an apartment. This is a *class*
 * test rather than the "does it have `-U` children" test behind
 * `BuildingBlock.isBuildingRecord`, which these records fail precisely because
 * their units are not on the roll separately.
 */
const BUILDING_SCALE_CLASSES = new Set(['R9', 'R0']);

export function isBuildingScaleRecord(code: string | null | undefined): boolean {
  if (!code) return false;
  return BUILDING_SCALE_CLASSES.has(code.trim().toUpperCase());
}

/** One-liner shown next to the headline of a building-scale record. */
export const BUILDING_SCALE_NOTE =
  "This record covers a whole building's residential portion, not an individual home.";

/** Caption fragment for a building-scale figure ("DOF estimate · …"). */
export const BUILDING_SCALE_CAPTION = 'entire building/co-op';

/**
 * Share text for a property — rides along with the link in the native share
 * sheet and the clipboard copy. Tabloid energy, public-record facts: values
 * are always attributed to the city and the tax is always "may", never "owes".
 *
 * No count of the eligible tier appears here on purpose. It used to ("one of
 * 28,906 NYC homes…") and went stale the first time the eligibility rules were
 * re-run; the sentence carries the same weight without a number that has to be
 * kept in sync with the database.
 */
export function shareSummary(
  p: {
    address: string | null;
    boro: number;
    block: number;
    lot: number;
    fmv: number | null;
    owner: string | null;
    eligible: boolean;
    on_supplemental: boolean;
    bldg_class?: string | null;
  },
  ownerPropertyCount?: number | null,
): string {
  const addr = addressLabel(p.address, p);
  const where = boroName(p.boro);
  const value = p.fmv != null ? money(p.fmv) : null;
  const who = p.owner ? `Owned by ${p.owner}` : 'Owner? Not on file 🤐';
  const portfolio =
    ownerPropertyCount && ownerPropertyCount > 1
      ? ` — and that's just 1 of their ${num(ownerPropertyCount)} NYC properties 🧾`
      : '';
  // A whole-building record: never let the figure or the tax read as one home's.
  const whole = isBuildingScaleRecord(p.bldg_class);

  if (p.eligible) {
    const valued = whole
      ? `the city pegs the whole building at ${value ?? 'a mystery number'}`
      : `the city pegs it at ${value ?? 'a mystery number'}`;
    const tax = whole
      ? "The building may owe NYC's new pied-à-terre tax 💸"
      : "It might owe NYC's new pied-à-terre tax 💸";
    return (
      `👀 ${addr}, ${where} — ${valued}. ` +
      `${who}${portfolio}. ` +
      `${tax} See who else made the list 🗽`
    );
  }
  if (p.on_supplemental) {
    const valued = value
      ? whole
        ? `The city values the whole building at ${value}. `
        : `The city says it's worth ${value}. `
      : '';
    return (
      `🗽 ${addr}, ${where} is on NYC's pied-à-terre tax watchlist. ` +
      `${valued}${who}${portfolio}. Look up any address 👇`
    );
  }
  const valued = value
    ? whole
      ? ` — the whole building valued at ${value} by the city`
      : ` — valued at ${value} by the city`
    : '';
  return (
    `🏙️ ${addr}, ${where}${valued}. ` +
    `${who}${portfolio}. Not on the pied-à-terre tax list (this time). Check your block 👇`
  );
}

export function taxClassLabel(taxClass: string): string {
  switch (taxClass) {
    case '1':
      return 'Class 1 — 1-3 family homes';
    case '1A':
    case '1B':
    case '1C':
    case '1D':
      return `Class ${taxClass} — small residential`;
    case '2':
      return 'Class 2 — rentals, co-ops & condos';
    case '2A':
      return 'Class 2A — 4-6 unit rental';
    case '2B':
      return 'Class 2B — 7-10 unit rental';
    case '2C':
      return 'Class 2C — co-op/condo, 2-10 units';
    case '3':
      return 'Class 3 — utility property';
    case '4':
      return 'Class 4 — commercial';
    default:
      return `Class ${taxClass}`;
  }
}

/**
 * NYC DOF building class codes. Covers the residential families (A–D, R, S)
 * that dominate the supplemental roll plus the common non-residential codes;
 * unknown codes fall back to their letter family, then to the raw code.
 */
const BUILDING_CLASSES: Record<string, string> = {
  A0: 'One-family — Cape Cod',
  A1: 'One-family — two stories, detached',
  A2: 'One-family — one story, small',
  A3: 'One-family — large suburban',
  A4: 'One-family — city residence',
  A5: 'One-family — attached / semi-detached',
  A6: 'One-family — summer cottage',
  A7: 'One-family — mansion type',
  A8: 'One-family — bungalow colony',
  A9: 'One-family — miscellaneous',
  B1: 'Two-family — brick',
  B2: 'Two-family — frame',
  B3: 'Two-family — converted from one-family',
  B9: 'Two-family — miscellaneous',
  C0: 'Three-family',
  C1: 'Walk-up apartment — over six families',
  C2: 'Walk-up apartment — five to six families',
  C3: 'Walk-up apartment — four families',
  C4: 'Walk-up apartment — old law tenement',
  C5: 'Walk-up apartment — converted',
  C6: 'Walk-up co-operative',
  C7: 'Walk-up apartment with stores',
  C8: 'Walk-up co-operative',
  C9: 'Garden apartment complex',
  CM: 'Mobile home park',
  D0: 'Elevator co-operative — converted',
  D1: 'Elevator apartment — semi-fireproof',
  D2: 'Elevator apartment — artists in residence',
  D3: 'Elevator apartment — fireproof, over nine stories',
  D4: 'Elevator co-operative',
  D5: 'Elevator apartment — converted',
  D6: 'Elevator apartment with stores',
  D7: 'Elevator apartment with stores',
  D8: 'Elevator apartment — luxury',
  D9: 'Elevator apartment — miscellaneous',
  E1: 'Warehouse — fireproof',
  E9: 'Warehouse — miscellaneous',
  F1: 'Factory — heavy manufacturing',
  G1: 'Garage — all parking',
  G2: 'Auto body / repair shop',
  H1: 'Hotel — luxury',
  H3: 'Hotel — medium',
  H8: 'Dormitory',
  HB: 'Boutique hotel',
  HR: 'SRO hotel',
  HS: 'Hotel — extended stay',
  I1: 'Hospital / health facility',
  J1: 'Theatre',
  K1: 'Store building — one story',
  K2: 'Store building — two stories or more',
  K4: 'Store with apartments above',
  L1: 'Loft — over eight stories',
  M1: 'Church / synagogue',
  N1: 'Asylum',
  O1: 'Office — one story',
  O4: 'Office — tower type',
  P2: 'Lodge room',
  Q1: 'Park / playground',
  // R0/R9 are whole-building rows, not dwellings — see isBuildingScaleRecord().
  R0: 'Condominium billing lot — whole building, not a unit',
  R1: 'Condo — residential unit, 2-10 unit building',
  R2: 'Condo — residential unit, walk-up',
  R3: 'Condo — residential unit, 1-3 stories',
  R4: 'Condo — residential unit, elevator building',
  R5: 'Condo — miscellaneous / commercial',
  R6: 'Condo — residential unit in 1-3 family building',
  R7: 'Condo — commercial unit in 1-3 family building',
  R8: 'Condo — commercial unit in 2-10 unit building',
  R9: 'Co-op within a condominium — whole building, not a unit',
  RA: 'Condo — cultural / medical / educational',
  RB: 'Condo — office space',
  RG: 'Condo — indoor parking',
  RH: 'Condo — hotel unit',
  RK: 'Condo — retail space',
  RP: 'Condo — outdoor parking',
  RR: 'Condominium rentals',
  RS: 'Condo — non-business storage',
  RT: 'Condo — terraces / gardens / cabanas',
  RW: 'Condo — warehouse / factory / industrial',
  S0: 'Primarily residential — one-family with store',
  S1: 'Primarily residential — one-family with store',
  S2: 'Primarily residential — two-family with store',
  S3: 'Primarily residential — three-family with store',
  S4: 'Primarily residential — four-family with store',
  S5: 'Primarily residential — five to six families with store',
  S9: 'Primarily residential — seven or more families with store',
  V0: 'Vacant land — zoned residential',
  V1: 'Vacant land — zoned commercial / industrial',
  W1: 'School / public building',
  Z0: 'Tennis court / pool / miscellaneous',
  Z9: 'Miscellaneous',
};

const CLASS_FAMILIES: Record<string, string> = {
  A: 'One-family dwelling',
  B: 'Two-family dwelling',
  C: 'Walk-up apartment',
  D: 'Elevator apartment',
  E: 'Warehouse',
  F: 'Factory / industrial',
  G: 'Garage / gas station',
  H: 'Hotel',
  I: 'Hospital / health',
  J: 'Theatre',
  K: 'Store',
  L: 'Loft',
  M: 'Religious',
  N: 'Asylum / home',
  O: 'Office',
  P: 'Place of assembly',
  Q: 'Outdoor recreation',
  R: 'Condominium',
  S: 'Residential with store',
  T: 'Transportation',
  U: 'Utility',
  V: 'Vacant land',
  W: 'Educational',
  Y: 'Government / public',
  Z: 'Miscellaneous',
};

export function buildingClassLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!c) return null;
  return BUILDING_CLASSES[c] ?? CLASS_FAMILIES[c[0]] ?? null;
}
