import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import { SITE_URL } from '@/lib/basePath';
import 'maplibre-gl/dist/maplibre-gl.css';
import './globals.css';

const GA_ID = 'G-71RFY7NQVZ';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Millionaires' Row — NYC pied-à-terre tax roll",
  description:
    "Search and map the ~960,000 New York City properties on the Department of Finance's 2027 supplemental property roll.",
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* Google Analytics — loaded after hydration so it never blocks render. */}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
          strategy="afterInteractive"
        />
        <Script id="ga-init" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
        </Script>
      </body>
    </html>
  );
}
