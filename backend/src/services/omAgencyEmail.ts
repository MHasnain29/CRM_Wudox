/**
 * Pure helper: when the sender is an operations manager with an assigned
 * agencyEmail for this agency, that address wins. Otherwise null.
 */
export function resolveOmSendingEmail(
  role: string | null | undefined,
  agencyEmail: string | null | undefined,
): string | null {
  if (role !== 'operations_manager') return null;
  const trimmed = agencyEmail?.trim();
  return trimmed || null;
}
