/**
 * Employee create/edit form — UI state model, option lists, and document
 * checklist helpers. Skills / license metadata / extras may still use
 * localExtras; client placement after approval uses the assignment API.
 */

import type {
  AvailabilityType,
  EmployeeType,
  EmployeeWorkStatus,
  Gender,
  ResidencyStatus,
  SalaryPaymentMethod,
} from '@/lib/employeeTypes';
import { FORKLIFT_LICENSE_TYPES } from './skillLicenseMap';

export type ExistingDocRef = {
  id: string;
  name: string;
  fileName: string;
  fileSize: number;
};

/** One uploadable document slot (new file, or already-uploaded doc). */
export type DocSlot = {
  file: File | null;
  existingDoc: ExistingDocRef | null;
  expiryDate: string; // yyyy-mm-dd, '' = not set
};

export type EducationEntry = {
  uid: string;
  level: string;
  fromYear: string;
  endYear: string;
  graduated: '' | 'yes' | 'no';
  courseStudied: string;
  diplomaName: string;
};

export type WorkExperienceEntry = {
  uid: string;
  companyName: string;
  contactNumber: string;
  position: string;
  duration: string;
};

export type LicenseEntry = {
  uid: string;
  licenseType: string;
  expiryDate: string;
  file: File | null;
  existingDoc: ExistingDocRef | null;
};

export type PhotoIdTypeKey =
  | 'drivers_license'
  | 'passport'
  | 'provincial_id'
  | 'other_government_id';

export const PHOTO_ID_TYPES: { value: PhotoIdTypeKey; label: string }[] = [
  { value: 'drivers_license', label: "Driver's License" },
  { value: 'passport', label: 'Passport' },
  { value: 'provincial_id', label: 'Provincial Photo ID' },
  { value: 'other_government_id', label: 'Other Government Photo ID' },
];

/** Work status card options — map 1:1 onto the backend residencyStatus enum. */
export const WORK_STATUS_OPTIONS: { value: ResidencyStatus; label: string }[] = [
  { value: 'citizen', label: 'Citizen' },
  { value: 'pr', label: 'Permanent Resident' },
  { value: 'work_permit', label: 'Open Work Permit' },
  { value: 'refugee', label: 'Refugee Work Permit' },
  { value: 'student', label: 'Study Permit' },
];

export const SKILL_OPTIONS = [
  'General Labour',
  'Warehouse',
  'Forklift Operator',
  'Picker / Packer',
  'Machine Operator',
  'Assembly Line',
  'Shipping & Receiving',
  'Inventory Management',
  'Food Production',
  'Cleaning / Janitorial',
  'Construction',
  'Landscaping',
  'Customer Service',
  'Data Entry',
  'Administrative Support',
  'Reception',
  'Driving (Class G)',
  'Driving (Class AZ/DZ)',
  'Healthcare Aide',
  'First Aid Certified',
] as const;

export const LICENSE_TYPE_OPTIONS = [
  ...FORKLIFT_LICENSE_TYPES,
  'Food Handler Certificate',
  'First Aid / CPR',
  'WHMIS',
  'Security License',
  'Driver License (Class G)',
  'Driver License (AZ/DZ)',
  'Other',
] as const;

export const PROVINCES = [
  'Alberta', 'British Columbia', 'Manitoba', 'New Brunswick',
  'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia',
  'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon',
];

export type EmployeeFormState = {
  // Type & status (backend)
  employeeType: EmployeeType;
  workStatus: EmployeeWorkStatus;
  // Personal (backend)
  firstName: string;
  lastName: string;
  gender: Gender | '';
  dateOfBirth: string;
  // Contact (backend)
  email: string;
  phone: string;
  // Address (backend)
  address: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  // Emergency (backend)
  emergencyContactName: string;
  emergencyContactPhone: string;
  // Education — entry 0 maps to the backend fields; extras are UI-only
  education: EducationEntry[];
  // Work experience — first two map to the backend slots; extras are UI-only
  noWorkExperience: boolean;
  workExperiences: WorkExperienceEntry[];
  experienceDuties: string;
  // Skills (backend)
  skills: string[];
  // Availability (backend)
  availableFrom: string;
  availabilityTypes: AvailabilityType[];
  shiftsAvailable: string[];
  ableTwelveHourShift: '' | 'yes' | 'no';
  englishProficiency: string[];
  // Work status in Canada — backend residencyStatus
  residencyStatus: ResidencyStatus | '';
  // Salary & payment (backend)
  hourlyRate: string;
  salaryPaymentMethod: SalaryPaymentMethod | '';
  bankName: string;
  bankInstitutionNumber: string;
  bankTransitNumber: string;
  bankAccountNumber: string;
  depositDoc: DocSlot;
  // Client assignment (UI-only)
  assignedClientId: string;
  assignedClientName: string;
  // Documents (files upload via the existing documents API; expiry is UI-only)
  photoIdType: PhotoIdTypeKey | '';
  photoIdNumber: string;
  photoId: DocSlot;
  statusDoc: DocSlot;
  sinNumber: string;
  sinDoc: DocSlot;
  agreementDoc: DocSlot;
  licensesNotApplicable: boolean;
  licenses: LicenseEntry[];
};

