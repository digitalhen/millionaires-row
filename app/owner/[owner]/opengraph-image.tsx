import { ImageResponse } from 'next/og';
import {
  Chip,
  DomainMark,
  Label,
  OG,
  OgFooter,
  OgFooterRow,
  OgShell,
  autoSize,
  clip,
  ogMoney,
  ogNum,
} from '@/lib/og';
import { getOwnerCard } from '@/lib/queries';
import { OG_SIZE, decodeParam } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Owner record on Millionaires' Row";
export const runtime = 'nodejs';

const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string }>;
}) {
  const { owner } = await params;
  let o = null;
  try {
    // Next hands metadata image routes an already-decoded segment, but the
    // og:image URL it emits is encoded again — so try the decoded form first
    // and fall back to the raw one before giving up on the record.
    const decoded = decodeParam(owner).trim();
    o = await getOwnerCard(decoded);
    if (!o && owner.trim() !== decoded) o = await getOwnerCard(owner.trim());
  } catch (err) {
    console.error('[og:owner] lookup failed', err);
  }

  if (!o) {
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
          <div style={{ fontSize: 56, letterSpacing: 2 }}>NO SUCH OWNER ON THE ROLL</div>
        </OgShell>
      ),
      { ...size, headers: { 'cache-control': CACHE } },
    );
  }

  const name = clip(o.display_name.toUpperCase(), 70);
  const avg = o.property_count ? Math.round(o.total_fmv / o.property_count) : 0;
  // `property_count` is every parcel held city-wide; `roll_count` (when the
  // schema carries it) is the subset on the 2027 supplemental roll.
  const onRoll =
    o.roll_count != null && o.roll_count !== o.property_count
      ? `  ·  ${ogNum(o.roll_count)} ON THE SUPPLEMENTAL ROLL`
      : '';

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooter
            label="Combined full market value"
            value={ogMoney(o.total_fmv)}
            valueSize={autoSize(ogMoney(o.total_fmv), 86, 52, 13)}
          />
        }
      >
        {o.property_count > 1 && (
          <div style={{ display: 'flex', marginBottom: 26 }}>
            <Chip tone="owner" label={`${ogNum(o.property_count)} PROPERTIES`} />
          </div>
        )}

        <Label>Owner of record</Label>
        <div
          style={{
            fontSize: autoSize(name, 66, 32, 26),
            lineHeight: 1.12,
            letterSpacing: 1,
            marginTop: 10,
          }}
        >
          {name}
        </div>

        <div style={{ fontSize: 22, letterSpacing: 3, color: OG.grey1, marginTop: 22 }}>
          {`${ogNum(o.property_count)} ${
            o.property_count === 1 ? 'PARCEL' : 'PARCELS'
          }  ·  AVERAGE ${ogMoney(avg)}${onRoll}`}
        </div>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
