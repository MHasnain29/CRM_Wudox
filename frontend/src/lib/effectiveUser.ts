import { useActAs } from '@/hooks/useActAs';
import { useLinkedAccounts } from '@/hooks/useLinkedAccounts';
import { useStore } from '@/lib/store';

export interface EffectiveUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  subCompanyId: string;
  isActingAs: boolean;
}

/**
 * Returns the effective user identity for the current session.
 *
 * When Ramish acts as Emily:
 *   id, firstName, lastName, role, subCompanyId → Emily's values
 *   isActingAs → true
 *
 * When not in act-as mode:
 *   All fields → real caller's values
 *   isActingAs → false
 *
 * Use this for ownership checks (e.g. "can I edit this note?") and UI attribution.
 * Do NOT use for security decisions — the backend enforces access control.
 */
export function useEffectiveUser(): EffectiveUser {
  const actAs = useActAs();
  const currentUser = useStore((s) => s.currentUser);
  const { data: linkedAccounts = [] } = useLinkedAccounts();

  const isActingAs = actAs.isActive && !!actAs.userId;
  const linked = isActingAs ? linkedAccounts.find((a) => a.userId === actAs.userId) : null;

  const firstName = isActingAs ? (actAs.firstName ?? '') : (currentUser.firstName ?? '');
  const lastName = isActingAs ? (actAs.lastName ?? '') : (currentUser.lastName ?? '');

  return {
    id: isActingAs ? actAs.userId! : currentUser.id,
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    role: isActingAs ? (linked?.role ?? currentUser.role) : currentUser.role,
    subCompanyId: isActingAs ? (linked?.subCompanyId ?? currentUser.subCompanyId) : currentUser.subCompanyId,
    isActingAs,
  };
}
