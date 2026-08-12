/**
 * Mailing list visibility rules (multi-assignee):
 * - Self-created lists (no assignees, or all assignees === creator) are visible only to the creator.
 * - Manager-assigned lists (≥1 assignee other than the creator) are visible to the creator and every
 *   assignee; managers/super users see those under "Assigned to", not "Created by".
 */

export type ListPerson = { id: string; name: string };

export type ListVisibilityFields = {
  createdBy: ListPerson;
  assignedTo?: ListPerson[];
  isArchived?: boolean;
};

function assignees(list: ListVisibilityFields): ListPerson[] {
  return list.assignedTo ?? [];
}

/** List created by a user for themselves (not delegated to anyone else). */
export function isSelfCreatedList(list: ListVisibilityFields): boolean {
  return assignees(list).every((a) => a.id === list.createdBy.id);
}

/** List created by a manager/super user and assigned to at least one other user. */
export function isManagerAssignedList(list: ListVisibilityFields): boolean {
  return assignees(list).some((a) => a.id !== list.createdBy.id);
}

/** Whether the viewer may see this list at all. */
export function canViewerSeeList(list: ListVisibilityFields, viewerId: string): boolean {
  if (list.createdBy.id === viewerId) return true;
  return assignees(list).some((a) => a.id === viewerId);
}

/** "Created by" tab — only the creator sees their own self-created lists. */
export function isListInCreatedTab(
  list: ListVisibilityFields,
  subjectUserId: string,
  viewerId: string,
): boolean {
  if (!isSelfCreatedList(list)) return false;
  if (list.createdBy.id !== subjectUserId) return false;
  return viewerId === subjectUserId;
}

type AssignedTabOptions = {
  /** When set, enables manager "All Team" assigned view (lists they assigned to team members). */
  teamUserIds?: Set<string>;
};

/** "Assigned to" tab — assignee sees lists assigned to them; managers see lists they assigned. */
export function isListInAssignedTab(
  list: ListVisibilityFields,
  subjectUserId: string,
  viewerId: string,
  options?: AssignedTabOptions,
): boolean {
  if (!isManagerAssignedList(list)) return false;

  const isAssignee = assignees(list).some((a) => a.id === subjectUserId && a.id !== list.createdBy.id);

  // Assignee viewing their own assigned lists.
  if (subjectUserId === viewerId && isAssignee) return true;

  // Manager viewing lists they assigned to a specific team member.
  if (isAssignee && list.createdBy.id === viewerId) return true;

  // Manager "All Team" assigned tab — lists they created and assigned to any team member.
  if (options?.teamUserIds && subjectUserId === viewerId && list.createdBy.id === viewerId) {
    return assignees(list).some((a) => a.id !== viewerId && options.teamUserIds!.has(a.id));
  }

  return false;
}

/** "All" tab for a subject user — union of created + assigned lists the viewer may see. */
export function isListInAllTab(
  list: ListVisibilityFields,
  subjectUserId: string,
  viewerId: string,
  options?: AssignedTabOptions,
): boolean {
  return (
    isListInCreatedTab(list, subjectUserId, viewerId) ||
    isListInAssignedTab(list, subjectUserId, viewerId, options)
  );
}
