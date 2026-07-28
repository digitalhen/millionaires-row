import { query } from './db';

/**
 * The pipeline is widening `properties` to cover the full FY27 assessment roll
 * (every NYC parcel) alongside the supplemental roll. The app has to run
 * against both the old and the new shape, so it probes for the new columns once
 * per process and degrades to "everything is on the supplemental roll" while
 * they are missing.
 */
export type SchemaFlags = {
  /** properties.on_supplemental exists → three-tier rendering is live */
  hasOnSupplemental: boolean;
  /** owners.roll_count / owners.eligible_count exist */
  hasOwnerRollCounts: boolean;
};

let cached: Promise<SchemaFlags> | null = null;

async function probe(): Promise<SchemaFlags> {
  try {
    const rows = await query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'properties' AND column_name = 'on_supplemental')
            OR (table_name = 'owners' AND column_name IN ('roll_count', 'eligible_count'))
          )`,
    );
    const names = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    return {
      hasOnSupplemental: names.has('properties.on_supplemental'),
      hasOwnerRollCounts:
        names.has('owners.roll_count') && names.has('owners.eligible_count'),
    };
  } catch {
    return { hasOnSupplemental: false, hasOwnerRollCounts: false };
  }
}

export function schemaFlags(): Promise<SchemaFlags> {
  if (!cached) cached = probe();
  return cached;
}

/** Forget the probe result (used after a migration lands mid-process). */
export function resetSchemaFlags(): void {
  cached = null;
}

/** SQL fragment for "is this parcel on the supplemental roll". */
export function onSupplementalSql(flags: SchemaFlags, alias = 'p'): string {
  return flags.hasOnSupplemental ? `${alias}.on_supplemental` : 'true';
}

/**
 * SELECT fragment for an owner's per-tier holdings counts. Before the pipeline
 * adds the columns every holding is by definition on the supplemental roll, so
 * `roll_count` degrades to the total and `eligible_count` to 0 (which the UI
 * reads as "nothing extra to say").
 */
export function ownerCountsSql(flags: SchemaFlags, alias = 'o'): string {
  return flags.hasOwnerRollCounts
    ? `${alias}.roll_count::int AS roll_count, ${alias}.eligible_count::int AS eligible_count`
    : `${alias}.property_count::int AS roll_count, 0 AS eligible_count`;
}

/**
 * ORDER BY fragment for "largest portfolio on the supplemental roll". Degrades
 * to the city-wide holdings count, which is what `roll_count` collapses to on
 * the pre-city-roll schema anyway.
 */
export function ownerRollCountSql(flags: SchemaFlags, alias = 'o'): string {
  return flags.hasOwnerRollCounts ? `${alias}.roll_count` : `${alias}.property_count`;
}
