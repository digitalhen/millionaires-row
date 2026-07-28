import { BASE_PATH, SITE_URL } from './basePath';

/**
 * Canonical / social URL helpers.
 *
 * Everything public-facing (canonical links, Open Graph, sitemap, JSON-LD)
 * must be an absolute URL built from NEXT_PUBLIC_SITE_URL, with the (usually
 * empty) basePath appended — `next/link` prefixes basePath for us, raw strings
 * do not.
 */
export const SITE_NAME = "Millionaires' Row";

export const SITE_TAGLINE =
  "NYC's 2027 pied-à-terre tax roll, searchable and mapped";

export const SITE_DESCRIPTION =
  "Search and map every property on the New York City Department of Finance's " +
  '2027 supplemental property roll — the parcels that may be subject to the ' +
  'non-primary-residence surcharge. Owner, DOF full market value and building ' +
  'class for each parcel.';

/** Origin without a trailing slash. */
export const ORIGIN = SITE_URL.replace(/\/+$/, '');

/** Absolute URL for a path inside the app (basePath aware). */
export function absoluteUrl(path = '/'): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${ORIGIN}${BASE_PATH}${p === '/' ? '/' : p}`;
}

/** `parid` is an opaque string ('1000110014-U0001'); always encode it. */
export function propertyPath(parid: string): string {
  return `/property/${encodeURIComponent(parid)}`;
}

export function ownerPath(ownerNorm: string): string {
  return `/owner/${encodeURIComponent(ownerNorm)}`;
}

export const LEADERBOARDS_PATH = '/leaderboards';

/** `slug` comes from `boroSlug()`, so it is already URL-safe. */
export function boroughPath(slug: string): string {
  return `/borough/${slug}`;
}

/** `zip` is validated as five digits before it ever reaches here. */
export function zipPath(zip: string): string {
  return `/zip/${zip}`;
}

/** Absolute URL of a route's generated Open Graph image. */
export function ogImageUrl(routePath = ''): string {
  return absoluteUrl(`${routePath}/opengraph-image`.replace(/\/{2,}/g, '/'));
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

/**
 * Decode a dynamic route segment without throwing.
 *
 * Page routes hand `params` over still percent-encoded, while route handlers
 * and metadata image routes hand them over already decoded — so the usual
 * `decodeURIComponent(param)` blows up (URIError → 500) on the ~250 owner
 * names that contain a literal `%` ("1ST REFORM CH % D MOSS"). Falling back to
 * the raw segment is right in exactly that case.
 */
export function decodeParam(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  // Postgres refuses a NUL inside a text parameter ("invalid byte sequence for
  // encoding UTF8: 0x00"), so `/property/123%00` used to throw out of the
  // driver and surface as a 500 rather than a 404. No identifier on the roll
  // contains one, so dropping them lets the lookup miss and 404 normally.
  return decoded.replace(/\0/g, '');
}

/** Serialised for a <script type="application/ld+json"> tag. */
export function jsonLdString(data: unknown): string {
  // `<` is escaped so a stray owner name can never close the script element.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
