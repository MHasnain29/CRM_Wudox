/**
 * Employee form UI extras: server is source of truth (employees.ui_extras).
 * localStorage is a legacy/cache fallback for pre-migration browsers.
 * Extra education/work-exp beyond DB columns stay here until Phase 2 columns.
 *
 * SIN numbers are intentionally NOT persisted locally or on the server.
 */

import type { EducationEntry, WorkExperienceEntry } from './formTypes';
import { newUid } from './formTypes';

const EXTRAS_KEY_PREFIX = 'employee-ui-extras:';
const DRAFT_KEY = 'employee-form-draft';

export type StoredEducationEntry = Omit<EducationEntry, 'uid'>;
export type StoredExperienceEntry = Omit<WorkExperienceEntry, 'uid'>;

export type StoredLicense = {
  licenseType: string;
  expiryDate: string;
  /** Uploaded employee-document id, once the file has been uploaded. */
  docId: string | null;
};

export type EmployeeUiExtras = {
  skills: string[];
  noWorkExperience: boolean;
  /** Education entries beyond the first (the first lives on the employee record). */
  extraEducation: StoredEducationEntry[];
  /** Work experiences beyond the two backend slots. */
  extraExperiences: StoredExperienceEntry[];
  assignedClientId: string;
  assignedClientName: string;
  photoIdType: string;
  photoIdNumber: string;
  photoIdExpiry: string;
  statusDocExpiry: string;
  sinDocExpiry: string;
  licensesNotApplicable: boolean;
  licenses: StoredLicense[];
  profilePhotoDocId: string | null;
};

export const emptyUiExtras = (): EmployeeUiExtras => ({
  skills: [],
  noWorkExperience: false,
  extraEducation: [],
  extraExperiences: [],
  assignedClientId: '',
  assignedClientName: '',
  photoIdType: '',
  photoIdNumber: '',
  photoIdExpiry: '',
  statusDocExpiry: '',
  sinDocExpiry: '',
  licensesNotApplicable: false,
  licenses: [],
  profilePhotoDocId: null,
});

function pickString(server: string | undefined, local: string): string {
  const s = typeof server === 'string' ? server.trim() : '';
  if (s) return server as string;
  return local ?? '';
}

/** True when GET returned defaults only (column null / never saved). */
export function isEmptyEmployeeUiExtras(
  extras: Partial<EmployeeUiExtras> | null | undefined,
): boolean {
  if (!extras) return true;
  return !(
    (Array.isArray(extras.skills) && extras.skills.length > 0) ||
    extras.noWorkExperience === true ||
    (Array.isArray(extras.extraEducation) && extras.extraEducation.length > 0) ||
    (Array.isArray(extras.extraExperiences) && extras.extraExperiences.length > 0) ||
    (typeof extras.assignedClientId === 'string' && extras.assignedClientId.trim()) ||
    (typeof extras.assignedClientName === 'string' && extras.assignedClientName.trim()) ||
    (typeof extras.photoIdType === 'string' && extras.photoIdType.trim()) ||
    (typeof extras.photoIdNumber === 'string' && extras.photoIdNumber.trim()) ||
    (typeof extras.photoIdExpiry === 'string' && extras.photoIdExpiry.trim()) ||
    (typeof extras.statusDocExpiry === 'string' && extras.statusDocExpiry.trim()) ||
    (typeof extras.sinDocExpiry === 'string' && extras.sinDocExpiry.trim()) ||
    extras.licensesNotApplicable === true ||
    (Array.isArray(extras.licenses) && extras.licenses.length > 0) ||
    (typeof extras.profilePhotoDocId === 'string' && extras.profilePhotoDocId.trim())
  );
}

/**
 * Merge server uiExtras (preferred) with legacy localStorage cache (fill gaps).
 * If server has never been saved, local wins entirely so legacy data migrates on next Save.
 */
