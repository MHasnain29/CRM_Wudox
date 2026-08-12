/**
 * Agency ID for CRM write dialogs / POSTs under linked act-as.
 *
 * When acting as a linked user → always their agency (not the login home agency).
 * Otherwise → optional page override (elevated selected agency) or login home agency.
 */
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useStore } from '@/lib/store';

export function useWriteAgencyId(overrideAgencyId?: string | null): string | undefined {
  const effectiveUser = useEffectiveUser();
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const currentUser = useStore((s) => s.currentUser);

  if (effectiveUser.isActingAs && effectiveUser.subCompanyId) {
    return effectiveUser.subCompanyId;
  }

  if (overrideAgencyId) return overrideAgencyId;

  return currentSubCompany?.id ?? currentUser?.subCompanyId ?? undefined;
}