export type FormErrors = Record<string, string>;

export type SetField = <K extends keyof EmployeeFormState>(
  key: K,
  value: EmployeeFormState[K],
) => void;

export function newUid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export const emptyDocSlot = (): DocSlot => ({ file: null, existingDoc: null, expiryDate: '' });

export const emptyEducationEntry = (): EducationEntry => ({
  uid: newUid(),
  level: '',
  fromYear: '',
  endYear: '',
  graduated: '',
  courseStudied: '',
  diplomaName: '',
});

export const emptyExperienceEntry = (): WorkExperienceEntry => ({
  uid: newUid(),
  companyName: '',
  contactNumber: '',
  position: '',
  duration: '',
});

export const emptyLicenseEntry = (): LicenseEntry => ({
  uid: newUid(),
  licenseType: '',
  expiryDate: '',
  file: null,
  existingDoc: null,
});

export const emptyEmployeeFormState = (): EmployeeFormState => ({
  employeeType: 'external',
  workStatus: 'none',
  firstName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  address: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  education: [emptyEducationEntry()],
  noWorkExperience: false,
  workExperiences: [emptyExperienceEntry()],
  experienceDuties: '',
  skills: [],
  availableFrom: '',
  availabilityTypes: [],
  shiftsAvailable: [],
  ableTwelveHourShift: '',
  englishProficiency: [],
  residencyStatus: '',
  hourlyRate: '',
  salaryPaymentMethod: '',
  bankName: '',
  bankInstitutionNumber: '',
  bankTransitNumber: '',
  bankAccountNumber: '',
  depositDoc: emptyDocSlot(),
  assignedClientId: '',
  assignedClientName: '',
  photoIdType: '',
  photoIdNumber: '',
  photoId: emptyDocSlot(),
  statusDoc: emptyDocSlot(),
  sinNumber: '',
  sinDoc: emptyDocSlot(),
  agreementDoc: emptyDocSlot(),
  licensesNotApplicable: false,
  licenses: [emptyLicenseEntry()],
});

// ── Expiry / checklist helpers ────────────────────────────────────────────

export type ExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

const EXPIRING_SOON_DAYS = 90;

/** Non-license docs (photo ID / status / SIN) must expire more than this many days out. */
export const MIN_NON_LICENSE_EXPIRY_DAYS = 30;

export const NON_LICENSE_EXPIRY_TOO_SOON_MSG =
  'Do not enter an expiry less than 1 month from today';

function toISODateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Earliest selectable yyyy-mm-dd = today + 31 days (strictly more than 1 month). */
export function minNonLicenseExpiryDateISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + MIN_NON_LICENSE_EXPIRY_DAYS + 1);
  return toISODateLocal(d);
}

/** True when a non-empty date is before the min allowed non-license expiry. */
export function isExpiryTooSoon(expiryDate: string): boolean {
  if (!expiryDate.trim()) return false;
  const d = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const min = new Date(`${minNonLicenseExpiryDateISO()}T00:00:00`);
  return d < min;
}

export function expiryStateOf(expiryDate: string): ExpiryState {
  if (!expiryDate) return 'none';
  const d = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (d < today) return 'expired';
  const soon = new Date(today);
  soon.setDate(soon.getDate() + EXPIRING_SOON_DAYS);
  if (d <= soon) return 'expiring';
  return 'valid';
}

export type DocChecklistItem = {
  key: string;
  label: string;
  hasDocument: boolean;
  /** Expiry date if tracked for this item ('' when not set). */
  expiryDate: string;
  /** Whether this item needs an expiry date to count as complete. */
  expiryRequired: boolean;
};

export type DocChecklistStatus = 'complete' | 'expiring' | 'expired' | 'missing';

export function checklistItemStatus(item: DocChecklistItem): DocChecklistStatus {
  if (!item.hasDocument) return 'missing';
  const state = expiryStateOf(item.expiryDate);
  if (state === 'expired') return 'expired';
  if (state === 'expiring') return 'expiring';
  if (item.expiryRequired && state === 'none') return 'missing';
  return 'complete';
}

