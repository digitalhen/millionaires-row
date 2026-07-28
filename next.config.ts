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

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Standalone output so the app can be packaged into a slim Docker image later.
  output: 'standalone',
  reactStrictMode: true,
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // `pg` is a native-ish node module; keep it external to the server bundle.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
