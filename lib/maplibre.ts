/**
 * Lazily load MapLibre GL in the browser, with its worker pointed at the copy
 * we serve from /public (see tools/copy-maplibre-worker.mjs for why).
 */
let loader: Promise<typeof import('maplibre-gl')> | null = null;

export const MAPLIBRE_WORKER_URL = '/maplibre/maplibre-gl-worker.mjs';

export function loadMapLibre(): Promise<typeof import('maplibre-gl')> {
  if (!loader) {
    loader = import('maplibre-gl').then((mod) => {
      mod.setWorkerUrl(MAPLIBRE_WORKER_URL);
      return mod;
    });
  }
  return loader;
}
