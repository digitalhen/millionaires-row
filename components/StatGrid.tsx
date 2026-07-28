export type Stat = {
  label: string;
  value: React.ReactNode;
  /** secondary figure — greyed, same as the detail pages' dim cells */
  dim?: boolean;
  /** the one red slot: reserved for "may be subject to surcharge" counts */
  accent?: boolean;
};

/**
 * The `.grid`/`.cell` block the property page uses for its identifier and
 * classification panels, driven by data — the borough and ZIP pages open with
 * the same hairline grid of labelled figures.
 */
export default function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <div className="grid">
      {stats.map((s) => (
        <div className="cell" key={s.label}>
          <span className="label">{s.label}</span>
          <span
            className={`value${s.dim ? ' dim' : ''}`}
            style={s.accent ? { color: 'var(--red)' } : undefined}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}
