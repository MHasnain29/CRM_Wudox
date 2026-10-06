/** Include enough persisted rows to account for legacy entries in a merged page. */
export function emailListPageWindow(page: number, limit: number, legacyCount: number) {
  const offset = (page - 1) * limit;
  const skip = Math.max(0, offset - legacyCount);
  return { skip, take: limit + offset - skip, offset: offset - skip };
}

/** Match the database's timestamp-descending, ID-descending email ordering. */
export function compareEmailListEntries(
  a: { timestamp: Date; id: string },
  b: { timestamp: Date; id: string },
): number {
  const byTimestamp = b.timestamp.getTime() - a.timestamp.getTime();
  return byTimestamp || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}
