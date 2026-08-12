/**
 * Normalize employee form UI extras stored on employees.ui_extras.
 * Never persist SIN digits here.
 */

export type EmployeeUiExtrasLicense = {
  licenseType: string;
  expiryDate: string;
  docId: string | null;
};

export type EmployeeUiExtrasEducation = {
  level: string;
  fromYear: string;
  endYear: string;
  graduated: '' | 'yes' | 'no';
  courseStudied: string;
  diplomaName: string;
};

export type EmployeeUiExtrasExperience = {
  companyName: string;
  contactNumber: string;
  position: string;
  duration: string;
};

export type EmployeeUiExtras = {
  skills: string[];
  noWorkExperience: boolean;
  extraEducation: EmployeeUiExtrasEducation[];
  extraExperiences: EmployeeUiExtrasExperience[];
  assignedClientId: string;
  assignedClientName: string;
  photoIdType: string;
  photoIdNumber: string;
  photoIdExpiry: string;
  statusDocExpiry: string;
  sinDocExpiry: string;
  licensesNotApplicable: boolean;
  licenses: EmployeeUiExtrasLicense[];
  profilePhotoDocId: string | null;
};

const MAX_STRING = 500;
const MAX_ARRAY = 50;

function asString(value: unknown, max = MAX_STRING): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

function asBool(value: unknown): boolean {
  return value === true;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.slice(0, 100))
    .slice(0, MAX_ARRAY);
}

function asGraduated(value: unknown): '' | 'yes' | 'no' {
  return value === 'yes' || value === 'no' ? value : '';
}

export function emptyEmployeeUiExtras(): EmployeeUiExtras {
  return {
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
  };
}

export function normalizeEmployeeUiExtras(raw: unknown): EmployeeUiExtras {
  const base = emptyEmployeeUiExtras();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const o = raw as Record<string, unknown>;

  const extraEducation = Array.isArray(o.extraEducation)
    ? o.extraEducation
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
        .slice(0, MAX_ARRAY)
        .map((e) => ({
          level: asString(e.level, 200),
          fromYear: asString(e.fromYear, 10),
          endYear: asString(e.endYear, 10),
          graduated: asGraduated(e.graduated),
          courseStudied: asString(e.courseStudied, 255),
          diplomaName: asString(e.diplomaName, 255),
        }))
    : [];

  const extraExperiences = Array.isArray(o.extraExperiences)
    ? o.extraExperiences
        .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
        .slice(0, MAX_ARRAY)
        .map((e) => ({
          companyName: asString(e.companyName, 255),
          contactNumber: asString(e.contactNumber, 50),
          position: asString(e.position, 255),
          duration: asString(e.duration, 100),
        }))
    : [];

  const licenses = Array.isArray(o.licenses)
    ? o.licenses
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object' && !Array.isArray(l))
        .slice(0, MAX_ARRAY)
        .map((l) => ({
          licenseType: asString(l.licenseType, 200),
          expiryDate: asString(l.expiryDate, 32),
          docId: typeof l.docId === 'string' && l.docId.trim() ? l.docId.trim().slice(0, 64) : null,
        }))
    : [];

  return {
    skills: asStringArray(o.skills),
    noWorkExperience: asBool(o.noWorkExperience),
    extraEducation,
    extraExperiences,
    assignedClientId: asString(o.assignedClientId, 64),
    assignedClientName: asString(o.assignedClientName, 255),
    photoIdType: asString(o.photoIdType, 100),
    photoIdNumber: asString(o.photoIdNumber, 100),
    photoIdExpiry: asString(o.photoIdExpiry, 32),
    statusDocExpiry: asString(o.statusDocExpiry, 32),
    sinDocExpiry: asString(o.sinDocExpiry, 32),
    licensesNotApplicable: asBool(o.licensesNotApplicable),
    licenses,
    profilePhotoDocId:
      typeof o.profilePhotoDocId === 'string' && o.profilePhotoDocId.trim()
        ? o.profilePhotoDocId.trim().slice(0, 64)
        : null,
  };
}
