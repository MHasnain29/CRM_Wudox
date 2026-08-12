/**
 * Demo + future API seam: same shape the backend will use to fill the
 * onboarding package (local PDF overlay / PandaDoc tokens later).
 */
export type OnboardingEmployeeInput = {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  gender?: string | null;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  residencyStatus?: string | null;
  /** PDF [Candidate.VacationPayOption] — demo defaults when unset */
  vacationPayOption?: string | null;
};

/** Demo default until employee stores a real vacation-pay choice. */
export const DEMO_VACATION_PAY_OPTION = 'Option 1';

export type EmployeeOnboardingPrefill = {
  employee: {
    fullName: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    gender: string;
    address: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    residencyStatus: string;
    /** PDF token [Candidate.VacationPayOption] */
    vacationPayOption: string;
  };
  agency: {
    name: string;
    /** PDF [Agency.HRSupportContact] */
    hrSupportContact: string;
    /** PDF [Agency.PayrollSupportContact] */
    payrollSupportContact: string;
  };
  date: { today: string; year: string };
};

function text(value: string | null | undefined): string {
  const t = (value ?? '').trim();
  return t;
}

function joinAddress(line1?: string | null, line2?: string | null): string {
  return [text(line1), text(line2)].filter(Boolean).join(', ');
}

/** Temp defaults until real HR/payroll contacts live in agency settings. */
function tempSupportEmail(localPart: string, domain?: string | null): string {
  const d = text(domain).toLowerCase();
  return d ? `${localPart}@${d}` : '';
}

export function buildOnboardingPrefill(
  employee: OnboardingEmployeeInput,
  agency: {
    name: string;
    /** Agency allowed send-as domain (e.g. hrglobal.ca). */
    emailSendAsDomain?: string | null;
    hrSupportContact?: string | null;
    payrollSupportContact?: string | null;
  },
  now: Date = new Date(),
): EmployeeOnboardingPrefill {
  const firstName = text(employee.firstName);
  const lastName = text(employee.lastName);
  const agencyName = text(agency.name);
  const domain = agency.emailSendAsDomain;
  return {
    employee: {
      fullName: [firstName, lastName].filter(Boolean).join(' '),
      firstName,
      lastName,
      email: text(employee.email),
      phone: text(employee.phone),
      gender: text(employee.gender),
      address: joinAddress(employee.address, employee.addressLine2),
      city: text(employee.city),
      province: text(employee.province),
      postalCode: text(employee.postalCode),
      country: text(employee.country),
      emergencyContactName: text(employee.emergencyContactName),
      emergencyContactPhone: text(employee.emergencyContactPhone),
      residencyStatus: text(employee.residencyStatus),
      vacationPayOption: text(employee.vacationPayOption) || DEMO_VACATION_PAY_OPTION,
    },
    agency: {
      name: agencyName,
      // Temp: support@domain / payrollSupport@domain from Settings → email send-as domain
      hrSupportContact: text(agency.hrSupportContact) || tempSupportEmail('support', domain),
      payrollSupportContact:
        text(agency.payrollSupportContact) || tempSupportEmail('payrollSupport', domain),
    },
    date: {
      today: now.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      year: String(now.getFullYear()),
    },
  };
}
