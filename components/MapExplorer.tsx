'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Feature, Point } from 'geojson';
import type { GeoJSONSource, MapLayerMouseEvent, Map as MapLibreMap } from 'maplibre-gl';
import type { MapPoint } from '@/lib/types';
import {
  EMPTY_FC,
  NYC_BOUNDS,
  NYC_CENTER,
  OVERVIEW_VERSION,
  baseStyle,
  highlightLayer,
  hitLayer,
  selectionLayers,
  pointsToGeoJSON,
  propertyLayers,
} from '@/lib/mapStyle';
import { withBase, withBaseVersioned } from '@/lib/basePath';
import { money } from '@/lib/format';
import { loadMapLibre } from '@/lib/maplibre';
import AboutNote from './AboutNote';

/** Above this zoom we fetch the exact parcels in view instead of the overview. */
const DETAIL_ZOOM = 12;
const MOVE_DEBOUNCE_MS = 300;
/** Cap on a single viewport fetch. */
const BBOX_LIMIT = 40_000;
/** Zoom the camera settles on when a parcel is selected. */
const SELECT_ZOOM = 14.3;

type Tooltip = {
  x: number;
  y: number;
  parid: string;
  fmv: number | null;
  address: string | null;
  /** render to the left of the cursor when near the right edge */
  flip: boolean;
};

const addressCache = new Map<string, string>();

export type MapFocus = { lng: number; lat: number; parid: string };