/** Build the live document checklist from form state. */
export function buildDocChecklist(form: EmployeeFormState): DocChecklistItem[] {
  const isCitizen = form.residencyStatus === 'citizen';
  const slotHasDoc = (slot: DocSlot) => Boolean(slot.file || slot.existingDoc);

  const items: DocChecklistItem[] = [
    {
      key: 'photo_id',
      label: 'Photo ID',
      hasDocument: slotHasDoc(form.photoId),
      expiryDate: form.photoId.expiryDate,
      expiryRequired: true,
    },
    {
      key: 'proof_of_status',
      label: 'Status in Canada',
      hasDocument: slotHasDoc(form.statusDoc),
      expiryDate: isCitizen ? '' : form.statusDoc.expiryDate,
      expiryRequired: !isCitizen,
    },
    {
      key: 'sin',
      label: 'SIN Document',
      hasDocument: slotHasDoc(form.sinDoc),
      expiryDate: isCitizen ? '' : form.sinDoc.expiryDate,
      expiryRequired: false,
    },
  ];

  if (form.salaryPaymentMethod === 'deposit') {
    items.push({
      key: 'bank_deposit',
      label: 'Deposit Attachment',
      hasDocument: slotHasDoc(form.depositDoc),
      expiryDate: '',
      expiryRequired: false,
    });
  }

  if (!form.licensesNotApplicable && form.licenses.length > 0) {
    form.licenses.forEach((license, i) => {
      items.push({
        key: `license-${license.uid}`,
        label: license.licenseType || `License ${i + 1}`,
        hasDocument: Boolean(license.file || license.existingDoc),
        expiryDate: license.expiryDate,
        expiryRequired: true,
      });
    });
  }

  return items;
}

export type DocSummary = {
  complete: number;
  expiring: number;
  expired: number;
  missing: number;
  total: number;
};

// ── Draft snapshot (Save Draft — JSON-safe, no File objects, no SIN) ───────

export type FormSnapshot = Record<string, unknown>;

export function serializeFormSnapshot(form: EmployeeFormState): FormSnapshot {
  const stripSlot = (slot: DocSlot) => ({ existingDoc: slot.existingDoc, expiryDate: slot.expiryDate });
  return {
    ...form,
    sinNumber: '', // never persist SIN locally
    photoId: stripSlot(form.photoId),
    statusDoc: stripSlot(form.statusDoc),
    sinDoc: stripSlot(form.sinDoc),
    agreementDoc: stripSlot(form.agreementDoc),
    depositDoc: stripSlot(form.depositDoc),
    licenses: form.licenses.map(({ file: _file, ...rest }) => rest),
  };
}

export function applyFormSnapshot(snapshot: FormSnapshot): EmployeeFormState {
  const base = emptyEmployeeFormState();
  const restoreSlot = (raw: unknown): DocSlot => {
    const s = (raw ?? {}) as Partial<DocSlot>;
    return { file: null, existingDoc: s.existingDoc ?? null, expiryDate: s.expiryDate ?? '' };
  };
  const merged = { ...base, ...snapshot } as EmployeeFormState & FormSnapshot;
  merged.photoId = restoreSlot(snapshot.photoId);
  merged.statusDoc = restoreSlot(snapshot.statusDoc);
  merged.sinDoc = restoreSlot(snapshot.sinDoc);
  merged.agreementDoc = restoreSlot(snapshot.agreementDoc);
  merged.depositDoc = restoreSlot(snapshot.depositDoc);
  merged.sinNumber = '';
  merged.education = (Array.isArray(snapshot.education) && snapshot.education.length > 0
    ? (snapshot.education as EducationEntry[])
    : base.education
  ).map((e) => ({ ...emptyEducationEntry(), ...e, uid: e.uid || newUid() }));
  merged.workExperiences = (Array.isArray(snapshot.workExperiences) && snapshot.workExperiences.length > 0
    ? (snapshot.workExperiences as WorkExperienceEntry[])
    : base.workExperiences
  ).map((e) => ({ ...emptyExperienceEntry(), ...e, uid: e.uid || newUid() }));
  merged.licenses = (Array.isArray(snapshot.licenses) && snapshot.licenses.length > 0
    ? (snapshot.licenses as Array<Omit<LicenseEntry, 'file'>>)
    : base.licenses
  ).map((l) => ({ ...emptyLicenseEntry(), ...l, file: null, uid: l.uid || newUid() }));
  // Migrate legacy draft field availabilityType → availabilityTypes
  const legacyAvail = snapshot.availabilityType;
  if (
    (!Array.isArray(merged.availabilityTypes) || merged.availabilityTypes.length === 0) &&
    (legacyAvail === 'full_time' || legacyAvail === 'part_time')
  ) {
    merged.availabilityTypes = [legacyAvail];
  }
  if (!Array.isArray(merged.availabilityTypes)) {
    merged.availabilityTypes = [];
  }
  if (!Array.isArray(merged.skills)) {
    merged.skills = [];
  }
  merged.employeeType = 'external';
  return merged;
}

export function summarizeDocChecklist(items: DocChecklistItem[]): DocSummary {
  const summary: DocSummary = { complete: 0, expiring: 0, expired: 0, missing: 0, total: items.length };
  for (const item of items) {
    const status = checklistItemStatus(item);
    if (status === 'complete') summary.complete += 1;
    else if (status === 'expiring') summary.expiring += 1;
    else if (status === 'expired') summary.expired += 1;
    else summary.missing += 1;
  }
  return summary;
}
