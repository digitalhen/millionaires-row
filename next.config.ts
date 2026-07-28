import type { NextConfig } from 'next';

/**
 * The app is deployed under a subpath in production
 * (https://apps.cleartextlabs.com/millionaires-row) and at the root locally.
 * Everything derives from NEXT_PUBLIC_BASE_PATH so there is a single switch.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

/**
 * Changes on every build. Long-lived API/asset caches are keyed on it so a new
 * deploy always refetches, while everything stays cacheable within a deploy.
 */
const buildId = process.env.NEXT_PUBLIC_BUILD_ID || String(Date.now());

/**
 * The dynamically rendered HTML pages — the home page, `/leaderboards`,
 * `/property/*`, `/owner/*`.
 *
 * Next stamps `private, no-cache, no-store` on anything it renders per request,
 * which is right for a page that could contain someone's session and wrong for
 * every page here: this site has no accounts, no cookies and a read-only roll,
 * so a given URL renders identically for everyone until the next deploy. The
 * value below is the same shape Next itself emits for the ISR pages
 * (`/borough/*`, `/zip/*`) — a shared cache may hold it, a browser still
 * revalidates. `max-age=0` is deliberate: these URLs also serve the RSC payload
 * for client navigations, keyed only by `Vary`, and there is nothing to gain
 * from betting on browsers getting that right.
 */
const HTML_CACHE_CONTROL =
  'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Standalone output so the app can be packaged into a slim Docker image later.
  output: 'standalone',
  reactStrictMode: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // `pg` is a native-ish node module; keep it external to the server bundle.
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/:path(|leaderboards|property/.*|owner/.*)',
        headers: [{ key: 'Cache-Control', value: HTML_CACHE_CONTROL }],
      },
    ];
  },
};

export default nextConfig;
