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
import { boroName, formatBbl } from '@/lib/format';
import { getPropertyCard } from '@/lib/queries';
import { OG_SIZE, decodeParam } from '@/lib/seo';

export const size = OG_SIZE;
export const contentType = 'image/png';
export const alt = "Property record on Millionaires' Row";
export const runtime = 'nodejs';

/** Long enough to be worth a CDN hit, short enough that a data reload shows up. */
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800';

export default async function Image({
  params,
}: {
  params: Promise<{ parid: string }>;
}) {
  const { parid } = await params;
  let p = null;
  try {
    p = await getPropertyCard(decodeParam(parid).trim());
  } catch (err) {
    console.error('[og:property] lookup failed', err);
  }

  if (!p) {
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
          <div style={{ fontSize: 56, letterSpacing: 2 }}>NO SUCH PARCEL ON THE ROLL</div>
        </OgShell>
      ),
      { ...size, headers: { 'cache-control': CACHE } },
    );
  }

  const address = clip(p.address.toUpperCase(), 64);
  const ownerName = p.owner_norm
    ? clip((p.owner_display || p.owner || p.owner_norm).toUpperCase(), 68)
    : 'NO OWNER ON FILE';
  const sub = [
    boroName(p.boro).toUpperCase(),
    p.zip_code || null,
    `BBL ${formatBbl(p.boro, p.block, p.lot)}`,
    p.bldg_class ? `CLASS ${p.tax_class} · ${p.bldg_class}` : `CLASS ${p.tax_class}`,
  ]
    .filter(Boolean)
    .join('  ·  ');

  // A chip row costs ~65px of the ~290px body, so the headline gets smaller
  // when one is present rather than letting the column overflow.
  const chips = p.eligible || p.property_count > 1;

  return new ImageResponse(
    (
      <OgShell
        footer={
          <OgFooter
            label="DOF full market value"
            value={ogMoney(p.fmv)}
            valueSize={autoSize(ogMoney(p.fmv), chips ? 76 : 86, 50, 13)}
          />
        }
      >
        {chips && (
          <div style={{ display: 'flex', marginBottom: 20 }}>
            {p.eligible && <Chip tone="eligible" label="MAY BE SUBJECT TO SURCHARGE" />}
            {p.property_count > 1 && (
              <Chip
                tone="owner"
                label={`OWNER OF ${ogNum(p.property_count)} PROPERTIES`}
              />
            )}
          </div>
        )}

        <div
          style={{
            fontSize: autoSize(address, chips ? 56 : 68, 32, 26),
            lineHeight: 1.18,
            letterSpacing: 1,
          }}
        >
          {address}
        </div>

        <div style={{ fontSize: 21, letterSpacing: 3, color: OG.grey1, marginTop: 12 }}>
          {sub}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 24 }}>
          <Label>Owner of record</Label>
          <div
            style={{
              fontSize: autoSize(ownerName, chips ? 32 : 36, 22, 40),
              letterSpacing: 1,
              marginTop: 6,
            }}
          >
            {ownerName}
          </div>
        </div>
      </OgShell>
    ),
    { ...size, headers: { 'cache-control': CACHE } },
  );
}
