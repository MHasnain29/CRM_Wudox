/** Helpers to summarize pending client edit vs live client (add / edit / delete). */

export type PendingEditContact = {
  id?: string;
  name?: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  phoneExtension?: string | null;
  linkedin?: string | null;
  website?: string | null;
  isPrimary?: boolean;
};

export type PendingEditClientSnapshot = {
  name: string;
  industry?: string | null;
  location?: string | null;
  address?: string | null;
  companySize?: string | null;
  tags?: string[];
  contacts?: PendingEditContact[];
};

function norm(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function contactSignature(c: PendingEditContact): string {
  return [
    norm(c.name),
    norm(c.title),
    norm(c.email),
    norm(c.phone),
    norm(c.phoneExtension),
    norm(c.linkedin),
    norm(c.website),
    c.isPrimary ? '1' : '0',
  ].join('|');
}

function contactsEqual(a: PendingEditContact, b: PendingEditContact): boolean {
  return contactSignature(a) === contactSignature(b);
}

export type ContactChangeKind = 'added' | 'edited' | 'removed' | 'unchanged';

export type ContactDiffItem = {
  kind: ContactChangeKind;
  contact: PendingEditContact;
  /** For edited: previous values */
  before?: PendingEditContact;
};

export type PendingClientEditDiff = {
  fieldChanges: string[];
  contacts: ContactDiffItem[];
  addedCount: number;
  editedCount: number;
  removedCount: number;
  /** Short line e.g. "Name, industry · +1 contact added, 1 edited" */
  summaryLine: string;
};

export function diffPendingClientEdit(
  proposed: {
    name: string;
    industry?: string | null;
    location?: string | null;
    address?: string | null;
    companySize?: string | null;
    tags?: string[];
    contacts: unknown;
  },
  current: PendingEditClientSnapshot | null | undefined,
): PendingClientEditDiff {
  const fieldChanges: string[] = [];
  if (current) {
    if (norm(proposed.name) !== norm(current.name)) fieldChanges.push('name');
    if (norm(proposed.industry) !== norm(current.industry)) fieldChanges.push('industry');
    if (norm(proposed.location) !== norm(current.location)) fieldChanges.push('location');
    if (norm(proposed.address) !== norm(current.address)) fieldChanges.push('address');
    if (norm(proposed.companySize) !== norm(current.companySize)) fieldChanges.push('company size');
    const propTags = [...new Set((proposed.tags ?? []).map((t) => t.trim()).filter(Boolean))].sort();
    const curTags = [...new Set((current.tags ?? []).map((t) => t.trim()).filter(Boolean))].sort();
    if (propTags.join('\0') !== curTags.join('\0')) fieldChanges.push('tags');
  }

  const proposedContacts: PendingEditContact[] = Array.isArray(proposed.contacts)
    ? (proposed.contacts as PendingEditContact[])
    : [];
  const currentContacts = current?.contacts ?? [];

  const currentById = new Map(
    currentContacts.filter((c) => c.id).map((c) => [c.id as string, c]),
  );
  const proposedIds = new Set(
    proposedContacts.map((c) => c.id).filter((id): id is string => !!id),
  );

  const contacts: ContactDiffItem[] = [];

  for (const c of proposedContacts) {
    if (!c.id || !currentById.has(c.id)) {
      contacts.push({ kind: 'added', contact: c });
      continue;
    }
    const before = currentById.get(c.id)!;
    if (!contactsEqual(c, before)) {
      contacts.push({ kind: 'edited', contact: c, before });
    } else {
      contacts.push({ kind: 'unchanged', contact: c });
    }
  }

  for (const c of currentContacts) {
    if (c.id && !proposedIds.has(c.id)) {
      contacts.push({ kind: 'removed', contact: c });
    }
  }

  const addedCount = contacts.filter((c) => c.kind === 'added').length;
  const editedCount = contacts.filter((c) => c.kind === 'edited').length;
  const removedCount = contacts.filter((c) => c.kind === 'removed').length;

  const parts: string[] = [];
  if (fieldChanges.length > 0) {
    parts.push(fieldChanges.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(', '));
  }
  const contactBits: string[] = [];
  if (addedCount > 0) contactBits.push(`+${addedCount} contact${addedCount === 1 ? '' : 's'} added`);
  if (editedCount > 0) contactBits.push(`${editedCount} edited`);
  if (removedCount > 0) contactBits.push(`${removedCount} removed`);
  if (contactBits.length > 0) parts.push(contactBits.join(', '));
  if (parts.length === 0) parts.push('No detectable field changes');

  return {
    fieldChanges,
    contacts,
    addedCount,
    editedCount,
    removedCount,
    summaryLine: parts.join(' · '),
  };
}
