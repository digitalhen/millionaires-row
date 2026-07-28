import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapPoint, MapTier } from './types';
import { withBaseVersioned } from './basePath';

export const BOROUGHS_GEOJSON = withBaseVersioned('/geo/nyc-boroughs.geojson');

/**
 * Bumped whenever the citywide overview payload's shape or sampling rule
 * changes. The client appends it to the request URL alongside the per-build
 * `?v=`, so a browser or CDN holding a long-cached copy from an older point set
 * can never serve it back. 3 = three tiers, one uniform sample across all 1.2M
 * NYC parcels.
 */
export const OVERVIEW_VERSION = 3;

/** NYC, roughly. Used as the initial camera and as a clamp on panning. */
export const NYC_CENTER: [number, number] = [-73.95, 40.705];
export const NYC_BOUNDS: [[number, number], [number, number]] = [
  [-74.35, 40.44],
  [-73.65, 40.94],
];

/** Blank black canvas + white borough hairlines. No external tiles anywhere. */
export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'mrow-blueprint',
    sources: {
      boroughs: {
        type: 'geojson',
        data: BOROUGHS_GEOJSON,
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': '#000000' },
      },
      {
        id: 'boro-fill',
        type: 'fill',
        source: 'boroughs',
        paint: { 'fill-color': '#0a0a0a', 'fill-opacity': 1 },
      },
      {
        id: 'boro-line',
        type: 'line',
        source: 'boroughs',
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.5,
          'line-width': 1,
        },
      },
    ],
  };
}

/**
 * Three tiers, three weights. Colour alone separates them — all marks are the
 * same size, so a red parcel never looks "bigger", only different. Legibility
 * comes from opacity and paint order: grey background sits far back, white
 * reads as the roll, red sits on top at full strength.
 *
 * Chosen after comparing a few treatments: a size bump made red dominate and
 * misrepresent scale; a halo/glow smeared at citywide zoom where the marks are
 * ~2px. Full-opacity #ff453a against whites held at ~0.8 keeps red clearly
 * distinct at z9 without swamping the white mass.
 */
export const TIER_COLORS = {
  city: '#4d4d4d',
  roll: '#ffffff',
  eligible: '#ff453a',
} as const;

/**
 * Parcel marks use a `circle` layer rather than a square `symbol` layer:
 * MapLibre packs all symbols of one tile into a single bucket whose opacity
 * buffer tops out around 8k features, and the citywide overview puts tens of
 * thousands of parcels in one low-zoom tile ("opacityVertexArray.length !==
 * layoutVertexArray.length / 4"). Circle layers have no such limit and stay
 * smooth at 100k+ points; at these radii (1–6px) a dot and a square are
 * visually interchangeable.
 */
const FMV_OPACITY = [
  'interpolate',
  ['linear'],
  ['coalesce', ['get', 'v'], 0],
  0,
  0.55,
  1_000_000,
  0.75,
  5_000_000,
  0.9,
  25_000_000,
  1,
];

/** `zoom` is only legal as the input of a *top-level* interpolate, so the
 *  per-feature multiplier has to live inside each output stop. */
const opacityAtZoom = (factor: number) => ['*', factor, FMV_OPACITY];

/**
 * Radius is a function of zoom and nothing else — one parcel, one dot, exactly
 * the same size in all three tiers.
 *
 * It used to scale a little with FMV, which sounds neutral but is not: the red
 * tier is $1M-and-up by definition, so every red mark landed at the top of that
 * ramp and the surcharge tier rendered as physically bigger than the city
 * around it. A map whose job is to show how *small* that tier is cannot afford
 * that. Weight by value now lives entirely in opacity, where a brighter dot
 * still reads as a more valuable parcel but never as more parcels.
 */
const RADIUS_RAMP = [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  0.9,
  11,
  1.15,
  13,
  1.7,
  16,
  3,
  19,
  5.5,
];

/** Dim everything at citywide zooms so dense boroughs stay readable instead of
 *  burning out into a solid slab. */
const opacityRamp = (low: number, mid: number, high: number) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  opacityAtZoom(low),
  11,
  opacityAtZoom(mid),
  13,
  opacityAtZoom(high),
];

