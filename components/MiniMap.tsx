'use client';

import { useEffect, useRef } from 'react';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { baseStyle, pointsToGeoJSON, singleParcelLayer } from '@/lib/mapStyle';
import { loadMapLibre } from '@/lib/maplibre';
import type { MapTier } from '@/lib/types';

/** Small non-interactive locator map used on the property page. */
export default function MiniMap({
  longitude,
  latitude,
  fmv,
  parid,
  tier,
}: {
  longitude: number;
  latitude: number;
  fmv: number | null;
  parid: string;
  tier: MapTier;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    let map: MapLibreMap | null = null;

    (async () => {
      const maplibre = await loadMapLibre();
      if (disposed || !containerRef.current) return;

      map = new maplibre.Map({
        container: containerRef.current,
        style: baseStyle(),
        center: [longitude, latitude],
        zoom: 14.5,
        minZoom: 10,
        maxZoom: 18,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        renderWorldCopies: false,
      });
      map.touchZoomRotate?.disableRotation();
      map.scrollZoom.disable();

      map.on('load', () => {
        if (!map) return;
        map.addSource('props', {
          type: 'geojson',
          data: pointsToGeoJSON([[longitude, latitude, fmv, parid, tier]]),
        });
        map.addLayer(singleParcelLayer('props', 'props'));
        map.addLayer({
          id: 'crosshair',
          type: 'circle',
          source: 'props',
          paint: {
            'circle-radius': 10,
            'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 1,
          },
        });
      });
    })();

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [longitude, latitude, fmv, parid, tier]);

  return <div ref={containerRef} className="map-canvas" aria-label="Property location" />;
}
