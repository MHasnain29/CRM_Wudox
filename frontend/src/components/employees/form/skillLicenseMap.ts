/**
 * Maps employee skills to the license types that should be collected on the form.
 * Only skills listed here force fixed license fields; forklift is multi-select.
 */

/** Equipment-specific forklift license types (jobs, employees, matching). */
export const FORKLIFT_LICENSE_TYPES = [
  'Counterbalance Forklift',
  'Reach Truck',
  'Pallet Jack / Electric Pallet Truck',
  'Walkie Stacker',
  'Order Picker',
  'Side Loader',
  'Rough Terrain Forklift',
  'Telehandler',
] as const;

export type ForkliftLicenseType = (typeof FORKLIFT_LICENSE_TYPES)[number];

const FORKLIFT_LICENSE_SET = new Set<string>(FORKLIFT_LICENSE_TYPES);

export function isForkliftLicenseType(type: string): boolean {
  return FORKLIFT_LICENSE_SET.has(type);
}

/** Forklift Operator skill requires at least one equipment license (user-selected). */
export function skillsRequireForkliftLicenses(skills: string[]): boolean {
  return skills.includes('Forklift Operator');
}

/** Fixed skill → license maps (not multi-select). Forklift is handled separately. */
export const SKILL_TO_LICENSES: Record<string, readonly string[]> = {
  'Driving (Class G)': ['Driver License (Class G)'],
  'Driving (Class AZ/DZ)': ['Driver License (AZ/DZ)'],
  'First Aid Certified': ['First Aid / CPR'],
  'Food Production': ['Food Handler Certificate'],
};

/** Stable display order for fixed license types derived from skills. */
const LICENSE_ORDER = [
  'Driver License (Class G)',
  'Driver License (AZ/DZ)',
  'First Aid / CPR',
  'Food Handler Certificate',
] as const;

/**
 * Fixed (non-forklift) licenses required by the selected skills.
 * Forklift equipment types are user-picked; use skillsRequireForkliftLicenses.
 */
export function requiredLicensesForSkills(skills: string[]): string[] {
  const set = new Set<string>();
  for (const skill of skills) {
    const mapped = SKILL_TO_LICENSES[skill];
    if (mapped) {
      for (const license of mapped) set.add(license);
    }
  }
  return LICENSE_ORDER.filter((t) => set.has(t)).concat(
    [...set].filter((t) => !(LICENSE_ORDER as readonly string[]).includes(t)),
  );
}
