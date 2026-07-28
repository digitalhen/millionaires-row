import type { OwnerSummary } from '@/lib/types';
import { num } from '@/lib/format';

/**
 * An owner's holdings narrowed tier by tier, in one line:
 *
 *   410 PROPERTIES · 410 ON SUPPLEMENTAL ROLL · 82 MAY BE SUBJECT
 *
 * The first number is every parcel the owner holds anywhere in the city — the
 * same figure the ▣ badge carries — so the three read as a funnel rather than
 * as three unrelated statistics. Only the last one is red, and only when it is
 * non-zero: an owner with nothing on the surcharge list gets no accent at all.
 *
 * `roll_count` is absent on the pre-city-roll schema and on the lightweight
 * lookups used for social cards, in which case the line degrades to the total.
 */
export default function OwnerCounts({
  owner,
  className,
}: {
  owner: OwnerSummary;
  className?: string;
}) {
  // A single holding has nothing to break down, and the parcel's own row
  // already carries its tier — repeating "1 property · 1 on supplemental roll"
  // would be noise.
  const single = owner.property_count === 1;
  const roll = single ? null : owner.roll_count;
  const eligible = single ? 0 : owner.eligible_count ?? 0;

  return (
    <p className={`owner-counts${className ? ` ${className}` : ''}`}>
      <span>
        <b>{num(owner.property_count)}</b> {single ? 'property' : 'properties'}
      </span>
      {roll != null && (
        <span>
          <b>{num(roll)}</b> on supplemental roll
        </span>
      )}
      {eligible > 0 && (
        <span className="oc-eligible">
          <b>{num(eligible)}</b> may be subject
        </span>
      )}
    </p>
  );
}
