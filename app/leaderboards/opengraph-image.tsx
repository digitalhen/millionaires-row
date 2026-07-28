import { ImageResponse } from 'next/og';
import {
  DomainMark,
  Label,
  OG,
  OgFooterRow,
  OgShell,
  OgStat,
  autoSize,
  clip,
  ogMoney,
  ogMoneyCompact,
  ogNum,
} from '@/lib/og';
import { getLeaderboards } from '@/lib/aggregates';
import { addressLabel } from '@/lib/format';
import { OG_SIZE } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Leaderboards on Millionaires' Row — the largest portfolios and the highest DOF valuations on the 2027 supplemental roll";
export const runtime = 'nodejs';
/**
 * Rendered per request like the other record cards, not prerendered: this route
 * takes no params, so Next would otherwise bake it at build time — and a build
 * that cannot reach the database would freeze "FIGURES UNAVAILABLE" into the
 * card for the life of the image. The CDN headers below carry the caching.
 */
export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export default async function Image() {
  let boards = null;
  try {
    boards = await getLeaderboards();
  } catch (err) {
    console.error('[og:leaderboards] figures unavailable', err);
  }

  const owner = boards?.byRollCount[0] ?? null;
  const top = boards?.topProperties[0] ?? null;
  const ownerName = owner ? clip(owner.display_name.toUpperCase(), 46) : null;
  const ownerCount = owner ? (owner.roll_count ?? owner.property_count) : null;
  const address = top ? clip(addressLabel(top.address).toUpperCase(), 46) : null;

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooterRow>
            <div style={{ display: 'flex' }}>
              <OgStat
                label="Largest portfolio"
                value={ownerCount == null ? '—' : `${ogNum(ownerCount)} PARCELS`}
              />
              <OgStat
                label="Most expensive parcel"
                value={top ? ogMoneyCompact(top.fmv) : '—'}
              />
            </div>
            <DomainMark />
          </OgFooterRow>
        }
      >
        <div style={{ fontSize: 82, lineHeight: 1.1, letterSpacing: 4 }}>LEADERBOARDS</div>
        <div style={{ fontSize: 24, letterSpacing: 2, color: OG.grey1, marginTop: 16 }}>
          The largest portfolios and the highest DOF valuations on the New York
          City 2027 supplemental property roll.
        </div>

        {/* The two names behind the figures in the footer. */}
        <div style={{ display: 'flex', marginTop: 30 }}>
          <div style={{ display: 'flex', flexDirection: 'column', width: 520 }}>
            <Label>Top owner</Label>
            <div
              style={{
                fontSize: autoSize(ownerName ?? '', 30, 20, 30),
                letterSpacing: 1,
                marginTop: 6,
              }}
            >
              {ownerName ?? 'FIGURES UNAVAILABLE'}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
            <Label>Top parcel</Label>
            <div
              style={{
                fontSize: autoSize(address ?? '', 30, 20, 30),
                letterSpacing: 1,
                marginTop: 6,
              }}
            >
              {address ?? '—'}
            </div>
            {top?.fmv != null && (
              <div style={{ fontSize: 20, letterSpacing: 2, color: OG.grey2, marginTop: 6 }}>
                {ogMoney(top.fmv)}
              </div>
            )}
          </div>
        </div>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
