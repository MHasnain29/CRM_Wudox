// Employee Management Types (aligned with GET/POST /employees API)

export type EmployeeType = 'internal' | 'external';
export type EmployeeWorkStatus = 'none' | 'active' | 'scheduled';
export type EmployeeTag = 'blacklisted' | 'no_show' | 'ex';
export type EmployeeApprovalStatus = 'pending' | 'approved' | 'rejected';
export type DocumentType = 'photo_id' | 'sin' | 'proof_of_status' | 'resume' | 'agreement' | 'bank_deposit' | 'other';
export type Gender = 'male' | 'female' | 'other';
export type AvailabilityType = 'full_time' | 'part_time';
export type ResidencyStatus = 'citizen' | 'pr' | 'student' | 'refugee' | 'work_permit';
export type SalaryPaymentMethod = 'cheque' | 'deposit';

export interface EmployeeDocument {
  id: string;
  type: DocumentType;
  name: string;
  fileName: string;
  fileSize: number;
  mimeType: string | null;
  url?: string;
  uploadedAt: string;
  uploadedBy: string;
  uploadedByName: string;
  expiryDate?: string | null;
  notes?: string | null;
}

export interface EmployeeNote {
  id: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

export interface EmergencyContact {
  name: string;
  phone: string;
  relationship?: string;
  email?: string;
}

export interface EmployeeWorkExperience {
  id?: string;
  companyName: string;
  contactNumber?: string | null;
  position?: string | null;
  duration?: string | null;
  sortOrder: number;
}

/** Form-only extras on GET detail / create / update. Never includes SIN. */
export interface EmployeeUiExtras {
  skills: string[];
  noWorkExperience: boolean;
  extraEducation: Array<{
    level: string;
    fromYear: string;
    endYear: string;
    graduated: '' | 'yes' | 'no';
    courseStudied: string;
    diplomaName: string;
  }>;
  extraExperiences: Array<{
    companyName: string;
    contactNumber: string;
    position: string;
    duration: string;
  }>;
  assignedClientId: string;
  assignedClientName: string;
  photoIdType: string;
  photoIdNumber: string;
  photoIdExpiry: string;
  statusDocExpiry: string;
  sinDocExpiry: string;
  licensesNotApplicable: boolean;
  licenses: Array<{ licenseType: string; expiryDate: string; docId: string | null }>;
  profilePhotoDocId: string | null;
}

export interface Employee {
  id: string;
  employeeType: EmployeeType;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  alternatePhone?: string | null;
  dateOfBirth?: string | null;
  gender?: Gender | null;
  address?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContact?: EmergencyContact | null;
  educationLevel?: string | null;
  educationFromYear?: number | null;
  educationEndYear?: number | null;
  graduated?: boolean | null;
  courseStudied?: string | null;
  diplomaName?: string | null;
  experienceDuties?: string | null;
  availableFrom?: string | null;
  availabilityTypes?: AvailabilityType[];
  skills?: string[];
  residencyStatus?: ResidencyStatus | null;
  shiftsAvailable?: string[];
  ableTwelveHourShift?: boolean | null;
  englishProficiency?: string[];
  workStatus: EmployeeWorkStatus | null;
  specialTags: EmployeeTag[];
  approvalStatus: EmployeeApprovalStatus | null;
  hireDate?: string | null;
  terminationDate?: string | null;
  position?: string | null;
  department?: string | null;
  hourlyRate?: number | null;
  salaryPaymentMethod?: SalaryPaymentMethod | null;
  bankName?: string | null;
  bankInstitutionNumber?: string | null;
  bankTransitNumber?: string | null;
  bankAccountNumber?: string | null;
  documents?: EmployeeDocument[];
  notes?: EmployeeNote[];
  workExperiences?: EmployeeWorkExperience[];
  addedBy: string;
  addedByName: string;
  addedBySubCompanyId?: string | null;
  approvedBy?: string | null;
  approvedByName?: string;
  approvedAt?: string | null;
  rejectedBy?: string | null;
  rejectedByName?: string;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  submitterRole?: string | null;
  currentStepIndex?: number;
  approvalChain?: string[];
  activeAssignmentId?: string | null;
  activeClientId?: string | null;
  activeClientName?: string | null;
  assignedClientId?: string | null;
  assignedClientName?: string | null;
  /** Active job roster (if placed on a job). */
  activeJobId?: string | null;
  activeJobTitle?: string | null;
  /** Placed, but at least one client-training form still needs a signed upload. */
  clientTrainingPending?: boolean;
  onboardingPandaDocId?: string | null;
  onboardingPandaDocStatus?: string | null;
  onboardingPandaDocUpdatedAt?: string | null;
  /** Pending readiness: agreement signed? */
  agreementStatus?: 'incomplete' | 'complete';
  /** Default trainings completed (certificates). */
  trainingCompletedCount?: number;
  trainingRequiredCount?: number;
  /** Detail-only form extras (photo ID type/number, licenses, etc.). */
  uiExtras?: EmployeeUiExtras | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface CreateEmployeePayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  gender: Gender;
  dateOfBirth?: string | null;
  address: string;
  addressLine2?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country?: string | null;
  emergencyContactName: string;
  emergencyContactPhone: string;
  educationLevel: string;
  educationFromYear?: number | null;
  educationEndYear?: number | null;
  graduated: boolean;
  courseStudied?: string | null;
  diplomaName?: string | null;
  experienceDuties: string;
  availableFrom: string;
  availabilityTypes: AvailabilityType[];
  skills?: string[];
  residencyStatus: ResidencyStatus;
  shiftsAvailable: string[];
  ableTwelveHourShift: boolean;
  englishProficiency: string[];
  workExperiences: Omit<EmployeeWorkExperience, 'id'>[];
  employeeType?: EmployeeType;
  workStatus?: EmployeeWorkStatus | null;
  hourlyRate?: number | null;
  salaryPaymentMethod?: SalaryPaymentMethod | null;
  bankName?: string | null;
  bankInstitutionNumber?: string | null;
  bankTransitNumber?: string | null;
  bankAccountNumber?: string | null;
  /** Agency that owns this employee (demo scope). */
  addedBySubCompanyId?: string | null;
  uiExtras?: EmployeeUiExtras;
}

export interface EmployeeCounts {
  master: number;
  active: number;
  blacklist: number;
  ex: number;
  pending: number;
  unregistered?: number;
}

export type EmployeePipelineBucket =
  | 'unregistered'
  | 'pending'
  | 'master'
  | 'active';

/** Why a job placement ended (recruitment demo). */
export type PlacementEndReason = 'work_complete' | 'not_performing' | 'other';

export const PLACEMENT_END_REASON_LABELS: Record<PlacementEndReason, string> = {
  work_complete: 'Work is complete',
  not_performing: 'Employee not performing well',
  other: 'Other',
};

export interface EmployeeAssignment {
  id: string;
  employeeId: string;
  targetType: 'client' | 'job';
  clientId?: string | null;
  activeClientId?: string | null;
  clientName?: string | null;
  jobId?: string | null;
  jobTitle?: string | null;
  jobCompany?: string | null;
  workLocation?: string | null;
  positionTitle?: string | null;
  payRate?: string | null;
  shiftSchedule?: string | null;
  expectedDuration?: string | null;
  supervisorInfo?: string | null;
  requiredPpe?: string | null;
  workplaceHazards?: string | null;
  detailsSentToCandidateAt?: string | null;
  trainingMessage?: string | null;
  trainingSentAt?: string | null;
  trainingChannel?: 'email' | 'sms' | string | null;
  trainingCertificateDocumentId?: string | null;
  trainingCompletedAt?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'ended';
  isActive: boolean;
  /** Job targets: requested roster role (primary vs backup pool). */
  isBackup?: boolean;
  submittedById: string;
  submittedByName: string;
  submittedAt: string;
  approvedById?: string | null;
  approvedByName?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  /** When the placement ended (ISO). */
  endedAt?: string | null;
  endReason?: PlacementEndReason | null;
  endNotes?: string | null;
  /** Performance rating 1–5 when placement ended. */
  rating?: number | null;
  currentStepIndex?: number;
  approvalChain?: string[] | unknown;
  subCompanyId?: string | null;
}

/** Standalone employee training (not tied to a client placement). */
export interface EmployeeTraining {
  id: string;
  employeeId: string;
  title?: string | null;
  url: string | null;
  sentAt: string | null;
  channel: 'email' | string | null;
  certificateDocumentId: string | null;
  completedAt: string | null;
  sentById: string | null;
  sentByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EmployeeAssignmentDetailsInput = {
  workLocation?: string | null;
  positionTitle?: string | null;
  payRate?: string | null;
  shiftSchedule?: string | null;
  expectedDuration?: string | null;
  supervisorInfo?: string | null;
  requiredPpe?: string | null;
  workplaceHazards?: string | null;
};

export const SHIFT_OPTIONS = ['Day', 'Afternoon', 'Night', 'Weekends'] as const;
export const ENGLISH_OPTIONS = ['Speak', 'Read', 'Write', 'All'] as const;
