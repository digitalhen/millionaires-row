import { ImageResponse } from 'next/og';
import {
  Chip,
  DomainMark,
  Label,
  OG,
  OgFooter,
  OgFooterRow,
  OgShell,
  OgStat,
  OgStatRow,
  autoSize,
  ogMoney,
  ogMoneyCompact,
  ogNum,
} from '@/lib/og';
import { getZipEntry, getZipStats } from '@/lib/aggregates';
import { boroName } from '@/lib/format';
import { OG_SIZE, decodeParam } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "ZIP code record on Millionaires' Row";
export const runtime = 'nodejs';

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export default async function Image({
  params,
}: {
  params: Promise<{ zip: string }>;
}) {
  const { zip: raw } = await params;
  let entry = null;
  let stats = null;
  try {
    entry = await getZipEntry(decodeParam(raw).trim());
    if (entry) stats = await getZipStats(entry.zip);
  } catch (err) {
    console.error('[og:zip] figures unavailable', err);
  }

  if (!entry || !stats) {
    return new ImageResponse(
      (
        <OgShell
          footer={
            <OgFooterRow>
              <Label>No matching record</Label>
              <DomainMark />
            </OgFooterRow>
          }
        >
          <div style={{ fontSize: 56, letterSpacing: 2 }}>NO SUCH ZIP CODE ON THE ROLL</div>
        </OgShell>
      ),
      { ...size, headers: { 'cache-control': CACHE } },
    );
  }

  // Nine ZIPs straddle a borough line, so the place line names every borough
  // the code touches rather than only the one it is filed under.
  const place = entry.boros.map(boroName).join(' / ').toUpperCase();

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooter
            label="Supplemental roll — combined value"
            value={ogMoney(stats.rollFmv)}
            valueSize={autoSize(ogMoney(stats.rollFmv), 76, 48, 15)}
          />
        }
      >
        {stats.eligibleCount > 0 && (
          <div style={{ display: 'flex', marginBottom: 22 }}>
            <Chip
              tone="eligible"
              label={`${ogNum(stats.eligibleCount)} MAY BE SUBJECT TO SURCHARGE`}
            />
          </div>
        )}

        <div style={{ fontSize: 82, lineHeight: 1.1, letterSpacing: 3 }}>
          {`ZIP ${entry.zip}`}
        </div>
        <div style={{ fontSize: 21, letterSpacing: 3, color: OG.grey1, marginTop: 12 }}>
          {`${place}  ·  NEW YORK CITY`}
        </div>

        {/* Four figures, so the labels are clipped to their shortest honest
            form and the gap is tightened — the row has 1088px to work with. */}
        <OgStatRow marginTop={28}>
          <OgStat label="NYC (FY27)" value={ogNum(stats.allCount)} size={42} gap={40} />
          <OgStat label="On the roll" value={ogNum(stats.rollCount)} size={42} gap={40} />
          <OgStat
            label="May be subject"
            value={ogNum(stats.eligibleCount)}
            accent={stats.eligibleCount > 0}
            size={42}
            gap={40}
          />
          <OgStat
            label="Median value"
            value={ogMoneyCompact(stats.rollMedianFmv)}
            size={42}
            gap={0}
          />
        </OgStatRow>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
