import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { useHasPermission } from '@/lib/access';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import {
  approveEmployee,
  createEmployee,
  deleteEmployeeDocument,
  fetchEmployee,
  getAuthHeaders,
  getEmployeeDocumentDownloadUrl,
  postApprovalAction,
  sendEmployeeOnboarding,
  submitEmployeeForApproval,
  updateEmployee,
  uploadEmployeeDocument,
  updateEmployeeDocumentExpiry,
} from '@/lib/api';
import { fetchActiveClients } from '@/lib/activeClientsApi';
import type {
  AvailabilityType,
  Employee,
  EmployeeDocument,
  Gender,
  ResidencyStatus,
  SalaryPaymentMethod,
} from '@/lib/employeeTypes';
import {
  applyFormSnapshot,
  emptyEducationEntry,
  emptyEmployeeFormState,
  emptyExperienceEntry,
  emptyLicenseEntry,
  newUid,
  serializeFormSnapshot,
  type EmployeeFormState,
  type FormErrors,
  type PhotoIdTypeKey,
} from '@/components/employees/form/formTypes';
import {
  clearEmployeeFormDraft,
  loadEmployeeFormDraft,
  loadEmployeeUiExtras,
  mergeEmployeeUiExtras,
  saveEmployeeFormDraft,
  saveEmployeeUiExtras,
  type EmployeeUiExtras,
  type StoredLicense,
} from '@/components/employees/form/localExtras';
import { ConfirmOnboardingSendDialog } from '@/components/employees/ConfirmOnboardingSendDialog';
import {
  applyDraftFiles,
  clearDraftFiles,
  collectDraftFiles,
  loadDraftFiles,
  saveDraftFiles,
  PROFILE_PHOTO_SLOT,
} from '@/components/employees/form/draftFiles';
import {
  EmployeeFormHeader,
  type EmployeeFormActionProps,
} from '@/components/employees/form/EmployeeFormHeader';
import {
  AddressCard,
  ContactInfoCard,
  EmergencyContactCard,
  PersonalInfoCard,
  ProfilePhotoCard,
  formatCanadianPostalCode,
} from '@/components/employees/form/ProfileSections';
import {
  EducationCard,
  SkillsCard,
  WorkExperienceCard,
} from '@/components/employees/form/BackgroundSections';
import {
  AvailabilityCard,
  ClientAssignmentCard,
  type ClientOption,
} from '@/components/employees/form/PreferencesSections';
import { SalaryCard } from '@/components/employees/form/SalarySection';
import {
  LicensesCard,
  PhotoIdCard,
  SinCard,
  WorkStatusCard,
} from '@/components/employees/form/DocumentsPanel';
import { DocumentStatusCard } from '@/components/employees/form/DocumentStatusCard';
import { AgreementStatusCard } from '@/components/employees/form/AgreementStatusCard';
import { AgreementSaveHintCard } from '@/components/employees/form/AgreementSaveHintCard';
import { TrainingCertificatesCard } from '@/components/employees/form/TrainingCertificatesCard';
import { syncLicensesForSkills } from '@/components/employees/form/licenseSync';
import {
  requiredLicensesForSkills,
  skillsRequireForkliftLicenses,
} from '@/components/employees/form/skillLicenseMap';
import { scrollToFirstError, validateEmployeeForm } from '@/components/employees/form/validation';
import { EmployeePdfPreviewDialog } from '@/components/employees/EmployeePdfPreviewDialog';
import type { ExistingDocRef } from '@/components/employees/form/formTypes';

const NO_EXPERIENCE_PLACEHOLDER = 'N/A';

function licensesNotNeededForSkills(skills: string[]): boolean {
  return requiredLicensesForSkills(skills).length === 0 && !skillsRequireForkliftLicenses(skills);
}

function parseYear(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

const toDateInput = (value?: string | null) => (value ? value.slice(0, 10) : '');

// ── Server → form mapping ──────────────────────────────────────────────────

function latestDocOfType(docs: EmployeeDocument[], type: string): EmployeeDocument | undefined {
  return docs
    .filter((d) => d.type === type)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())[0];
}

const toDocRef = (doc?: EmployeeDocument | null) =>
  doc
    ? { id: doc.id, name: doc.name, fileName: doc.fileName, fileSize: doc.fileSize }
    : null;

const LICENSE_DOC_PREFIX = 'license — ';

/** Rebuild license rows from uploaded docs when extras.licenses is empty. */
function licensesFromDocs(docs: EmployeeDocument[]): StoredLicense[] {
  const byType = new Map<string, StoredLicense & { uploadedAt: number }>();
  for (const d of docs) {
    const name = d.name ?? '';
    if (!name.toLowerCase().startsWith(LICENSE_DOC_PREFIX)) continue;
    const rest = name.slice(LICENSE_DOC_PREFIX.length);
    const licenseType = (rest.split(' — ')[0] ?? rest).trim();
    if (!licenseType) continue;
    const uploadedAt = new Date(d.uploadedAt).getTime();
    const prev = byType.get(licenseType);
    if (prev && prev.uploadedAt >= uploadedAt) continue;
    byType.set(licenseType, {
      licenseType,
      expiryDate: toDateInput(d.expiryDate),
      docId: d.id,
      uploadedAt,
    });
  }
  return [...byType.values()].map(({ licenseType, expiryDate, docId }) => ({
    licenseType,
    expiryDate,
    docId,
  }));
}

