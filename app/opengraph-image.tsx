import { ImageResponse } from 'next/og';
import {
  Chip,
  DomainMark,
  OG,
  OgFooterRow,
  OgShell,
  OgStat,
  ogMoneyCompact,
  ogNum,
} from '@/lib/og';
import { getHeadlineStats } from '@/lib/queries';
import { OG_SIZE } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Millionaires' Row — NYC's 2027 pied-à-terre tax roll, searchable and mapped";
export const runtime = 'nodejs';

/**
 * Rendered per request, like the leaderboards card and for the same reason —
 * only more so, because this one is the site's default share image.
 *
 * Prerendered, Next bakes it at build time, and production builds run against
 * a dummy DATABASE_URL: every deploy therefore shipped the FALLBACK figures
 * below, frozen at whatever they said when they were last edited. They went a
 * whole data expansion out of date that way. The CDN headers carry the caching
 * that `revalidate` used to.
 */
export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

/**
 * Error-path defaults only — the card queries live figures on every request and
 * these are used solely when the database is unreachable. `eligibleCount` stays
 * 0 (which hides the chip) on purpose: the surcharge tier is the one figure
 * that moves whenever the eligibility rules are re-run, and a stale count in
 * the site's own accent colour is worse than no chip at all.
 */
const FALLBACK = {
  allCount: 1_200_123,
  rollCount: 959_710,
  rollFmv: 1_023_000_000_000,
  eligibleCount: 0,
};

export default async function Image() {
  let stats = null;
  try {
    stats = await getHeadlineStats();
  } catch (err) {
    console.error('[og:home] stats unavailable', err);
  }
  const s = stats ?? FALLBACK;

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooterRow>
            <div style={{ display: 'flex' }}>
              <OgStat label="NYC parcels" value={ogNum(s.allCount)} size={50} gap={44} />
              <OgStat label="On the roll" value={ogNum(s.rollCount)} size={50} gap={44} />
              <OgStat
                label="Roll market value"
                value={ogMoneyCompact(s.rollFmv)}
                size={50}
                gap={44}
              />
            </div>
            <DomainMark />
          </OgFooterRow>
        }
      >
        {s.eligibleCount > 0 && (
          <div style={{ display: 'flex', marginBottom: 26 }}>
            <Chip
              tone="eligible"
              label={`${ogNum(s.eligibleCount)} MAY BE SUBJECT TO SURCHARGE`}
            />
          </div>
        )}

        <div style={{ fontSize: 82, lineHeight: 1.1, letterSpacing: 2 }}>
          SEARCH THE ROLL
        </div>
        <div style={{ fontSize: 26, letterSpacing: 2, color: OG.grey1, marginTop: 20 }}>
          Every parcel in New York City, mapped — and for the nearly one million
          on the Department of Finance 2027 supplemental roll, the owner, DOF
          full market value and building class.
        </div>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
