import { ImageResponse } from 'next/og';
import {
  Chip,
  DomainMark,
  Label,
  OG,
  OgFooterRow,
  OgShell,
  ogMoneyCompact,
  ogNum,
} from '@/lib/og';
import { getHeadlineStats } from '@/lib/queries';
import { OG_SIZE } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Millionaires' Row — NYC's 2027 pied-à-terre tax roll, searchable and mapped";
export const runtime = 'nodejs';

/** Rebuilt daily: the headline figures move only when the roll is reloaded. */
export const revalidate = 86400;

/** Published figures, used when the database is unreachable at build time. */
const FALLBACK = { rollCount: 959_710, rollFmv: 1_020_000_000_000, eligibleCount: 0 };

export default async function Image() {
  let stats = null;
  try {
    stats = await getHeadlineStats();
  } catch (err) {
    console.error('[og:home] stats unavailable', err);
  }
  const s = stats ?? FALLBACK;

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div style={{ display: 'flex', flexDirection: 'column', marginRight: 64 }}>
      <Label>{label}</Label>
      <div style={{ fontSize: 58, lineHeight: 1.1, marginTop: 6 }}>{value}</div>
    </div>
  );

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooterRow>
            <div style={{ display: 'flex' }}>
              <Stat label="Properties" value={ogNum(s.rollCount)} />
              <Stat label="Full market value" value={ogMoneyCompact(s.rollFmv)} />
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
          Every property on the New York City Department of Finance 2027
          supplemental roll — owner, DOF full market value, building class and map.
        </div>
      </OgShell>
    ),
    { ...size },
  );
}
