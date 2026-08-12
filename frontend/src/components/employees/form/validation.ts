import {
  isForkliftLicenseType,
  requiredLicensesForSkills,
  skillsRequireForkliftLicenses,
} from './skillLicenseMap';
import {
  NON_LICENSE_EXPIRY_TOO_SOON_MSG,
  isExpiryTooSoon,
  type EmployeeFormState,
  type FormErrors,
} from './formTypes';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const POSTAL_RE = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

export const MIN_EMPLOYEE_AGE = 18;

// Shared DOB validator — used both on submit and for live field feedback.
export function dateOfBirthError(value: string): string | undefined {
  if (!value) return undefined;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime()) || dob > new Date()) {
    return 'Enter a valid date of birth';
  }
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  if (age < MIN_EMPLOYEE_AGE) {
    return `Employee must be at least ${MIN_EMPLOYEE_AGE} years old`;
  }
  return undefined;
}

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

function parseYear(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/** Visual top-to-bottom order matching EmployeeForm layout (left then right panel). */
export const FORM_FIELD_ORDER: string[] = [
  'firstName',
  'lastName',
  'gender',
  'dateOfBirth',
  'email',
  'phone',
  'address',
  'city',
  'province',
  'postalCode',
  'emergencyContactName',
  'emergencyContactPhone',
  'education.0.level',
  'education.0.graduated',
  'education.0.fromYear',
  'education.0.endYear',
  'work.0.companyName',
  'work.0.contactNumber',
  'work.0.position',
  'work.0.duration',
  'work.1.companyName',
  'work.1.contactNumber',
  'work.1.position',
  'work.1.duration',
  'experienceDuties',
  'skills',
  'availabilityTypes',
  'availableFrom',
  'ableTwelveHourShift',
  'shiftsAvailable',
  'englishProficiency',
  'salaryPaymentMethod',
  'hourlyRate',
  'bankName',
  'bankInstitutionNumber',
  'bankTransitNumber',
  'bankAccountNumber',
  'depositDoc',
  'photoIdType',
  'photoId.expiryDate',
  'residencyStatus',
  'statusDoc.expiryDate',
  'sinNumber',
  'sinDoc.expiryDate',
];

export function validateEmployeeForm(form: EmployeeFormState): FormErrors {
  const errors: FormErrors = {};
  const req = (key: string, label: string, value: string) => {
    if (!value.trim()) errors[key] = `${label} is required`;
  };

  req('firstName', 'First name', form.firstName);
  req('lastName', 'Last name', form.lastName);
  if (!form.gender) errors.gender = 'Gender is required';
  req('email', 'Email', form.email);
  if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) {
    errors.email = 'Enter a valid email address';
  } else if (form.email.trim().length > 255) {
    errors.email = 'Email must be 255 characters or less';
  }
  req('phone', 'Phone', form.phone);
  if (form.phone.trim() && digitCount(form.phone) < 7) {
    errors.phone = 'Enter a valid phone number';
  }
  const dobErr = dateOfBirthError(form.dateOfBirth);
  if (dobErr) errors.dateOfBirth = dobErr;
  req('address', 'Address', form.address);
  req('city', 'City', form.city);
  if (!form.province) errors.province = 'Province is required';
  req('postalCode', 'Postal code', form.postalCode);
  if (form.postalCode.trim() && !POSTAL_RE.test(form.postalCode.trim())) {
    errors.postalCode = 'Use Canadian format (e.g. A1A 1A1)';
  }
  req('emergencyContactName', 'Emergency contact name', form.emergencyContactName);
  req('emergencyContactPhone', 'Emergency contact phone', form.emergencyContactPhone);
  if (form.emergencyContactPhone.trim() && digitCount(form.emergencyContactPhone) < 7) {
    errors.emergencyContactPhone = 'Enter a valid phone number';
  }

  form.education.forEach((entry, i) => {
    if (i === 0) {
      req(`education.${i}.level`, 'Level of education', entry.level);
      if (!entry.graduated) errors[`education.${i}.graduated`] = 'Required';
    }
    const fromYear = parseYear(entry.fromYear);
    const endYear = parseYear(entry.endYear);
    if (entry.fromYear.trim() && (fromYear == null || fromYear < 1950 || fromYear > 2100)) {
      errors[`education.${i}.fromYear`] = 'Year must be between 1950 and 2100';
    }
    if (entry.endYear.trim() && (endYear == null || endYear < 1950 || endYear > 2100)) {
      errors[`education.${i}.endYear`] = 'Year must be between 1950 and 2100';
    }
    if (fromYear != null && endYear != null && fromYear > endYear) {
      errors[`education.${i}.endYear`] = 'End year must be on or after from year';
    }
  });

  if (!form.noWorkExperience) {
    form.workExperiences.forEach((entry, i) => {
      req(`work.${i}.companyName`, 'Company name', entry.companyName);
      req(`work.${i}.contactNumber`, 'Contact number', entry.contactNumber);
      req(`work.${i}.position`, 'Position', entry.position);
      req(`work.${i}.duration`, 'Duration', entry.duration);
      if (entry.contactNumber.trim() && digitCount(entry.contactNumber) < 7) {
        errors[`work.${i}.contactNumber`] = 'Enter a valid contact number';
      }
    });
    req('experienceDuties', 'Experience / duties', form.experienceDuties);
  }

  if (form.availabilityTypes.length === 0) {
    errors.availabilityTypes = 'Select at least one availability option';
  }
  if (!form.availableFrom) errors.availableFrom = 'Available from date is required';
  if (!form.residencyStatus) errors.residencyStatus = 'Status is required';
  if (form.shiftsAvailable.length === 0) errors.shiftsAvailable = 'Select at least one shift';
  if (!form.ableTwelveHourShift) errors.ableTwelveHourShift = 'Please answer this question';
  if (form.englishProficiency.length === 0) {
    errors.englishProficiency = 'Select at least one option';
  }

  if (form.sinNumber && digitCount(form.sinNumber) !== 9) {
    errors.sinNumber = 'SIN must be 9 digits';
  }

  if (!form.salaryPaymentMethod) {
    errors.salaryPaymentMethod = 'Select cheque or direct deposit';
  }
  if (form.hourlyRate.trim()) {
    const rate = Number(form.hourlyRate);
    if (!Number.isFinite(rate) || rate < 0) {
      errors.hourlyRate = 'Enter a valid hourly rate';
    }
  }
  if (form.salaryPaymentMethod === 'deposit') {
    req('bankName', 'Bank name', form.bankName);
    req('bankInstitutionNumber', 'Institution number', form.bankInstitutionNumber);
    if (form.bankInstitutionNumber.trim() && form.bankInstitutionNumber.trim().length !== 3) {
      errors.bankInstitutionNumber = 'Institution number must be 3 digits';
    }
    req('bankTransitNumber', 'Transit number', form.bankTransitNumber);
    if (form.bankTransitNumber.trim() && form.bankTransitNumber.trim().length !== 5) {
      errors.bankTransitNumber = 'Transit number must be 5 digits';
    }
    req('bankAccountNumber', 'Account number', form.bankAccountNumber);
    if (!form.depositDoc.file && !form.depositDoc.existingDoc) {
      errors.depositDoc = 'Upload a void cheque or deposit form';
    }
  }

  // Non-license docs: expiry must be more than 1 month out (licenses exempt).
  if (isExpiryTooSoon(form.photoId.expiryDate)) {
    errors['photoId.expiryDate'] = NON_LICENSE_EXPIRY_TOO_SOON_MSG;
  }
  const isCitizen = form.residencyStatus === 'citizen';
  if (!isCitizen && isExpiryTooSoon(form.statusDoc.expiryDate)) {
    errors['statusDoc.expiryDate'] = NON_LICENSE_EXPIRY_TOO_SOON_MSG;
  }
  if (!isCitizen && isExpiryTooSoon(form.sinDoc.expiryDate)) {
    errors['sinDoc.expiryDate'] = NON_LICENSE_EXPIRY_TOO_SOON_MSG;
  }

  const requiredLicenseTypes = requiredLicensesForSkills(form.skills);
  for (const licenseType of requiredLicenseTypes) {
    const row = form.licenses.find((l) => l.licenseType === licenseType);
    const safeKey = licenseType.replace(/\s+/g, '_');
    if (!row?.expiryDate?.trim()) {
      errors[`licenses.${safeKey}.expiryDate`] = 'Expiry date is required';
    }
    if (!row?.file && !row?.existingDoc) {
      errors[`licenses.${safeKey}.file`] = 'Upload the license document';
    }
  }

  if (skillsRequireForkliftLicenses(form.skills)) {
    const forkliftRows = form.licenses.filter((l) => isForkliftLicenseType(l.licenseType));
    if (forkliftRows.length === 0) {
      errors['licenses.forklift'] = 'Select at least one forklift equipment license';
    }
    for (const row of forkliftRows) {
      const safeKey = row.licenseType.replace(/\s+/g, '_');
      if (!row.expiryDate?.trim()) {
        errors[`licenses.${safeKey}.expiryDate`] = 'Expiry date is required';
      }
      if (!row.file && !row.existingDoc) {
        errors[`licenses.${safeKey}.file`] = 'Upload the license document';
      }
    }
  }

  return errors;
}

export function scrollToFirstError(errors: FormErrors): void {
  const errorKeys = Object.keys(errors);
  if (errorKeys.length === 0) return;

  const ordered =
    FORM_FIELD_ORDER.find((k) => errors[k]) ??
    errorKeys.find((k) => k.startsWith('licenses.')) ??
    errorKeys[0];

  if (!ordered) return;

  const el =
    document.querySelector(`[data-field="${CSS.escape(ordered)}"]`) ??
    document.querySelector(`[data-field^="${CSS.escape(ordered.split('.').slice(0, 2).join('.'))}"]`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/** Build data-field key for a license row error. */
export function licenseErrorKey(licenseType: string, part: 'expiryDate' | 'file'): string {
  return `licenses.${licenseType.replace(/\s+/g, '_')}.${part}`;
}
