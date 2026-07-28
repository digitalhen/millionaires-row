'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Feature, Point } from 'geojson';
import type { GeoJSONSource, MapLayerMouseEvent, Map as MapLibreMap } from 'maplibre-gl';
import type { MapPoint } from '@/lib/types';
import {
  EMPTY_FC,
  NYC_BOUNDS,
  NYC_CENTER,
  baseStyle,
  highlightLayer,
  pointsToGeoJSON,
  propertyLayer,
  squareIcon,
} from '@/lib/mapStyle';
import { money } from '@/lib/format';
import { loadMapLibre } from '@/lib/maplibre';
import AboutNote from './AboutNote';

/** Above this zoom we fetch the exact parcels in view instead of the overview. */
const DETAIL_ZOOM = 13;
const MOVE_DEBOUNCE_MS = 300;

type Tooltip = {
  x: number;
  y: number;
  parid: string;
  fmv: number | null;
  address: string | null;
};

const addressCache = new Map<string, string>();

export default function MapExplorer() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overviewRef = useRef<MapPoint[] | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<'overview' | 'viewport' | null>(null);

  const [status, setStatus] = useState('Loading parcels…');
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  const setData = useCallback((points: MapPoint[]) => {
    const map = mapRef.current;
    if (!map) return;
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
          const res = await fetch('/api/map/overview', { signal: ac.signal });
          if (!res.ok) throw new Error(`overview ${res.status}`);
          overviewRef.current = (await res.json()) as MapPoint[];
        }
        modeRef.current = 'overview';
        setData(overviewRef.current);
        setStatus(
          `Overview · ${overviewRef.current.length.toLocaleString()} highest-value parcels · zoom in for all`,
        );
      } else {
        const b = map.getBounds();
        const bbox = [
          b.getWest().toFixed(5),
          b.getSouth().toFixed(5),
          b.getEast().toFixed(5),
          b.getNorth().toFixed(5),
        ].join(',');
        const res = await fetch(`/api/map/points?bbox=${bbox}&limit=20000`, {
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(`points ${res.status}`);
        const points = (await res.json()) as MapPoint[];
        modeRef.current = 'viewport';
        setData(points);
        setStatus(
          `In view · ${points.length.toLocaleString()} parcels${points.length >= 20000 ? ' (capped)' : ''}`,
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
        center: NYC_CENTER,
        zoom: 10.1,
        minZoom: 8.5,
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
        if (!map.hasImage('sq')) map.addImage('sq', squareIcon());

        map.addSource('props', { type: 'geojson', data: EMPTY_FC });
        map.addSource('hover', { type: 'geojson', data: EMPTY_FC });
        map.addLayer(propertyLayer('props', 'props'));
        map.addLayer(highlightLayer('hover', 'hover'));

        map.on('mousemove', 'props', (e: MapLayerMouseEvent) => {
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
          });
          if (!addressCache.has(parid)) {
            fetch(`/api/property/${encodeURIComponent(parid)}`)
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

        map.on('mouseleave', 'props', () => {
          if (!map) return;
          map.getCanvas().style.cursor = '';
          (map.getSource('hover') as GeoJSONSource).setData(EMPTY_FC);
          setTooltip(null);
        });

        map.on('click', 'props', (e: MapLayerMouseEvent) => {
          const f = (e.features ?? [])[0];
          const parid = f?.properties?.p;
          if (parid) router.push(`/property/${encodeURIComponent(String(parid))}`);
        });

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
  }, [refresh, router]);

  return (
    <>
      <div ref={containerRef} className="map-canvas" aria-label="Map of New York City properties" />
      {tooltip && (
        <div className="map-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div>{tooltip.address ?? tooltip.parid}</div>
          <div className="t-fmv">{money(tooltip.fmv)}</div>
        </div>
      )}
      <div className="map-foot">
        <p className="map-status">{status}</p>
        <AboutNote compact />
      </div>
    </>
  );
}
