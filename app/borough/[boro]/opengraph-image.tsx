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
  ogNum,
} from '@/lib/og';
import { getBoroughStats, getZipDirectory } from '@/lib/aggregates';
import { boroFromSlug, boroName } from '@/lib/format';
import { OG_SIZE, decodeParam } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Borough record on Millionaires' Row";
export const runtime = 'nodejs';

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export default async function Image({
  params,
}: {
  params: Promise<{ boro: string }>;
}) {
  const { boro: slug } = await params;
  const boro = boroFromSlug(decodeParam(slug));

  let stats = null;
  let zipCount = 0;
  if (boro != null) {
    try {
      const [s, directory] = await Promise.all([getBoroughStats(boro), getZipDirectory()]);
      stats = s;
      zipCount = directory.byBoro.get(boro)?.length ?? 0;
    } catch (err) {
      console.error('[og:borough] figures unavailable', err);
    }
  }

  if (boro == null || !stats) {
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
          <div style={{ fontSize: 56, letterSpacing: 2 }}>NO SUCH BOROUGH</div>
        </OgShell>
      ),
      { ...size, headers: { 'cache-control': CACHE } },
    );
  }

  const name = boroName(boro).toUpperCase();
  const sub = [
    'NEW YORK CITY',
    `BOROUGH CODE ${boro}`,
    zipCount ? `${ogNum(zipCount)} ZIP CODES` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

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

        <div
          style={{
            fontSize: autoSize(name, 82, 46, 13),
            lineHeight: 1.1,
            letterSpacing: 3,
          }}
        >
          {name}
        </div>
        <div style={{ fontSize: 21, letterSpacing: 3, color: OG.grey1, marginTop: 12 }}>
          {sub}
        </div>

        {/* The three tiers, in the order the map draws them. */}
        <OgStatRow marginTop={28}>
          <OgStat label="NYC properties (FY27)" value={ogNum(stats.allCount)} />
          <OgStat label="On the supplemental roll" value={ogNum(stats.rollCount)} />
          <OgStat
            label="May be subject"
            value={ogNum(stats.eligibleCount)}
            accent={stats.eligibleCount > 0}
          />
        </OgStatRow>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
