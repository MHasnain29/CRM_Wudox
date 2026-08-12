/**
 * Job pay helpers: fixed price vs salary range.
 * Convention (no schema change): fixed price = salaryMin === salaryMax (both set).
 * Amounts >= 1000 are treated as annual salaries; below that as hourly rates.
 */
export type JobSalaryType = 'fixed' | 'range';

export function getJobSalaryType(
  min?: number | null,
  max?: number | null,
): JobSalaryType {
  if (min != null && max != null && min === max) return 'fixed';
  return 'range';
}

function formatAmount(v: number): string {
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}/hr`;
}

export function formatJobSalary(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return 'Not specified';
  if (min != null && max != null) {
    if (min === max) return formatAmount(min);
    return `${formatAmount(min)} - ${formatAmount(max)}`;
  }
  if (min != null) return `${formatAmount(min)}+`;
  return `Up to ${formatAmount(max!)}`;
}
