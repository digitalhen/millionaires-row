/**
 * Lazily load MapLibre GL in the browser, with its worker pointed at the copy
 * we serve from /public (see tools/copy-maplibre-worker.mjs for why).
 */
import { withBase } from './basePath';

let loader: Promise<typeof import('maplibre-gl')> | null = null;

export const MAPLIBRE_WORKER_URL = withBase('/maplibre/maplibre-gl-worker.mjs');

/**
 * Can this browser give MapLibre the WebGL2 context it requires?
 *
 * Asking first is the only reliable signal. MapLibre 6 does not throw when the
 * context is missing: `new Map()` fires a `GPUInitializationError` on an
 * `error` listener the caller has had no chance to register yet, returns a
 * half-built map with no painter, and then never fires `load` — so a caller
 * waiting on `load` waits for ever. Probing also spares an unsupported browser
 * the ~900KB map bundle.
 *
 * The throwaway context is released immediately: browsers cap the number of
 * live WebGL contexts per page, and this one is only ever a question.
 */
export function hasWebGL2(): boolean {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function loadMapLibre(): Promise<typeof import('maplibre-gl')> {
  if (!loader) {
    loader = import('maplibre-gl').then((mod) => {
      mod.setWorkerUrl(MAPLIBRE_WORKER_URL);
      return mod;
    });
  }
  return loader;
}
