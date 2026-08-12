import { emptyLicenseEntry, type LicenseEntry } from './formTypes';
import {
  isForkliftLicenseType,
  requiredLicensesForSkills,
  skillsRequireForkliftLicenses,
} from './skillLicenseMap';

/**
 * Keep license rows in sync with skills:
 * - fixed skill-mapped types are required rows
 * - forklift equipment types are preserved when Forklift Operator skill is set
 * - forklift rows are dropped when that skill is removed
 */
export function syncLicensesForSkills(
  currentLicenses: LicenseEntry[],
  skills: string[],
): LicenseEntry[] {
  const fixedRequired = requiredLicensesForSkills(skills);
  const keepForklift = skillsRequireForkliftLicenses(skills);

  const byType = new Map<string, LicenseEntry>();
  for (const license of currentLicenses) {
    if (license.licenseType && !byType.has(license.licenseType)) {
      byType.set(license.licenseType, license);
    }
  }

  const result: LicenseEntry[] = [];

  for (const licenseType of fixedRequired) {
    const existing = byType.get(licenseType);
    if (existing) result.push({ ...existing, licenseType });
    else result.push({ ...emptyLicenseEntry(), licenseType });
  }

  if (keepForklift) {
    for (const license of currentLicenses) {
      if (!isForkliftLicenseType(license.licenseType)) continue;
      if (result.some((r) => r.licenseType === license.licenseType)) continue;
      result.push({ ...license });
    }
  }

  return result;
}
