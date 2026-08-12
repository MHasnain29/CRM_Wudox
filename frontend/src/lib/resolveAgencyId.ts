/** Real DB agency ids are UUIDs — mock seed ids like `sub1` must not be sent to the API. */
const AGENCY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRealAgencyId(id: string | null | undefined): id is string {
  return typeof id === 'string' && AGENCY_UUID_RE.test(id);
}

/** Pick an agency id safe for ?subCompanyId= query params (or undefined to let the API default). */
export function resolveAgencyIdForApi(
  subCompanies: Array<{ id: string }>,
  options?: {
    currentId?: string | null;
    viewedId?: string | null;
  },
): string | undefined {
  const candidates = [options?.viewedId, options?.currentId].filter(Boolean) as string[];
  for (const id of candidates) {
    if (isRealAgencyId(id) && subCompanies.some((s) => s.id === id)) return id;
  }
  return subCompanies.find((s) => isRealAgencyId(s.id))?.id;
}
