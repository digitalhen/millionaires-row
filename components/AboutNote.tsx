import Link from 'next/link';
import { BOROUGH_CODES, boroName, boroSlug } from '@/lib/format';
import { LEADERBOARDS_PATH, boroughPath } from '@/lib/seo';

/**
 * Footnote for any table that sums FMV. The roll lists 764 co-op buildings
 * *and* the units inside them, each carrying its own DOF value, so a column of
 * summed values double-counts those buildings. Stated wherever a total appears
 * rather than buried in the about note.
 */
export function CoopValueNote() {
  return (
    <p className="crumb" style={{ marginTop: 10, textTransform: 'none', letterSpacing: 0 }}>
      Values are DOF estimates; co-op buildings and their units may both appear.
    </p>
  );
}

/** Site-wide index of the aggregate pages, carried in the page footer. */
export function SiteNav() {
  return (
    <nav className="about-nav" aria-label="Aggregate pages">
      <span className="label">Browse</span>
      <Link href={LEADERBOARDS_PATH}>Leaderboards</Link>
      {BOROUGH_CODES.map((boro) => (
        <Link key={boro} href={boroughPath(boroSlug(boro))}>
          {boroName(boro)}
        </Link>
      ))}
      <a
        href="https://buymeacoffee.com/digitalhen"
        target="_blank"
        rel="noopener noreferrer"
        className="coffee-link"
      >
        ☕ Buy me a coffee
      </a>
    </nav>
  );
}

export default function AboutNote({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <p className="about about--compact">
        NYC DOF 2027 supplemental property roll (public record). Figures are DOF
        full market value estimates, not sale prices. Inclusion on this roll does
        not mean the pied-à-terre tax applies to a property.
      </p>
    );
  }
  return (
    <div className="about">
      <p>
        <strong>About this data.</strong> Source: the New York City Department of
        Finance <strong>2027 supplemental property roll</strong> — a public
        record listing properties that may fall within the scope of the
        non-primary-residence (&ldquo;pied-à-terre&rdquo;) surcharge — shown
        against the full FY27 assessment roll of every parcel in the city. Owner
        names and addresses are reproduced as published by DOF.
      </p>
      <p>
        Parcels drawn in{' '}
        <span style={{ color: 'var(--tier-city)' }}>grey</span> are on the city
        assessment roll but <em>not</em> on the supplemental roll; white parcels
        are on the supplemental roll. Grey is context, not a judgement — a great
        deal of the city (airports, parks, offices, most commercial property) was
        never in scope for this surcharge in the first place.
      </p>
      <p>
        Parcels marked in <span style={{ color: 'var(--red)' }}>red</span> match
        the criteria DOF published for the surcharge — broadly, class 1 houses
        over $5M and condo or co-op units at $1M and above. DOF describes the
        roll as <em>including but not limited to</em> properties that may be
        subject, and a property used as the owner&rsquo;s primary residence is
        generally exempt, so a red mark means{' '}
        <strong>may be subject</strong>, never that tax is owed.
      </p>
      <p>
        Dollar figures are DOF <strong>full market value (FMV)</strong>{' '}
        estimates used for assessment purposes. They are not sale prices,
        appraisals, or listing prices.{' '}
        <strong>
          Appearing on this roll does not mean the tax applies to a property
        </strong>{' '}
        — eligibility depends on residency and other facts that are not in this
        dataset. Records may contain errors carried over from the source roll.
      </p>
      <SiteNav />
    </div>
  );
}
