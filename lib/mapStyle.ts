import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapPoint } from './types';

export const BOROUGHS_GEOJSON = '/geo/nyc-boroughs.geojson';

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

/** Square icon: a solid white RGBA bitmap registered as a map image. */
export const SQUARE_ICON_SIZE = 6;

export function squareIcon() {
  const s = SQUARE_ICON_SIZE;
  const data = new Uint8Array(s * s * 4).fill(255);
  return { width: s, height: s, data };
}

/**
 * Layout/paint for the property layer. Size and opacity both step up subtly
 * with FMV so expensive parcels read brighter without becoming blobs.
 */
const POINT_LAYOUT = {
  'icon-image': 'sq',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'icon-optional': true,
  'icon-size': [
    '*',
    ['interpolate', ['linear'], ['zoom'], 8, 0.28, 11, 0.36, 13, 0.5, 16, 0.9, 18, 1.5],
    [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'v'], 0],
      0,
      0.85,
      1_000_000,
      1,
      5_000_000,
      1.2,
      50_000_000,
      1.7,
    ],
  ],
} as const;

const POINT_PAINT = {
  'icon-opacity': [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'v'], 0],
    0,
    0.45,
    1_000_000,
    0.68,
    5_000_000,
    0.85,
    25_000_000,
    1,
  ],
} as const;

/** The property layer: white squares, subtly scaled/brightened by FMV. */
export function propertyLayer(id: string, source: string): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source,
    layout: POINT_LAYOUT,
    paint: POINT_PAINT,
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

export type PointFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id?: number;
    properties: { p: string; v: number | null };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
};

export function pointsToGeoJSON(points: MapPoint[]): PointFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map(([lng, lat, fmv, parid], i) => ({
      type: 'Feature' as const,
      id: i,
      properties: { p: parid, v: fmv },
      geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] },
    })),
  };
}

export const EMPTY_FC: PointFeatureCollection = { type: 'FeatureCollection', features: [] };
