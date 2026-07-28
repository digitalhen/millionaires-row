/**
 * The one red element in the design. Wording is deliberately hedged: DOF
 * publishes the roll as "including but not limited to" properties that may be
 * subject to the surcharge, and primary-residence use generally exempts an
 * owner — so this can never say a property *will* be taxed.
 */
export default function EligibleBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className="badge badge-eligible" title="Matches DOF's published surcharge criteria — primary-residence use generally exempts an owner">
      ■ {compact ? 'May be subject' : 'May be subject to surcharge'}
    </span>
  );
}

/** Inline marker used in dense lists (search results, tables). */
export function EligibleMark() {
  return (
    <span className="eligible-mark" aria-label="May be subject to the surcharge" title="May be subject to the surcharge">
      ■
    </span>
  );
}

/**
 * Table-density counterpart to `EligibleMark`: a hollow grey square for a
 * parcel that is in the city assessment roll only. Same glyph family as the
 * red ■ and the same grey the map paints those parcels in, so the three tiers
 * carry one visual vocabulary across map, list and table.
 */
export function NotOnRollMark() {
  return (
    <span
      className="not-on-roll-mark"
      aria-label="Not on the supplemental roll"
      title="Present in the city assessment roll but not in the 2027 supplemental roll"
    >
      □
    </span>
  );
}

/** Muted marker for parcels that are on the city roll but not the supplemental one. */
export function NotOnRollNote({ inline = false }: { inline?: boolean }) {
  const text = 'Not on supplemental roll';
  return inline ? (
    <span className="not-on-roll" title="Present in the city assessment roll but not in the 2027 supplemental roll">
      {text}
    </span>
  ) : (
    <span className="badge badge-muted">{text}</span>
  );
}