export function mergeEmployeeUiExtras(
  server: Partial<EmployeeUiExtras> | null | undefined,
  local: EmployeeUiExtras,
): EmployeeUiExtras {
  if (isEmptyEmployeeUiExtras(server)) {
    return { ...emptyUiExtras(), ...local };
  }
  const s = server ?? {};
  const base = emptyUiExtras();
  // Server extras exist → arrays/bools are authoritative (empty = cleared), not local resurrection.
  return {
    skills: Array.isArray(s.skills) ? s.skills : local.skills ?? base.skills,
    noWorkExperience: s.noWorkExperience === true,
    extraEducation: Array.isArray(s.extraEducation)
      ? s.extraEducation
      : local.extraEducation ?? base.extraEducation,
    extraExperiences: Array.isArray(s.extraExperiences)
      ? s.extraExperiences
      : local.extraExperiences ?? base.extraExperiences,
    assignedClientId: pickString(s.assignedClientId, local.assignedClientId),
    assignedClientName: pickString(s.assignedClientName, local.assignedClientName),
    photoIdType: pickString(s.photoIdType, local.photoIdType),
    photoIdNumber: pickString(s.photoIdNumber, local.photoIdNumber),
    photoIdExpiry: pickString(s.photoIdExpiry, local.photoIdExpiry),
    statusDocExpiry: pickString(s.statusDocExpiry, local.statusDocExpiry),
    sinDocExpiry: pickString(s.sinDocExpiry, local.sinDocExpiry),
    licensesNotApplicable: s.licensesNotApplicable === true,
    licenses: Array.isArray(s.licenses) ? s.licenses : local.licenses ?? base.licenses,
    // Server null means intentionally cleared after a prior save.
    profilePhotoDocId: s.profilePhotoDocId ?? null,
  };
}

export function loadEmployeeUiExtras(employeeId: string): EmployeeUiExtras {
  try {
    const raw = localStorage.getItem(`${EXTRAS_KEY_PREFIX}${employeeId}`);
    if (!raw) return emptyUiExtras();
    return { ...emptyUiExtras(), ...(JSON.parse(raw) as Partial<EmployeeUiExtras>) };
  } catch {
    return emptyUiExtras();
  }
}

export function saveEmployeeUiExtras(employeeId: string, extras: EmployeeUiExtras): void {
  try {
    localStorage.setItem(`${EXTRAS_KEY_PREFIX}${employeeId}`, JSON.stringify(extras));
  } catch {
    /* storage full/unavailable — extras are non-critical */
  }
}

// ── New-employee draft (Save Draft before the record exists) ──────────────

/** JSON-serializable snapshot of the form (no File objects, no SIN number). */
export type EmployeeFormDraft = Record<string, unknown> & { savedAt: string };

const draftKey = (employeeId?: string) => (employeeId ? `${DRAFT_KEY}:${employeeId}` : DRAFT_KEY);

export function loadEmployeeFormDraft(employeeId?: string): EmployeeFormDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(employeeId));
    return raw ? (JSON.parse(raw) as EmployeeFormDraft) : null;
  } catch {
    return null;
  }
}

export function saveEmployeeFormDraft(draft: Record<string, unknown>, employeeId?: string): void {
  try {
    localStorage.setItem(
      draftKey(employeeId),
      JSON.stringify({ ...draft, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

export function clearEmployeeFormDraft(employeeId?: string): void {
  try {
    localStorage.removeItem(draftKey(employeeId));
  } catch {
    /* ignore */
  }
}

/** Summary of a locally saved draft, for the Employees list Draft tab. */
export type StoredDraftSummary = {
  storageKey: string;
  /** null = draft for a new (not yet created) employee */
  employeeId: string | null;
  name: string;
  savedAt: string | null;
};

export function listEmployeeFormDrafts(): StoredDraftSummary[] {
  const drafts: StoredDraftSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || (key !== DRAFT_KEY && !key.startsWith(`${DRAFT_KEY}:`))) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const name = [parsed.firstName, parsed.lastName]
          .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
          .join(' ');
        drafts.push({
          storageKey: key,
          employeeId: key === DRAFT_KEY ? null : key.slice(DRAFT_KEY.length + 1),
          name: name || 'Untitled draft',
          savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
        });
      } catch {
        /* skip malformed entries */
      }
    }
  } catch {
    /* localStorage unavailable */
  }
  return drafts.sort((a, b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? ''));
}

export function removeEmployeeFormDraftByKey(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

export function withUid<T extends object>(entry: T): T & { uid: string } {
  return { ...entry, uid: newUid() };
}
