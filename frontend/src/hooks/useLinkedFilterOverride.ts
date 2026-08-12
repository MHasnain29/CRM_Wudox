/**
 * Detect linked-filter override vs act-as for ScopeFilterBar orchestration.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useActAs } from '@/hooks/useActAs';
import { useStore } from '@/lib/store';

export type LinkedFilterOverrideState = {
  /** linkedUserId set OR linkedScope is a linked agency (not own). */
  linkedOverrideActive: boolean;
  /** Exactly one other linked user → act-as. */
  actAsActive: boolean;
  actAsUserId: string | null;
  /** Exactly one selected id and it is the logged-in user (You chip). */
  viewingSelfOnly: boolean;
};

export function useLinkedFilterOverride(): LinkedFilterOverrideState {
  const [searchParams] = useSearchParams();
  const actAs = useActAs();
  const currentUserId = useStore((s) => s.currentUser?.id);

  return useMemo(() => {
    const linkedScope = searchParams.get('linkedScope') ?? '';
    const linkedUserIdParam = searchParams.get('linkedUserId') ?? '';
    const ids = linkedUserIdParam.split(',').filter(Boolean);
    const viewingSelfOnly =
      !!currentUserId && ids.length === 1 && ids[0] === currentUserId;
    // Empty params or explicit own agency = caller's normal world (unselected own-default).
    const overrideOff =
      ids.length === 0 && (linkedScope === '' || linkedScope === 'own');
    const linkedOverrideActive =
      !overrideOff &&
      !viewingSelfOnly &&
      (ids.length > 0 || (linkedScope !== '' && linkedScope !== 'own'));

    return {
      linkedOverrideActive,
      actAsActive: actAs.isActive,
      actAsUserId: actAs.userId,
      viewingSelfOnly,
    };
  }, [searchParams, actAs.isActive, actAs.userId, currentUserId]);
}