function employeeToForm(employee: Employee, extras: EmployeeUiExtras): EmployeeFormState {
  const base = emptyEmployeeFormState();
  const docs = employee.documents ?? [];

  const serverExps = [...(employee.workExperiences ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((e) => e.companyName.trim() !== NO_EXPERIENCE_PLACEHOLDER);
  const workExperiences = [
    ...serverExps.map((e) => ({
      uid: newUid(),
      companyName: e.companyName,
      contactNumber: e.contactNumber ?? '',
      position: e.position ?? '',
      duration: e.duration ?? '',
    })),
    ...extras.extraExperiences.map((e) => ({ ...e, uid: newUid() })),
  ];

  const education = [
    {
      ...emptyEducationEntry(),
      level: employee.educationLevel ?? '',
      fromYear: employee.educationFromYear != null ? String(employee.educationFromYear) : '',
      endYear: employee.educationEndYear != null ? String(employee.educationEndYear) : '',
      graduated: (employee.graduated == null ? '' : employee.graduated ? 'yes' : 'no') as '' | 'yes' | 'no',
      courseStudied: employee.courseStudied ?? '',
      diplomaName: employee.diplomaName ?? '',
    },
    ...extras.extraEducation.map((e) => ({ ...e, uid: newUid() })),
  ];

  const licenseSource =
    extras.licenses.length > 0 ? extras.licenses : licensesFromDocs(docs);
  const licenseEntries = licenseSource.map((l) => {
    const linked = l.docId ? docs.find((d) => d.id === l.docId) : undefined;
    const fallbackLinked =
      linked ??
      docs.find((d) => {
        const prefix = `${LICENSE_DOC_PREFIX}${l.licenseType}`.toLowerCase();
        const name = d.name.toLowerCase();
        return name === prefix || name.startsWith(`${prefix} — `);
      });
    return {
      ...emptyLicenseEntry(),
      licenseType: l.licenseType,
      expiryDate: toDateInput(fallbackLinked?.expiryDate) || l.expiryDate,
      existingDoc: toDocRef(fallbackLinked),
    };
  });

  const skills =
    (employee.skills && employee.skills.length > 0 ? employee.skills : extras.skills) ?? [];

  const availabilityTypes: AvailabilityType[] =
    employee.availabilityTypes && employee.availabilityTypes.length > 0
      ? employee.availabilityTypes
      : [];

  const emergency =
    employee.emergencyContact ??
    (employee.emergencyContactName
      ? { name: employee.emergencyContactName, phone: employee.emergencyContactPhone ?? '' }
      : null);

  const photoIdDoc = latestDocOfType(docs, 'photo_id');
  const statusDoc = latestDocOfType(docs, 'proof_of_status');
  const sinDoc = latestDocOfType(docs, 'sin');

  return {
    ...base,
    employeeType: 'external',
    workStatus: employee.workStatus ?? 'none',
    firstName: employee.firstName ?? '',
    lastName: employee.lastName ?? '',
    gender: employee.gender ?? '',
    dateOfBirth: toDateInput(employee.dateOfBirth),
    email: employee.email ?? '',
    phone: employee.phone ?? '',
    address: employee.address ?? '',
    addressLine2: employee.addressLine2 ?? '',
    city: employee.city ?? '',
    province: employee.province ?? '',
    postalCode: employee.postalCode ? formatCanadianPostalCode(employee.postalCode) : '',
    emergencyContactName: emergency?.name ?? '',
    emergencyContactPhone: emergency?.phone ?? '',
    education,
    noWorkExperience: extras.noWorkExperience,
    workExperiences: workExperiences.length > 0 ? workExperiences : [emptyExperienceEntry()],
    experienceDuties:
      employee.experienceDuties === 'No prior work experience.' && extras.noWorkExperience
        ? ''
        : employee.experienceDuties ?? '',
    skills,
    availableFrom: toDateInput(employee.availableFrom),
    availabilityTypes,
    shiftsAvailable: employee.shiftsAvailable ?? [],
    ableTwelveHourShift:
      employee.ableTwelveHourShift == null ? '' : employee.ableTwelveHourShift ? 'yes' : 'no',
    englishProficiency: employee.englishProficiency ?? [],
    residencyStatus: employee.residencyStatus ?? '',
    hourlyRate: employee.hourlyRate != null ? String(employee.hourlyRate) : '',
    salaryPaymentMethod: employee.salaryPaymentMethod ?? '',
    bankName: employee.bankName ?? '',
    bankInstitutionNumber: employee.bankInstitutionNumber ?? '',
    bankTransitNumber: employee.bankTransitNumber ?? '',
    bankAccountNumber: employee.bankAccountNumber ?? '',
    depositDoc: {
      file: null,
      existingDoc: toDocRef(latestDocOfType(docs, 'bank_deposit')),
      expiryDate: '',
    },
    assignedClientId:
      employee.assignedClientId || employee.activeClientId || extras.assignedClientId || '',
    assignedClientName:
      employee.assignedClientName || employee.activeClientName || extras.assignedClientName || '',
    photoIdType: (extras.photoIdType as PhotoIdTypeKey) || '',
    photoIdNumber: extras.photoIdNumber || '',
    photoId: {
      file: null,
      existingDoc: toDocRef(photoIdDoc),
      expiryDate: toDateInput(photoIdDoc?.expiryDate) || extras.photoIdExpiry,
    },
    statusDoc: {
      file: null,
      existingDoc: toDocRef(statusDoc),
      expiryDate: toDateInput(statusDoc?.expiryDate) || extras.statusDocExpiry,
    },
    sinNumber: '',
    sinDoc: {
      file: null,
      existingDoc: toDocRef(sinDoc),
      expiryDate: toDateInput(sinDoc?.expiryDate) || extras.sinDocExpiry,
    },
    agreementDoc: {
      file: null,
      existingDoc: toDocRef(latestDocOfType(docs, 'agreement')),
      expiryDate: '',
    },
    licensesNotApplicable: licensesNotNeededForSkills(skills),
    licenses: syncLicensesForSkills(licenseEntries, skills),
  };
}

// ── Form → API payload ─────────────────────────────────────────────────────

function buildPayload(form: EmployeeFormState) {
  const edu = form.education[0]!;
  const naExperience = (sortOrder: number) => ({
    companyName: NO_EXPERIENCE_PLACEHOLDER,
    contactNumber: null,
    position: null,
    duration: null,
    sortOrder,
  });
  // Backend contract: exactly two work-experience slots. Extra entries are
  // kept locally (see localExtras) until Phase 2 adds real columns.
  const backendExperiences = form.noWorkExperience
    ? [naExperience(1), naExperience(2)]
    : [0, 1].map((i) => {
        const entry = form.workExperiences[i];
        if (!entry || !entry.companyName.trim()) return naExperience(i + 1);
        return {
          companyName: entry.companyName.trim(),
          contactNumber: entry.contactNumber.trim() || null,
          position: entry.position.trim() || null,
          duration: entry.duration.trim() || null,
          sortOrder: i + 1,
        };
      });

  return {
    employeeType: 'external' as const,
    // workStatus is managed via employee details / assignment flows — not the form
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    gender: form.gender as Gender,
    dateOfBirth: form.dateOfBirth || null,
    address: form.address.trim(),
    addressLine2: form.addressLine2.trim() || null,
    city: form.city.trim(),
    province: form.province,
    postalCode: formatCanadianPostalCode(form.postalCode),
    country: 'Canada',
    emergencyContactName: form.emergencyContactName.trim(),
    emergencyContactPhone: form.emergencyContactPhone.trim(),
    educationLevel: edu.level.trim(),
    educationFromYear: parseYear(edu.fromYear),
    educationEndYear: parseYear(edu.endYear),
    graduated: edu.graduated === 'yes',
    courseStudied: edu.courseStudied.trim() || null,
    diplomaName: edu.diplomaName.trim() || null,
    experienceDuties: form.noWorkExperience
      ? form.experienceDuties.trim() || 'No prior work experience.'
      : form.experienceDuties.trim(),
    availableFrom: form.availableFrom,
    availabilityTypes: form.availabilityTypes,
    skills: form.skills,
    residencyStatus: form.residencyStatus as ResidencyStatus,
    shiftsAvailable: form.shiftsAvailable,
    ableTwelveHourShift: form.ableTwelveHourShift === 'yes',
    englishProficiency: form.englishProficiency,
    workExperiences: backendExperiences,
    hourlyRate: form.hourlyRate.trim() ? Number(form.hourlyRate) : null,
    salaryPaymentMethod: (form.salaryPaymentMethod || null) as SalaryPaymentMethod | null,
    bankName: form.salaryPaymentMethod === 'deposit' ? form.bankName.trim() || null : null,
    bankInstitutionNumber:
      form.salaryPaymentMethod === 'deposit' ? form.bankInstitutionNumber.trim() || null : null,
    bankTransitNumber:
      form.salaryPaymentMethod === 'deposit' ? form.bankTransitNumber.trim() || null : null,
    bankAccountNumber:
      form.salaryPaymentMethod === 'deposit' ? form.bankAccountNumber.trim() || null : null,
  };
}

function buildExtras(
  form: EmployeeFormState,
  licenseDocIds: Map<string, string | null>,
  profilePhotoDocId: string | null,
): EmployeeUiExtras {
  const stripUid = <T extends { uid: string }>({ uid: _uid, ...rest }: T) => rest;
  return {
    skills: form.skills,
    noWorkExperience: form.noWorkExperience,
    extraEducation: form.education.slice(1).map(stripUid),
    extraExperiences: form.noWorkExperience ? [] : form.workExperiences.slice(2).map(stripUid),
    assignedClientId: form.assignedClientId,
    assignedClientName: form.assignedClientName,
    photoIdType: form.photoIdType,
    photoIdNumber: form.photoIdNumber,
    photoIdExpiry: form.photoId.expiryDate,
    statusDocExpiry: form.statusDoc.expiryDate,
    sinDocExpiry: form.sinDoc.expiryDate,
    licensesNotApplicable: licensesNotNeededForSkills(form.skills),
    licenses: form.licenses
      .filter((l) => l.licenseType || l.file || l.existingDoc)
      .map((l) => ({
        licenseType: l.licenseType,
        expiryDate: l.expiryDate,
        docId: licenseDocIds.get(l.uid) ?? l.existingDoc?.id ?? null,
      })),
    profilePhotoDocId,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.includes(',') ? result.split(',')[1]! : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadDoc(
  employeeId: string,
  file: File,
  type: string,
  namePrefix?: string,
  expiryDate?: string,
) {
  const fileBase64 = await fileToBase64(file);
  return uploadEmployeeDocument(employeeId, {
    name: namePrefix ? `${namePrefix} — ${file.name}` : file.name,
    fileBase64,
    mimeType: file.type || undefined,
    type,
    expiryDate: expiryDate || null,
  });
}

async function syncDocExpiry(
  employeeId: string,
  existingDocId: string | undefined,
  expiryDate: string,
  previousExpiry?: string | null,
) {
  if (!existingDocId) return;
  const next = expiryDate || null;
  const prev = previousExpiry ? previousExpiry.slice(0, 10) : null;
  if (next === prev) return;
  // Never clear a stored expiry when the form slot is blank.
  if (!next && prev) return;
  await updateEmployeeDocumentExpiry(employeeId, existingDocId, next);
}

const PROFILE_PHOTO_PREFIX = 'profile-photo';

// ── Page ───────────────────────────────────────────────────────────────────

export default function EmployeeForm() {
  return <LiveEmployeeForm />;
}

function LiveEmployeeForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const canWriteEmployees = useHasPermission('employees:write');
  const canApproveEmployees = useHasPermission('employees:approve');
  const { agencyId, agencyName } = useRecruitmentAgencyId();

  const [form, setForm] = useState<EmployeeFormState>(emptyEmployeeFormState);
  const [errors, setErrors] = useState<FormErrors>({});
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const [loading, setLoading] = useState(isEdit);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const existingPhotoDocIdRef = useRef<string | null>(null);
  const removedPhotoDocIdRef = useRef<string | null>(null);
  const objectUrlsRef = useRef<string[]>([]);
  const [previewDoc, setPreviewDoc] = useState<ExistingDocRef | null>(null);

  const trackObjectUrl = (url: string) => {
    objectUrlsRef.current.push(url);
    return url;
  };

  useEffect(
    () => () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );

  const setField = useCallback(
    <K extends keyof EmployeeFormState>(key: K, value: EmployeeFormState[K]) => {
      setForm((prev) => {
        if (key === 'skills') {
          const skills = value as string[];
          const licenses = syncLicensesForSkills(prev.licenses, skills);
          return {
            ...prev,
            skills,
            licenses,
            licensesNotApplicable: licensesNotNeededForSkills(skills),
          };
        }
        if (key === 'licenses') {
          return {
            ...prev,
            licenses: value as EmployeeFormState['licenses'],
            licensesNotApplicable: licensesNotNeededForSkills(prev.skills),
          };
        }
        return { ...prev, [key]: value };
      });
      setErrors((prev) => {
        const related = Object.keys(prev).filter(
          (k) =>
            k === key ||
            k.startsWith(`${String(key) === 'workExperiences' ? 'work' : key}.`) ||
            (key === 'skills' && k.startsWith('licenses.')) ||
            (key === 'licenses' && k.startsWith('licenses.')),
        );
        if (related.length === 0) return prev;
        const next = { ...prev };
        related.forEach((k) => delete next[k]);
        return next;
      });
    },
    [],
  );

  // Permission gate
  useEffect(() => {
    if (!canWriteEmployees) {
      toast({
        title: 'Permission denied',
        description: 'You do not have permission to manage employees',
        variant: 'destructive',
      });
      navigate('/employees', { replace: true });
    }
  }, [canWriteEmployees, navigate]);

  // Active Clients for assignment dropdown (active only, agency-scoped)
  useEffect(() => {
    let cancelled = false;
    fetchActiveClients({
      pageSize: 200,
      status: 'active',
      agencyIds: agencyId ? [agencyId] : undefined,
    })
      .then((res) => {
        if (!cancelled) {
          setClients(
            res.data
              .map((c) => ({ id: c.id, name: c.name }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingClients(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agencyId]);

  // Keep current assignment visible even if that client is no longer active
  const clientsForSelect = useMemo(() => {
    const id = form.assignedClientId;
    if (!id || clients.some((c) => c.id === id)) return clients;
    const name = form.assignedClientName.trim() || 'Current assignment';
    return [...clients, { id, name }].sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, form.assignedClientId, form.assignedClientName]);

  // Load employee (edit) or restore local draft (new)
  useEffect(() => {
    let cancelled = false;
    if (!isEdit || !id) {
      const draft = loadEmployeeFormDraft();
      if (draft) {
        setForm(applyFormSnapshot(draft));
        void loadDraftFiles().then((files) => {
          if (cancelled || Object.keys(files).length === 0) return;
          setForm((prev) => applyDraftFiles(prev, files));
          const photo = files[PROFILE_PHOTO_SLOT];
          if (photo) {
            setPhotoFile(photo);
            setPhotoUrl(trackObjectUrl(URL.createObjectURL(photo)));
          }
        });
        toast({ title: 'Draft restored', description: 'Your locally saved draft was loaded.' });
      }
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    fetchEmployee(id)
      .then(async (emp) => {
        if (cancelled) return;
        setEmployee(emp);
        // Edit drafts can wipe server fields — discard and always hydrate from API.
        clearEmployeeFormDraft(id);
        void clearDraftFiles(id);
        const extras = mergeEmployeeUiExtras(emp.uiExtras, loadEmployeeUiExtras(id));
        setForm(employeeToForm(emp, extras));
        removedPhotoDocIdRef.current = null;

        const docs = emp.documents ?? [];
        const photoDoc =
          (extras.profilePhotoDocId && docs.find((d) => d.id === extras.profilePhotoDocId)) ||
          docs.find((d) => d.type === 'other' && d.name.startsWith(PROFILE_PHOTO_PREFIX));
        if (photoDoc) {
          existingPhotoDocIdRef.current = photoDoc.id;
          try {
            const res = await fetch(getEmployeeDocumentDownloadUrl(emp.id, photoDoc.id), {
              headers: getAuthHeaders() as HeadersInit,
              credentials: 'include',
            });
            if (res.ok && !cancelled) {
              setPhotoUrl(trackObjectUrl(URL.createObjectURL(await res.blob())));
            }
          } catch {
            /* photo preview is non-critical */
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: 'Failed to load employee',
            description: err instanceof Error ? err.message : 'Could not load employee',
            variant: 'destructive',
          });
          navigate('/employees', { replace: true });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, isEdit, navigate]);

  const handlePhotoSelected = (file: File) => {
    setPhotoFile(file);
    setPhotoUrl(trackObjectUrl(URL.createObjectURL(file)));
  };

  const handleRemovePhoto = () => {
    if (existingPhotoDocIdRef.current) {
      removedPhotoDocIdRef.current = existingPhotoDocIdRef.current;
    }
    setPhotoFile(null);
    setPhotoUrl(null);
    existingPhotoDocIdRef.current = null;
  };

  const handleSaveDraft = async () => {
    // Drafts are for new employees only (edit discards drafts on open).
    if (isEdit) return;
    saveEmployeeFormDraft(serializeFormSnapshot(form));
    const filesSaved = await saveDraftFiles(undefined, collectDraftFiles(form, photoFile));
    toast({
      title: 'Draft saved',
      description: filesSaved
        ? 'Saved on this device only (including documents). Use Save & Send Agreement to create on the server, send agreement + training emails, and move to Pending. SIN is not stored in the draft.'
        : 'Saved on this device, but documents could not be stored — re-attach them before saving to the server. SIN is not included.',
    });
  };

  const handleApprove = async () => {
    if (!isEdit || !id) return;
    setSubmitting(true);
    try {
      let updated: Employee;
      if (employee?.submitterRole) {
        await postApprovalAction('employee_add', id, 'approve', {
          subCompanyId: employee.addedBySubCompanyId ?? undefined,
        });
        updated = await fetchEmployee(id);
      } else {
        updated = await approveEmployee(id);
      }
      setEmployee(updated);
      toast({
        title: 'Employee approved',
        description: 'Employee is now in Master. Link a client from the details panel to place them.',
      });
    } catch (err) {
      toast({
        title: 'Cannot approve to Master',
        description: err instanceof Error ? err.message : 'Could not approve employee',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitForApproval = async () => {
    if (!isEdit || !id) return;
    setSubmitting(true);
    try {
      const updated = await submitEmployeeForApproval(id);
      setEmployee(updated);
      if (updated.approvalStatus === 'approved') {
        toast({
          title: 'Employee approved',
          description: 'Submitted and finalized. Employee is now in Master.',
        });
      } else {
        toast({
          title: 'Submitted for approval',
          description: 'Recruitment Manager will review this registration.',
        });
      }
    } catch (err) {
      toast({
        title: 'Cannot submit for approval',
        description: err instanceof Error ? err.message : 'Upload required documents first',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Only brand-new creates send agreement + training. Edits never re-prompt or re-send.
  const willEnterPending = !isEdit;

  /** Persist + optional onboarding send. Pass confirmedEmail after the confirm dialog. */
  const performSubmit = async (confirmedEmail?: string) => {
    const formForSave =
      confirmedEmail !== undefined ? { ...form, email: confirmedEmail.trim() } : form;

    setSubmitting(true);
    try {
      const initialExtras = buildExtras(formForSave, new Map(), existingPhotoDocIdRef.current);
      const payload = {
        ...buildPayload(formForSave),
        ...(!isEdit && agencyId ? { addedBySubCompanyId: agencyId } : {}),
        ...(!isEdit ? { uiExtras: initialExtras } : {}),
      };
      let employeeId = id;
      if (isEdit && id) {
        await updateEmployee(id, payload);
      } else {
        if (!agencyId) {
          toast({
            title: 'Select an agency',
            description: 'Choose an agency before creating an employee.',
            variant: 'destructive',
          });
          setSubmitting(false);
          return;
        }
        employeeId = (await createEmployee(payload)).id;
      }

      // Upload any newly selected documents (each independently; report failures)
      const licenseDocIds = new Map<string, string | null>();
      let profilePhotoDocId = existingPhotoDocIdRef.current;
      const failedUploads: string[] = [];
      const tryUpload = async (label: string, fn: () => Promise<void>) => {
        try {
          await fn();
        } catch {
          failedUploads.push(label);
        }
      };

      if (employeeId) {
        if (formForSave.photoId.file) {
          await tryUpload('Photo ID', async () => {
            await uploadDoc(
              employeeId!,
              formForSave.photoId.file!,
              'photo_id',
              undefined,
              formForSave.photoId.expiryDate,
            );
          });
        } else if (formForSave.photoId.existingDoc) {
          await tryUpload('Photo ID expiry', async () => {
            await syncDocExpiry(
              employeeId!,
              formForSave.photoId.existingDoc!.id,
              formForSave.photoId.expiryDate,
              employee?.documents?.find((d) => d.id === formForSave.photoId.existingDoc!.id)
                ?.expiryDate,
            );
          });
        }
        if (formForSave.statusDoc.file) {
          await tryUpload('Status document', async () => {
            await uploadDoc(
              employeeId!,
              formForSave.statusDoc.file!,
              'proof_of_status',
              undefined,
              formForSave.statusDoc.expiryDate,
            );
          });
        } else if (formForSave.statusDoc.existingDoc) {
          await tryUpload('Status document expiry', async () => {
            await syncDocExpiry(
              employeeId!,
              formForSave.statusDoc.existingDoc!.id,
              formForSave.statusDoc.expiryDate,
              employee?.documents?.find((d) => d.id === formForSave.statusDoc.existingDoc!.id)
                ?.expiryDate,
            );
          });
        }
        if (formForSave.sinDoc.file) {
          await tryUpload('SIN document', async () => {
            await uploadDoc(
              employeeId!,
              formForSave.sinDoc.file!,
              'sin',
              undefined,
              formForSave.sinDoc.expiryDate,
            );
          });
        } else if (formForSave.sinDoc.existingDoc) {
          await tryUpload('SIN document expiry', async () => {
            await syncDocExpiry(
              employeeId!,
              formForSave.sinDoc.existingDoc!.id,
              formForSave.sinDoc.expiryDate,
              employee?.documents?.find((d) => d.id === formForSave.sinDoc.existingDoc!.id)
                ?.expiryDate,
            );
          });
        }
        if (formForSave.salaryPaymentMethod === 'deposit' && formForSave.depositDoc.file) {
          await tryUpload('Deposit attachment', async () => {
            await uploadDoc(employeeId!, formForSave.depositDoc.file!, 'bank_deposit', 'deposit');
          });
        }
        if (formForSave.licenses.length > 0) {
          for (const license of formForSave.licenses) {
            if (license.file) {
              await tryUpload(license.licenseType || 'License', async () => {
                const doc = await uploadDoc(
                  employeeId!,
                  license.file!,
                  'other',
                  `license — ${license.licenseType || 'License'}`,
                  license.expiryDate,
                );
                licenseDocIds.set(license.uid, doc.id);
              });
            } else if (license.existingDoc) {
              await tryUpload(`${license.licenseType || 'License'} expiry`, async () => {
                await syncDocExpiry(
                  employeeId!,
                  license.existingDoc!.id,
                  license.expiryDate,
                  employee?.documents?.find((d) => d.id === license.existingDoc!.id)?.expiryDate,
                );
              });
            }
          }
        }
        if (photoFile) {
          await tryUpload('Profile photo', async () => {
            const doc = await uploadDoc(employeeId!, photoFile, 'other', PROFILE_PHOTO_PREFIX);
            profilePhotoDocId = doc.id;
            removedPhotoDocIdRef.current = null;
          });
        } else if (removedPhotoDocIdRef.current) {
          const toDelete = removedPhotoDocIdRef.current;
          await tryUpload('Profile photo remove', async () => {
            await deleteEmployeeDocument(employeeId!, toDelete);
          });
          profilePhotoDocId = null;
          removedPhotoDocIdRef.current = null;
        }

        const finalExtras = buildExtras(formForSave, licenseDocIds, profilePhotoDocId);
        try {
          await updateEmployee(employeeId, { uiExtras: finalExtras });
        } catch {
          failedUploads.push('Form extras');
        }
        saveEmployeeUiExtras(employeeId, finalExtras);
      }
      clearEmployeeFormDraft(isEdit ? id : undefined);
      void clearDraftFiles(isEdit ? id : undefined);

      // Create only: send agreement + training and move to Pending. Edits never re-send.
      const shouldEnterPending = !!employeeId && !isEdit;

      let agreementSent = false;
      let agreementSendError: string | null = null;
      let trainingEmailed = false;
      let trainingError: string | null = null;
      let submittedToPending = false;
      let movedToMaster = false;
      let submitError: string | null = null;

      const sendEmail = formForSave.email.trim();

      if (shouldEnterPending && employeeId) {
        if (sendEmail) {
          try {
            const onboarding = await sendEmployeeOnboarding(employeeId);
            agreementSent = true;
            trainingEmailed = Boolean(onboarding.trainingEmailed);
            if (!trainingEmailed) {
              trainingError =
                onboarding.trainingError?.trim() || 'Training email was not sent';
            }
          } catch (err) {
            agreementSendError =
              err instanceof Error ? err.message : 'Could not send onboarding agreement';
          }
        } else {
          agreementSendError = 'No email on file — agreement was not sent.';
        }

        try {
          const submitted = await submitEmployeeForApproval(employeeId);
          submittedToPending = true;
          movedToMaster = submitted.approvalStatus === 'approved';
        } catch (err) {
          submitError =
            err instanceof Error ? err.message : 'Could not submit for manager approval';
        }
      }

      let agreementNote = '';
      if (agreementSent && trainingEmailed) {
        agreementNote = ` Agreement and training emails sent to ${sendEmail}.`;
      } else if (agreementSent && trainingError) {
        agreementNote = ` Agreement sent to ${sendEmail}, but training email failed: ${trainingError}`;
      } else if (agreementSent) {
        agreementNote = ` Agreement sent to ${sendEmail}.`;
      } else if (agreementSendError) {
        agreementNote = ` ${agreementSendError}`;
      }

      const emailPartialFailure = Boolean(agreementSent && trainingError);
      const agreementFailed = Boolean(agreementSendError);

      if (failedUploads.length > 0) {
        toast({
          title: isEdit ? 'Employee updated' : 'Moved to Pending',
          description: `Saved, but these uploads failed: ${failedUploads.join(', ')}. You can upload them later.${agreementNote}`,
          variant: 'destructive',
        });
      } else if (shouldEnterPending) {
        if (movedToMaster) {
          toast({
            title: agreementFailed
              ? 'Saved — onboarding agreement not sent'
              : 'Employee saved',
            description: `Approved immediately (policy bypass). Employee is in Master.${agreementNote}`,
            variant: agreementFailed || emailPartialFailure ? 'destructive' : undefined,
          });
        } else if (submittedToPending) {
          toast({
            title: agreementFailed
              ? 'Moved to Pending — agreement not sent'
              : emailPartialFailure
                ? 'Moved to Pending — training email failed'
                : 'Moved to Pending',
            description: agreementFailed
              ? `${agreementSendError}${trainingEmailed ? ` Training email was still sent to ${sendEmail}.` : trainingError ? ` Training: ${trainingError}` : ''} Resend the agreement from the employee page after fixing PandaDoc.`
              : `Awaiting agreement signature, training certificates, and manager approval.${agreementNote}`,
            variant: agreementFailed || emailPartialFailure ? 'destructive' : undefined,
          });
        } else {
          toast({
            title: isEdit ? 'Employee updated' : 'Saved',
            description: `Saved, but not yet in Pending.${submitError ? ` ${submitError}` : ''}${agreementNote}`,
            variant: 'destructive',
          });
        }
      } else {
        toast({
          title: isEdit ? 'Employee updated' : 'Employee saved',
          description: isEdit ? 'Changes have been saved.' : 'Employee saved.',
        });
      }
      setConfirmSendOpen(false);
      // Stay on the employee edit page when agreement failed so staff can resend; otherwise go to list.
      if (shouldEnterPending && submittedToPending && !agreementFailed && employeeId) {
        navigate('/employees?tab=pending');
      } else if (shouldEnterPending && agreementFailed && employeeId) {
        navigate(`/employees/${employeeId}/edit`);
      } else {
        navigate('/employees');
      }
    } catch (err) {
      toast({
        title: isEdit ? 'Failed to update' : 'Failed to submit',
        description: err instanceof Error ? err.message : 'Could not save employee',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    const nextErrors = validateEmployeeForm(form);
    setErrors(nextErrors);
    if (!canWriteEmployees || Object.keys(nextErrors).length > 0) {
      toast({
        title: 'Please fix the highlighted fields',
        description: 'Complete all required fields with valid values before submitting.',
        variant: 'destructive',
      });
      scrollToFirstError(nextErrors);
      return;
    }

    if (willEnterPending) {
      setConfirmSendOpen(true);
      return;
    }
    void performSubmit();
  };

  const handleConfirmOnboardingSend = async (email: string) => {
    setForm((prev) => ({ ...prev, email }));
    await performSubmit(email);
  };

  if (!canWriteEmployees) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const displayName = `${form.firstName} ${form.lastName}`.trim();
  const initials = [form.firstName, form.lastName]
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  // Rejected / never-submitted edits: resubmit only (Save Changes does not re-send agreement).
  const canSubmitForApproval =
    isEdit &&
    !!employee &&
    (employee.approvalStatus === 'rejected' ||
      (employee.approvalStatus === 'pending' && !employee.submitterRole));

  // Pending (submitted) → RM Approve → Master
  const canApprove =
    isEdit &&
    !!employee &&
    employee.approvalStatus === 'pending' &&
    !!employee.submitterRole &&
    canApproveEmployees;

  const actionProps: EmployeeFormActionProps = {
    submitting,
    isEdit,
    canApprove,
    canSubmitForApproval,
    onSaveDraft: () => void handleSaveDraft(),
    onSubmit: handleSubmit,
    onApprove: handleApprove,
    onSubmitForApproval: () => void handleSubmitForApproval(),
  };

  const sectionProps = {
    form,
    errors,
    setField,
    employeeId: isEdit ? id : undefined,
    onPreviewDoc: isEdit && id ? (doc: ExistingDocRef) => setPreviewDoc(doc) : undefined,
  };

  return (
    <div className="pb-6">
      <ConfirmOnboardingSendDialog
        open={confirmSendOpen}
        onOpenChange={(open) => {
          if (!submitting) setConfirmSendOpen(open);
        }}
        defaultEmail={form.email}
        mode="onboarding"
        confirmLabel="Confirm & send"
        confirming={submitting}
        onConfirm={handleConfirmOnboardingSend}
        agencyName={agencyName}
        previewEmployee={{
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          gender: form.gender || null,
          address: form.address,
          addressLine2: form.addressLine2,
          city: form.city,
          province: form.province,
          postalCode: form.postalCode,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: form.emergencyContactPhone,
          residencyStatus: form.residencyStatus || null,
        }}
      />
      <EmployeeFormHeader
        photoUrl={photoUrl}
        displayName={displayName}
        approvalStatus={employee?.approvalStatus ?? null}
        agencyName={agencyName}
        assignedClientName={employee?.activeClientName || form.assignedClientName}
        isEdit={isEdit}
        onBack={() => navigate('/employees')}
        actions={actionProps}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)] gap-6 items-start pt-6">
        {/* ── Left panel ── */}
        <div className="space-y-6 min-w-0">
          <ProfilePhotoCard
            photoUrl={photoUrl}
            initials={initials}
            onPhotoSelected={handlePhotoSelected}
            onRemovePhoto={handleRemovePhoto}
          />
          <PersonalInfoCard {...sectionProps} />
          <ContactInfoCard {...sectionProps} />
          <AddressCard {...sectionProps} />
          <EmergencyContactCard {...sectionProps} />
          <EducationCard {...sectionProps} />
          <WorkExperienceCard {...sectionProps} />
          <SkillsCard {...sectionProps} />
          <AvailabilityCard {...sectionProps} />
          <SalaryCard {...sectionProps} />
          {employee?.approvalStatus === 'approved' && employee.workStatus === 'active' ? (
            <ClientAssignmentCard
              form={form}
              setField={setField}
              clients={clientsForSelect}
              loadingClients={loadingClients}
            />
          ) : (
            <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Client assignment is available after the employee is approved (Master). Use the employee
              details panel to send a placement request to Recruitment Manager.
            </div>
          )}
                  </div>

        {/* ── Right panel: documents ── */}
        <div className="space-y-6 min-w-0">
          <DocumentStatusCard form={form} />
          {isEdit && id ? (
            <AgreementStatusCard
              employeeId={id}
              employeeEmail={form.email}
              onEmailUpdated={(email) => setField('email', email)}
              previewEmployee={{
                firstName: form.firstName,
                lastName: form.lastName,
                email: form.email,
                phone: form.phone,
                gender: form.gender || null,
                address: form.address,
                addressLine2: form.addressLine2,
                city: form.city,
                province: form.province,
                postalCode: form.postalCode,
                emergencyContactName: form.emergencyContactName,
                emergencyContactPhone: form.emergencyContactPhone,
                residencyStatus: form.residencyStatus || null,
              }}
              includeDemoSignature={
                employee?.approvalStatus === 'approved' &&
                !employee.activeClientId &&
                !employee.activeAssignmentId
              }
            />
          ) : (
            <AgreementSaveHintCard email={form.email} />
          )}
          <PhotoIdCard {...sectionProps} />
          <WorkStatusCard {...sectionProps} />
          <SinCard {...sectionProps} />
          <LicensesCard {...sectionProps} />
          {isEdit && employee ? (
            <TrainingCertificatesCard
              employee={
                form.email !== (employee.email ?? '')
                  ? { ...employee, email: form.email || null }
                  : employee
              }
              onChanged={() => {
                if (!id) return;
                void fetchEmployee(id).then((emp) => {
                  setEmployee(emp);
                  if (emp.email) setField('email', emp.email);
                });
              }}
            />
          ) : null}
        </div>
      </div>

      {isEdit && id ? (
        <EmployeePdfPreviewDialog
          open={Boolean(previewDoc)}
          onOpenChange={(next) => {
            if (!next) setPreviewDoc(null);
          }}
          employeeId={id}
          docId={previewDoc?.id ?? null}
          fileName={previewDoc?.fileName || previewDoc?.name}
          mimeType={
            employee?.documents?.find((d) => d.id === previewDoc?.id)?.mimeType ?? undefined
          }
          title={previewDoc?.name || 'Document'}
          badge={null}
        />
      ) : null}
    </div>
  );
}