/** Zoom-only opacity, for the tiers where per-parcel value carries no meaning. */
const flatRamp = (low: number, mid: number, high: number) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  8,
  low,
  11,
  mid,
  13,
  high,
];

const tierIs = (t: number) => ['==', ['get', 'e'], t];

function tierLayer(
  id: string,
  source: string,
  tier: number,
  color: string,
  opacity: unknown,
): LayerSpecification {
  return {
    id,
    type: 'circle',
    source,
    filter: tierIs(tier),
    paint: {
      'circle-color': color,
      'circle-blur': 0,
      'circle-stroke-width': 0,
      'circle-radius': RADIUS_RAMP,
      'circle-opacity': opacity,
    },
  } as unknown as LayerSpecification;
}

/**
 * Order matters: every NYC parcel (grey) first, then the supplemental roll
 * (white), then the parcels that match the surcharge criteria (red) on top.
 */
export function propertyLayers(source: string): LayerSpecification[] {
  return [
    // Zoom-only opacity: an airport, a park and a vacant lot are all just
    // context here, and running the background tier through the FMV ramp as
    // well dimmed most of it to roughly RGB 21 — present in the buffer,
    // invisible on screen. Flat and a little stronger, #4d4d4d still lands
    // well under the faintest white, so grey reads as ground, not as data.
    tierLayer(`${source}-city`, source, 0, TIER_COLORS.city, flatRamp(0.6, 0.72, 0.85)),
    tierLayer(`${source}-roll`, source, 1, TIER_COLORS.roll, opacityRamp(0.6, 0.74, 0.88)),
    // Slightly held back at citywide zoom so the red corridor reads as a
    // pattern rather than a wall, then full strength once you are in close.
    tierLayer(`${source}-eligible`, source, 2, TIER_COLORS.eligible, flatRamp(0.82, 1, 1)),
  ];
}

/** Single-parcel mark for the property page locator map. */
export function singleParcelLayer(id: string, source: string): LayerSpecification {
  return {
    id,
    type: 'circle',
    source,
    paint: {
      'circle-color': [
        'case',
        tierIs(2),
        TIER_COLORS.eligible,
        tierIs(0),
        TIER_COLORS.city,
        TIER_COLORS.roll,
      ],
      'circle-radius': 4,
      'circle-opacity': 1,
    },
  } as unknown as LayerSpecification;
}

/**
 * Invisible, finger-sized hit target sitting under the squares. A 3px square is
 * impossible to tap on a phone; queryRenderedFeatures ignores paint opacity, so
 * a transparent circle gives pointer *and* touch input a real target.
 */
export function hitLayer(id: string, source: string): LayerSpecification {
  return {
    id,
    type: 'circle',
    source,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8,
        5,
        12,
        8,
        15,
        13,
        18,
        18,
      ],
      'circle-color': '#ffffff',
      'circle-opacity': 0,
    },
  } as unknown as LayerSpecification;
}

/** Ring drawn around the hovered / focused parcel. */
export function highlightLayer(id: string, source: string): LayerSpecification {
  return {
    id,
    type: 'circle',
    source,
    paint: {
      'circle-radius': 7,
      'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': 1,
    },
  } as unknown as LayerSpecification;
}

/** The currently selected parcel: a bright square inside a white ring. */
export function selectionLayers(source: string): LayerSpecification[] {
  return [
    {
      id: `${source}-ring`,
      type: 'circle',
      source,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 8, 16, 13, 19, 18],
        'circle-color': '#000000',
        'circle-opacity': 0.35,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5,
      },
    },
    {
      id: `${source}-dot`,
      type: 'circle',
      source,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 4.5, 19, 6],
        'circle-color': '#ffffff',
        'circle-opacity': 1,
      },
    },
  ] as unknown as LayerSpecification[];
}

export type PointFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id?: number;
    properties: { p: string; v: number | null; e: MapTier };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
};

export function pointsToGeoJSON(points: MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(([lng, lat, fmv, parid, tier], i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { p: parid, v: fmv, e: tier },
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
    })),
  };
}

export const EMPTY_FC: PointFeatureCollection = { type: 'FeatureCollection', features: [] };
