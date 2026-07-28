/**
 * Shared building blocks for the generated Open Graph cards.
 *
 * Rendered by Satori (next/og), which is *not* a browser: only flexbox layout
 * is supported, every element with more than one child needs an explicit
 * `display: flex`, and the only font available is next/og's bundled Noto Sans
 * (latin). That rules out the site's monospace stack and any box-drawing glyph
 * (■ / ▣), so the cards get their utilitarian feel from wide letter-spacing on
 * uppercase text, and the marks are drawn as plain divs.
 */
import type { ReactElement, ReactNode } from 'react';

export const OG = {
  width: 1200,
  height: 630,
  bg: '#000000',
  fg: '#ffffff',
  grey1: '#b3b3b3',
  grey2: '#7a7a7a',
  hair: '#333333',
  /** The single accent, same value as --red in globals.css. Reserved for
   *  "may be subject to surcharge" and nothing else. */
  red: '#ff3b30',
  pad: 56,
} as const;

export const WORDMARK = "MILLIONAIRES' ROW";
export const DOMAIN = 'MILLIONAIRESROWNYC.COM';
export const ROLL_LABEL = 'NYC DOF · 2027 SUPPLEMENTAL ROLL';

/** Shrink a headline so long strings still fit on one or two lines. */
export function autoSize(text: string, max: number, min: number, fitChars: number): number {
  const len = text.length || 1;
  if (len <= fitChars) return max;
  return Math.max(min, Math.round((max * fitChars) / len));
}

export function clip(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** $1.02T / $4.7B / $96,491,000 — headline figures only. */
export function ogMoneyCompact(v: number | null | undefined): string {
  if (v == null) return '—';
  const n = Math.abs(v);
  if (n >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function ogMoney(v: number | null | undefined): string {
  if (v == null) return 'Value not stated';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

export function ogNum(v: number | null | undefined): string {
  if (v == null) return '—';
  return Math.round(v).toLocaleString('en-US');
}

/** Hairline rule. */
export function Rule({ margin = 0 }: { margin?: number }): ReactElement {
  return (
    <div
      style={{
        width: '100%',
        height: 1,
        background: OG.hair,
        marginTop: margin,
        marginBottom: margin,
      }}
    />
  );
}

/** The red ■ mark, drawn rather than typed (no glyph in the bundled font). */
function SquareMark({ color, size = 18 }: { color: string; size?: number }): ReactElement {
  return <div style={{ width: size, height: size, background: color }} />;
}

/** The ▣ multi-property mark: a filled square inside an outlined one. */
function NestedSquareMark({ size = 20 }: { size?: number }): ReactElement {
  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `2px solid ${OG.fg}`,
      }}
    >
      <div style={{ width: size / 2.5, height: size / 2.5, background: OG.fg }} />
    </div>
  );
}

export function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'eligible' | 'owner';
}): ReactElement {
  const color = tone === 'eligible' ? OG.red : OG.fg;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        border: `1px solid ${color}`,
        color,
        padding: '10px 18px',
        fontSize: 21,
        letterSpacing: 3,
        marginRight: 16,
      }}
    >
      {tone === 'eligible' ? <SquareMark color={OG.red} /> : <NestedSquareMark />}
      <div style={{ marginLeft: 14 }}>{label}</div>
    </div>
  );
}

export function Label({ children }: { children: ReactNode }): ReactElement {
  return (
    <div style={{ fontSize: 20, letterSpacing: 4, color: OG.grey2 }}>{children}</div>
  );
}

/**
 * The card frame every OG image shares: black field, hairline header with the
 * wordmark, hairline footer with the domain.
 */
export function OgShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer: ReactNode;
}): ReactElement {
  return (
    <div
      style={{
        width: OG.width,
        height: OG.height,
        display: 'flex',
        flexDirection: 'column',
        background: OG.bg,
        color: OG.fg,
        padding: OG.pad,
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 22,
          letterSpacing: 5,
        }}
      >
        <div>{WORDMARK}</div>
        <div style={{ color: OG.grey2, fontSize: 18, letterSpacing: 3 }}>{ROLL_LABEL}</div>
      </div>
      <Rule margin={18} />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
      <Rule margin={18} />
      {footer}
    </div>
  );
}

/** A full-width footer row. Satori only distributes space when the row has an
 *  explicit width and real element children, so callers hand over one of these
 *  rather than a fragment. */
export function OgFooterRow({ children }: { children: ReactNode }): ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
      }}
    >
      {children}
    </div>
  );
}

export function DomainMark(): ReactElement {
  return (
    <div
      style={{
        fontSize: 18,
        letterSpacing: 3,
        color: OG.grey2,
        paddingBottom: 12,
      }}
    >
      {DOMAIN}
    </div>
  );
}

/** Bottom-left money block + bottom-right domain wordmark. */
export function OgFooter({
  label,
  value,
  valueSize = 84,
}: {
  label: string;
  value: string;
  valueSize?: number;
}): ReactElement {
  return (
    <OgFooterRow>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Label>{label}</Label>
        <div style={{ fontSize: valueSize, lineHeight: 1.1, marginTop: 6 }}>{value}</div>
      </div>
      <DomainMark />
    </OgFooterRow>
  );
}
