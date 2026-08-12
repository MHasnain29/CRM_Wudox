/** Match a job against a free-text query (job code and/or title). */
export function jobMatchesQuery(
  job: { title: string; jobCode?: string | null },
  rawQuery: string,
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    job.title.toLowerCase().includes(q) ||
    (job.jobCode?.toLowerCase().includes(q) ?? false)
  );
}

/** Build cmdk search string for a job option row. */
export function jobSearchValue(job: {
  title: string;
  jobCode?: string | null;
  status?: string;
}): string {
  return [job.jobCode, job.title, job.status].filter(Boolean).join(' ');
}

/** Display label for a selected job in closed combobox triggers. */
export function jobSelectLabel(job: {
  title: string;
  jobCode?: string | null;
}): string {
  return job.jobCode ? `${job.jobCode} · ${job.title}` : job.title;
}
