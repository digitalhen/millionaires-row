import type { MetadataRoute } from 'next';
import { withBase } from '@/lib/basePath';
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/seo';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — NYC pied-à-terre tax roll`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: withBase('/'),
    scope: withBase('/'),
    display: 'standalone',
    background_color: '#000000',
    theme_color: '#000000',
    orientation: 'any',
    categories: ['reference', 'government', 'utilities'],
    icons: [
      {
        src: withBase('/icon.svg'),
        sizes: 'any',
        type: 'image/svg+xml',
      },
      {
        src: withBase('/icons/icon-192.png'),
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withBase('/icons/icon-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: withBase('/icons/icon-maskable-512.png'),
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
