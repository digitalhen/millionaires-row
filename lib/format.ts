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

/** PARID is the 10-digit BBL: 1 boro + 5 block + 4 lot. */
export function formatBbl(parid: string): string {
  if (/^\d{10}$/.test(parid)) {
    return `${parid.slice(0, 1)}-${parid.slice(1, 6)}-${parid.slice(6)}`;
  }
  return parid;
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
  R0: 'Condominium billing lot',
  R1: 'Condo — residential unit, 2-10 unit building',
  R2: 'Condo — residential unit, walk-up',
  R3: 'Condo — residential unit, 1-3 stories',
  R4: 'Condo — residential unit, elevator building',
  R5: 'Condo — miscellaneous / commercial',
  R6: 'Condo — residential unit in 1-3 family building',
  R7: 'Condo — commercial unit in 1-3 family building',
  R8: 'Condo — commercial unit in 2-10 unit building',
  R9: 'Condo — co-op within a condominium',
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
