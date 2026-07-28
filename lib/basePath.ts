/**
 * Base path helper.
 *
 * `next/link`, `useRouter()` and `next/image` prefix `basePath` automatically,
 * but raw `fetch()` calls and URLs handed to third-party libraries (MapLibre's
 * style sources and worker) do not — those must go through `withBase()`.
 *
 * NEXT_PUBLIC_* is inlined at build time, so this works in the browser bundle.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

export function withBase(path: string): string {
  if (!path.startsWith('/')) return `${BASE_PATH}/${path}`;
  return `${BASE_PATH}${path}`;
}

/** Absolute origin for canonical / OG URLs. */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

/**
 * Per-build identifier injected by next.config.ts. Appended to long-cached
 * URLs (the map overview payload, the borough outlines) so a fresh deploy is
 * never served a stale body out of the browser cache, while requests within a
 * deploy still hit the cache.
 */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID || 'dev';

/** basePath-aware URL with the build id appended as a cache key. */
export function withBaseVersioned(path: string): string {
  const url = withBase(path);
  return `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(BUILD_ID)}`;
}