export default function MapExplorer({
  focus,
  onSelect,
}: {
  /** Coordinates of the selected parcel, or null when nothing is selected. */
  focus: MapFocus | null;
  onSelect: (parid: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overviewRef = useRef<MapPoint[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<'overview' | 'viewport' | null>(null);

  const [status, setStatus] = useState('Loading parcels…');
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [ready, setReady] = useState(false);
  // The grey background tier only exists once the full city roll is loaded.
  const [hasCityTier, setHasCityTier] = useState(false);

  const setData = useCallback((points: MapPoint[]) => {
    const map = mapRef.current;
    if (!map) return;
    if (points.some((pt) => pt[4] === 0)) setHasCityTier(true);
    const src = map.getSource('props') as GeoJSONSource | undefined;
    if (src) src.setData(pointsToGeoJSON(points));
  }, []);

  /** Decide what to show for the current camera and load it. */
  const refresh = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = map.getZoom();

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    try {
      if (zoom < DETAIL_ZOOM) {
        if (modeRef.current === 'overview') return;
        if (!overviewRef.current) {
          setStatus('Loading citywide overview…');
          // ?s= pins the sampling rule on top of the per-build ?v=, so a cached
          // payload from an older point set can never be reused.
          const res = await fetch(withBaseVersioned(`/api/map/overview?s=${OVERVIEW_VERSION}`), {
            signal: ac.signal,
          });
          if (!res.ok) throw new Error(`overview ${res.status}`);
          overviewRef.current = (await res.json()) as MapPoint[];
        }
        modeRef.current = 'overview';
        setData(overviewRef.current);
        setStatus(
          `Overview · sample of ${overviewRef.current.length.toLocaleString()} parcels · zoom in for all`,
        );
      } else {
        const b = map.getBounds();
        const bbox = [
          b.getWest().toFixed(5),
          b.getSouth().toFixed(5),
          b.getEast().toFixed(5),
          b.getNorth().toFixed(5),
        ].join(',');
        const res = await fetch(withBase(`/api/map/points?bbox=${bbox}&limit=${BBOX_LIMIT}`), {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`points ${res.status}`);
        const points = (await res.json()) as MapPoint[];
        modeRef.current = 'viewport';
        setData(points);
        setStatus(
          points.length >= BBOX_LIMIT
            ? `In view · first ${BBOX_LIMIT.toLocaleString()} parcels — zoom in for the rest`
            : `In view · ${points.length.toLocaleString()} parcels`,
        );
      }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      console.error(err);
      setStatus('Could not load parcels');
    }
  }, [setData]);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;

    (async () => {
      const maplibre = await loadMapLibre();
      if (disposed || !containerRef.current) return;

      map = new maplibre.Map({
        container: containerRef.current,
        style: baseStyle(),
        // Frame the whole city regardless of viewport shape — a fixed zoom
        // crops badly on a phone.
        bounds: NYC_BOUNDS,
        fitBoundsOptions: { padding: 8, duration: 0 },
        center: NYC_CENTER,
        minZoom: 8,
        maxZoom: 19,
        maxBounds: NYC_BOUNDS,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
      });
      mapRef.current = map;
      map.touchZoomRotate?.disableRotation();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');

      map.on('load', () => {
        if (!map) return;
        map.addSource('props', { type: 'geojson', data: EMPTY_FC });
        map.addSource('hover', { type: 'geojson', data: EMPTY_FC });
        map.addSource('sel', { type: 'geojson', data: EMPTY_FC });
        map.addLayer(hitLayer('hit', 'props'));
        for (const layer of propertyLayers('props')) map.addLayer(layer);
        map.addLayer(highlightLayer('hover', 'hover'));
        for (const layer of selectionLayers('sel')) map.addLayer(layer);

        map.on('mousemove', 'hit', (e: MapLayerMouseEvent) => {
          const f = (e.features ?? [])[0];
          if (!f) return;
          const parid = String(f.properties?.p ?? '');
          const fmv = f.properties?.v == null ? null : Number(f.properties.v);
          const coords = (f.geometry as Point).coordinates as [number, number];
          map!.getCanvas().style.cursor = 'pointer';
          const hovered: Feature = {
            type: 'Feature',
            properties: {},
            geometry: { type: 'Point', coordinates: coords },
          };
          (map!.getSource('hover') as GeoJSONSource).setData(hovered);
          setTooltip({
            x: e.point.x,
            y: e.point.y,
            parid,
            fmv,
            address: addressCache.get(parid) ?? null,
            flip: e.point.x > map!.getCanvas().clientWidth - 240,
          });
          if (!addressCache.has(parid)) {
            fetch(withBase(`/api/property/${encodeURIComponent(parid)}`))
              .then((r) => (r.ok ? r.json() : null))
              .then((d) => {
                if (!d?.property) return;
                addressCache.set(parid, d.property.address as string);
                setTooltip((t) =>
                  t && t.parid === parid ? { ...t, address: d.property.address } : t,
                );
              })
              .catch(() => {});
          }
        });

        map.on('mouseleave', 'hit', () => {
          if (!map) return;
          map.getCanvas().style.cursor = '';
          (map.getSource('hover') as GeoJSONSource).setData(EMPTY_FC);
          setTooltip(null);
        });

        // Fires for a touch tap as well as a mouse click: opens the details
        // panel rather than navigating away from the map.
        map.on('click', 'hit', (e: MapLayerMouseEvent) => {
          const f = (e.features ?? [])[0];
          const parid = f?.properties?.p;
          if (parid) onSelect(String(parid));
        });

        setReady(true);
        void refresh();
      });

      map.on('moveend', () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => void refresh(), MOVE_DEBOUNCE_MS);
      });

      map.on('error', (e) => console.error('[map]', e?.error ?? e));
    })();

    return () => {
      disposed = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      map?.remove();
      mapRef.current = null;
    };
  }, [refresh, onSelect]);

  /* Selection: ring the chosen parcel and glide the camera to it, keeping the
     point clear of the side panel (desktop) or bottom sheet (mobile). */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource('sel') as GeoJSONSource | undefined;
    if (!src) return;
    if (!focus) {
      src.setData(EMPTY_FC);
      return;
    }
    const feature: Feature = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Point', coordinates: [focus.lng, focus.lat] },
    };
    src.setData(feature);

    const canvas = map.getCanvas();
    const isSheet = window.matchMedia('(max-width: 760px)').matches;
    const offset: [number, number] = isSheet
      ? [0, -Math.round(canvas.clientHeight * 0.24)]
      : [-Math.round(Math.min(canvas.clientWidth * 0.22, 210)), 0];

    map.flyTo({
      center: [focus.lng, focus.lat],
      // Neighbourhood scale — enough context to place the parcel. Never zoom
      // the user back out if they are already closer in than that.
      zoom: Math.max(map.getZoom(), SELECT_ZOOM),
      offset,
      duration: 1100,
      essential: true,
    });
  }, [focus, ready]);

  return (
    <>
      <div ref={containerRef} className="map-canvas" aria-label="Map of New York City properties" />
      {tooltip && (
        <div
          className={`map-tooltip${tooltip.flip ? ' flip' : ''}`}
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div>{tooltip.address ?? tooltip.parid}</div>
          <div className="t-fmv">{money(tooltip.fmv)}</div>
        </div>
      )}
      <div className="map-foot">
        <div>
          <p className="map-legend">
            {hasCityTier && (
              <>
                <span className="key key-city">■</span> NYC property
              </>
            )}
            <span className="key key-roll">■</span> supplemental roll
            <span className="key key-eligible">■</span> may be subject
          </p>
          <p className="map-status">{status}</p>
        </div>
        <AboutNote compact />
      </div>
    </>
  );
}
