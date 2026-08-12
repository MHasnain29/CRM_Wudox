/**
 * Resolves a human-readable label for a client's ownership field.
 * - `management` → "Management"
 * - `associate` + resolvable user → user's name
 * - everything else → "Not set"
 *
 * Keep this helper in sync with the badge rendered inside ClientDetailsSheet
 * so every surface displays the same wording.
 */
export type OwnershipType = 'management' | 'associate' | null | undefined;

export interface OwnershipUserLike {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

export function formatUserName(user: OwnershipUserLike | null | undefined): string {
  if (!user) return '';
  const composed = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
  return composed || user.email || '';
}

export function formatOwnership(
  ownershipType: OwnershipType,
  ownershipUserId: string | null | undefined,
  knownUsers: OwnershipUserLike[],
): string {
  if (ownershipType === 'management') return 'Management';
  if (ownershipType === 'associate') {
    const user = ownershipUserId ? knownUsers.find((u) => u.id === ownershipUserId) : null;
    return formatUserName(user) || 'Associate';
  }
  return 'Not set';
}
