import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output so the app can be packaged into a slim Docker image later.
  output: 'standalone',
  reactStrictMode: true,
  // `pg` is a native-ish node module; keep it external to the server bundle.
  serverExternalPackages: ['pg'],
};

export default nextConfig;
