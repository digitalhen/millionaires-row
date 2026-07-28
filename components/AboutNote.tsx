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
        non-primary-residence (&ldquo;pied-à-terre&rdquo;) surcharge. Owner names
        and addresses are reproduced as published by DOF.
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
    </div>
  );
}
