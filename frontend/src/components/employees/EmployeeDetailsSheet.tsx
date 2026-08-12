/**
 * Employee detail sheet — compact fixed chrome + tabbed body (matches JobDetailsSheet).
 */
import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Mail,
  Phone,
  MapPin,
  Briefcase,
  FileText,
  Check,
  X,
  GraduationCap,
  Calendar,
  Banknote,
  Pencil,
  Plus,
  Building2,
  Users,
  Send,
  Ban,
  Image as ImageIcon,
  Eye,
} from 'lucide-react';
import { EndPlacementDialog, type EndPlacementTarget } from './EndPlacementDialog';
import { EmploymentHistoryPanel } from './EmploymentHistoryPanel';
import { format } from 'date-fns';
import { Employee, EmployeeTag, type EmployeeDocument } from '@/lib/employeeTypes';
import { useHasPermission } from '@/lib/access';
import { EmployeeStatusBadge } from './EmployeeStatusBadge';
import { EmployeePendingReadinessBadges } from './EmployeePendingReadinessBadges';
import { toast } from '@/hooks/use-toast';
import {
  approveEmployee,
  rejectEmployee,
  updateEmployee,
  addEmployeeNote,
  submitEmployeeForApproval,
  postApprovalAction,
  fetchEmployee,
  fetchEmployeeAssignments,
} from '@/lib/api';
import { ViewActiveClientButton } from './ViewActiveClientButton';
import { AgreementStatusCard } from './form/AgreementStatusCard';
import { EmployeeClientTrainingCard } from './EmployeeClientTrainingCard';
import { EmployeeTrainingDialog } from './EmployeeTrainingDialog';
import { EmployeePdfPreviewDialog } from './EmployeePdfPreviewDialog';
import { fetchEmployeeDocumentBlob } from './openEmployeeDocument';

const AVAILABLE_EMPLOYEE_TAGS = [
  'Reliable', 'Experienced', 'Bilingual', 'New', 'Top Performer', 'Flexible Schedule',
];

const SPECIAL_TAG_OPTIONS: { value: EmployeeTag; label: string }[] = [
  { value: 'ex', label: 'Ex' },
  { value: 'blacklisted', label: 'Blacklisted' },
  { value: 'no_show', label: 'No Show' },
];

const SPECIAL_TAG_STYLES: Record<EmployeeTag, string> = {
  blacklisted: 'bg-red-100 text-red-800 border-red-300',
  no_show: 'bg-orange-100 text-orange-800 border-orange-300',
  ex: 'bg-gray-100 text-gray-800 border-gray-300',
};

function formatTagLabel(tag: string) {
  const special = SPECIAL_TAG_OPTIONS.find((t) => t.value === tag);
  if (special) return special.label;
  return tag;
}

function DetailCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 space-y-1', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="text-base text-foreground break-words font-medium">{children}</div>
    </div>
  );
}

function MetricTile({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Briefcase;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/50 px-2.5 py-1.5 min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1 truncate">
        <Icon className="h-3 w-3 shrink-0" />
        {label}
      </p>
      <div className="mt-0.5 text-sm font-semibold leading-tight truncate">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold tracking-tight">{children}</h3>;
}

/** Human-friendly labels for each document category. */
const DOC_TYPE_LABELS: Record<string, string> = {
  photo_id: 'Photo ID',
  sin: 'SIN',
  proof_of_status: 'Proof of Status',
  resume: 'Resume',
  agreement: 'Agreement',
  bank_deposit: 'Bank Deposit',
  training_certificate: 'Training Certificate',
  other: 'Other Documents',
};

/** Order in which category sections are rendered; 'other' stays last. */
const DOC_TYPE_ORDER: string[] = [
  'photo_id',
  'sin',
  'proof_of_status',
  'resume',
  'agreement',
  'bank_deposit',
  'training_certificate',
  'other',
];

const humanizeDocType = (type: string) =>
  DOC_TYPE_LABELS[type] ??
  type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const getDocExt = (doc: EmployeeDocument) => {
  const ext = (doc.fileName || doc.name || '').toLowerCase().split('.').pop() || '';
  return /^[a-z0-9]{1,5}$/.test(ext) && ext !== (doc.name || '').toLowerCase()
    ? ext.toUpperCase()
    : '';
};

type ExpiryTone = 'ok' | 'warn' | 'expired';

const EXPIRY_TONES: Record<ExpiryTone, { dot: string; text: string }> = {
  ok: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  warn: { dot: 'bg-amber-500', text: 'text-amber-700' },
  expired: { dot: 'bg-rose-500', text: 'text-rose-700' },
};

/** Returns a quiet expiry status descriptor, or null when no expiry is set. */
function getExpiryStatus(expiryDate?: string | null): {
  label: string;
  tone: ExpiryTone;
} | null {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  const now = new Date();
  const days = Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
  const dateLabel = format(expiry, 'MMM d, yyyy');
  if (days < 0) return { label: `Expired ${dateLabel}`, tone: 'expired' };
  if (days <= 30) return { label: `Expires ${dateLabel}`, tone: 'warn' };
  return { label: `Valid to ${dateLabel}`, tone: 'ok' };
}

const isImageDoc = (doc: EmployeeDocument) =>
  (doc.mimeType?.startsWith('image/') ?? false) ||
  /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(doc.fileName || doc.name || '');

/** Lazily loads a real thumbnail for image docs; falls back to an icon tile. */
function DocThumb({
  employeeId,
  doc,
}: {
  employeeId: string;
  doc: EmployeeDocument;
}) {
  const Icon = isImageDoc(doc) ? ImageIcon : FileText;
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!isImageDoc(doc)) return;
    let url: string | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const blob = await fetchEmployeeDocumentBlob(employeeId, doc.id, doc.fileName || doc.name);
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setThumb(url);
      } catch {
        /* fall back to icon */
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [employeeId, doc.id, doc.fileName, doc.name, doc.type]);

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/40 text-muted-foreground">
      {thumb ? (
        <img src={thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <Icon className="h-4 w-4" />
      )}
    </div>
  );
}

function DocumentCard({
  employeeId,
  doc,
  onView,
}: {
  employeeId: string;
  doc: EmployeeDocument;
  onView: () => void;
}) {
  const expiry = getExpiryStatus(doc.expiryDate);
  const ext = getDocExt(doc);
  return (
    <div className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-muted/40">
      <DocThumb employeeId={employeeId} doc={doc} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-tight text-foreground">
            {doc.name}
          </span>
          {ext && (
            <span className="shrink-0 rounded border border-border/60 px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {ext}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] leading-tight text-muted-foreground">
          <span className="truncate">
            {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
          </span>
          {expiry && (
            <>
              <span className="text-border">·</span>
              <span
                className={`inline-flex items-center gap-1 font-medium ${EXPIRY_TONES[expiry.tone].text}`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${EXPIRY_TONES[expiry.tone].dot}`}
                />
                {expiry.label}
              </span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onView}
        title="View document"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-[11px] font-medium text-foreground/80 shadow-sm transition-all hover:border-primary/50 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      >
        <Eye className="h-3.5 w-3.5" />
        View
      </button>
    </div>
  );
}

interface EmployeeDetailsSheetProps {
  employee: Employee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated?: (employee: Employee) => void;
  onListRefresh?: () => void;
  /** Renders on the left side (e.g. softphone dialer during a call), like the client call view. */
  phoneDialerSlot?: ReactNode;
}

export function EmployeeDetailsSheet({
  employee,
  open,
  onOpenChange,
  onUpdated,
  onListRefresh,
  phoneDialerSlot,
}: EmployeeDetailsSheetProps) {
  const navigate = useNavigate();
  const availableEmployeeTags = AVAILABLE_EMPLOYEE_TAGS;
  const [activeTab, setActiveTab] = useState('overview');
  const [noteContent, setNoteContent] = useState('');
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [tagMutationLoading, setTagMutationLoading] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [endTarget, setEndTarget] = useState<EndPlacementTarget | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [trainingOpen, setTrainingOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<{
    id: string;
    fileName: string;
    name: string;
    mimeType?: string | null;
  } | null>(null);

  const canManageEmployees = useHasPermission('employees:write');
  const canApproveEmployees = useHasPermission('employees:approve');

  useEffect(() => {
    setActiveTab('overview');
    setNoteContent('');
  }, [employee?.id]);

  if (!employee) return null;

  const trainingRequired = employee.trainingRequiredCount ?? 2;
  const trainingDone = employee.trainingCompletedCount ?? 0;
  const agreementComplete = employee.agreementStatus === 'complete';
  const trainingsComplete = trainingDone >= trainingRequired;
  const readyForMaster = agreementComplete && trainingsComplete;

  // Placed when there is a real assignment, job roster status, or active placement flags.
  const isPlaced = Boolean(
    employee.activeClientId ||
      employee.activeAssignmentId ||
      employee.workStatus === 'active' ||
      employee.workStatus === 'scheduled',
  );
  /** Master list = approved, not yet placed on a client. */
  const isMaster = employee.approvalStatus === 'approved' && !isPlaced;

  const showApproveReject =
    employee.approvalStatus === 'pending' &&
    Boolean(employee.submitterRole) &&
    canApproveEmployees;

  const showSubmitForApproval =
    canManageEmployees &&
    (employee.approvalStatus === 'rejected' ||
      (employee.approvalStatus === 'pending' && !employee.submitterRole));

  const showTrainingAction =
    canManageEmployees &&
    (employee.approvalStatus === 'pending' || employee.approvalStatus === 'approved');

  const openEndPlacement = async () => {
    try {
      const assignments = await fetchEmployeeAssignments(employee.id);
      const activeAsg = assignments.find((a) => a.isActive);
      setEndTarget({
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        assignmentId: activeAsg?.id ?? null,
        jobId: activeAsg?.jobId ?? null,
        jobTitle: activeAsg?.jobTitle ?? null,
        clientName: employee.activeClientName ?? activeAsg?.clientName ?? null,
      });
      setEndOpen(true);
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not load placement',
        variant: 'destructive',
      });
    }
  };

  const goToEdit = () => {
    onOpenChange(false);
    navigate(`/employees/${employee.id}/edit`);
  };

  const documents = employee.documents ?? [];
  const notes = employee.notes ?? [];
  const workExperiences = employee.workExperiences ?? [];
  const currentTags = Array.from(new Set(employee.tags ?? []));
  const emergency =
    employee.emergencyContact ??
    (employee.emergencyContactName
      ? { name: employee.emergencyContactName, phone: employee.emergencyContactPhone ?? '' }
      : null);

  const addableTags = [
    ...SPECIAL_TAG_OPTIONS.map((t) => ({ value: t.value, label: t.label })),
    ...availableEmployeeTags
      .filter((t) => !SPECIAL_TAG_OPTIONS.some((s) => s.value === t))
      .map((t) => ({ value: t, label: t })),
  ].filter((t) => !currentTags.includes(t.value));

  const handleAddTag = async (tag: string) => {
    if (!tag || tagMutationLoading) return;
    setTagMutationLoading(true);
    try {
      const nextTags = Array.from(new Set([...currentTags, tag]));
      const updated = await updateEmployee(employee.id, { tags: nextTags });
      onUpdated?.(updated);
      onListRefresh?.();
      toast({ title: 'Tag added' });
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not add tag',
        variant: 'destructive',
      });
    } finally {
      setTagMutationLoading(false);
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (tagMutationLoading) return;
    setTagMutationLoading(true);
    try {
      const nextTags = currentTags.filter((t) => t !== tag);
      const updated = await updateEmployee(employee.id, { tags: nextTags });
      onUpdated?.(updated);
      onListRefresh?.();
      toast({ title: 'Tag removed' });
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not remove tag',
        variant: 'destructive',
      });
    } finally {
      setTagMutationLoading(false);
    }
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setBusy(true);
    try {
      const updated = await addEmployeeNote(employee.id, noteContent.trim());
      setNoteContent('');
      onUpdated?.(updated);
      toast({ title: 'Note added' });
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not add note',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async () => {
    setBusy(true);
    try {
      let updated: Employee;
      if (employee.submitterRole) {
        await postApprovalAction('employee_add', employee.id, 'approve', {
          subCompanyId: employee.addedBySubCompanyId ?? undefined,
        });
        updated = await fetchEmployee(employee.id);
      } else {
        updated = await approveEmployee(employee.id);
      }
      setShowApprovalDialog(false);
      onUpdated?.(updated);
      onListRefresh?.();
      toast({
        title: 'Employee approved',
        description: 'Moved to Master. Use Link to Client from the Master list when ready to place them.',
      });
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not approve',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) {
      toast({ title: 'Please provide a reason', variant: 'destructive' });
      return;
    }
    setBusy(true);
    try {
      let updated: Employee;
      if (employee.submitterRole) {
        await postApprovalAction('employee_add', employee.id, 'reject', {
          subCompanyId: employee.addedBySubCompanyId ?? undefined,
          remarks: rejectReason.trim(),
        });
        updated = await fetchEmployee(employee.id);
      } else {
        updated = await rejectEmployee(employee.id, rejectReason.trim());
      }
      setShowRejectDialog(false);
      setRejectReason('');
      onUpdated?.(updated);
      onListRefresh?.();
      toast({ title: 'Employee rejected' });
    } catch (err) {
      toast({
        title: 'Failed',
        description: err instanceof Error ? err.message : 'Could not reject',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitForApproval = async () => {
    setBusy(true);
    try {
      const updated = await submitEmployeeForApproval(employee.id);
      onUpdated?.(updated);
      onListRefresh?.();
      if (updated.approvalStatus === 'approved') {
        toast({
          title: 'Employee approved',
          description: 'Submitted and finalized. Employee is now in Master.',
        });
      } else {
        toast({
          title: 'Submitted for approval',
          description: 'Moved to Pending. Recruitment Manager approval will place them in Master.',
        });
      }
    } catch (err) {
      toast({
        title: 'Cannot submit',
        description: err instanceof Error ? err.message : 'Upload required documents first',
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const addressLine = [employee.city, employee.province, employee.postalCode]
    .filter(Boolean)
    .join(', ');

  const positionLabel = employee.position || employee.department || '—';
  const rateLabel =
    employee.hourlyRate != null ? `$${Number(employee.hourlyRate).toFixed(2)}/hr` : '—';
  const trainingLabel = `${trainingDone}/${trainingRequired}`;
  const hasEducation = Boolean(
    employee.educationLevel || employee.courseStudied || employee.diplomaName
  );
  const hasPay = Boolean(
    employee.salaryPaymentMethod || employee.hourlyRate != null || employee.bankName
  );

  // Call view keeps the side Sheet (dialer on the left); the normal detail view
  // opens as a large centered modal with a close button.
  const ModalRoot: ElementType = phoneDialerSlot ? Sheet : Dialog;
  const ModalContent: ElementType = phoneDialerSlot ? SheetContent : DialogContent;

  return (
    <>
      <ModalRoot open={open} onOpenChange={onOpenChange}>
        <ModalContent
          overlayClassName={phoneDialerSlot ? 'z-[260]' : undefined}
          className={
            phoneDialerSlot
              ? 'z-[260] p-0 overflow-hidden flex h-full min-h-0 w-full sm:max-w-[min(96vw,90rem)] [&>button]:z-50'
              : 'flex h-[92vh] w-[95vw] max-w-[1400px] flex-col gap-0 overflow-hidden p-0 rounded-xl sm:rounded-xl [&>button]:right-4 [&>button]:top-4 [&>button]:z-50 [&>button]:flex [&>button]:h-8 [&>button]:w-8 [&>button]:items-center [&>button]:justify-center [&>button]:rounded-full [&>button]:border [&>button]:bg-background [&>button]:opacity-100 [&>button]:shadow-sm [&>button]:transition-colors [&>button]:hover:bg-muted'
          }
        >
          {phoneDialerSlot}

          <div
            className={
              phoneDialerSlot
                ? 'flex-1 min-w-0 flex flex-col min-h-0'
                : 'flex flex-col flex-1 min-h-0'
            }
          >
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex flex-col flex-1 min-h-0"
            >
              {/* Compact fixed header chrome */}
              <div className="shrink-0 z-10 bg-background border-b">
                <SheetHeader className="px-5 pt-3 pb-2 space-y-2 text-left">
                  <div className="flex items-center gap-2 flex-wrap min-w-0 pr-8">
                    <SheetTitle className="text-base sm:text-lg font-semibold truncate">
                      {employee.firstName} {employee.lastName}
                    </SheetTitle>
                    <Badge
                      variant={employee.employeeType === 'internal' ? 'default' : 'secondary'}
                      className="gap-1 text-[11px] h-5 px-1.5 shrink-0"
                    >
                      {employee.employeeType === 'internal' ? (
                        <Building2 className="h-3 w-3" />
                      ) : (
                        <Users className="h-3 w-3" />
                      )}
                      {employee.employeeType === 'internal' ? 'Internal' : 'External'}
                    </Badge>
                    <EmployeeStatusBadge approvalStatus={employee.approvalStatus} />
                    {employee.approvalStatus === 'pending' && (
                      <EmployeePendingReadinessBadges
                        employee={employee}
                        onOpenTraining={
                          canManageEmployees ? () => setTrainingOpen(true) : undefined
                        }
                      />
                    )}
                  </div>

                  <SheetDescription className="flex items-center gap-2 flex-wrap text-xs !mt-0">
                    {employee.position && (
                      <span className="font-medium text-foreground/75 truncate">
                        {employee.position}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      {addressLine || employee.address || 'No location on file'}
                    </span>
                    {employee.activeClientName && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground truncate">
                        <Briefcase className="h-3 w-3 shrink-0" />
                        {employee.activeClientName}
                      </span>
                    )}
                  </SheetDescription>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <MetricTile label="Email" icon={Mail}>
                      <span className="truncate block text-xs sm:text-sm">
                        {employee.email || '—'}
                      </span>
                    </MetricTile>
                    <MetricTile label="Phone" icon={Phone}>
                      <span className="truncate block text-xs sm:text-sm">
                        {employee.phone || '—'}
                      </span>
                    </MetricTile>
                    <MetricTile label="Training" icon={GraduationCap}>
                      <span className="tabular-nums">
                        {trainingLabel}
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          certs
                        </span>
                      </span>
                    </MetricTile>
                    <MetricTile label="Pay" icon={Banknote}>
                      <span className="truncate block text-xs sm:text-sm">{rateLabel}</span>
                    </MetricTile>
                  </div>

                  {(currentTags.length > 0 || (canManageEmployees && addableTags.length > 0)) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {currentTags.map((tag) => {
                        const specialStyle = SPECIAL_TAG_STYLES[tag as EmployeeTag];
                        return (
                          <span
                            key={tag}
                            className={cn(
                              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                              specialStyle
                                ? specialStyle
                                : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/15',
                            )}
                          >
                            {formatTagLabel(tag)}
                            {canManageEmployees && (
                              <button
                                type="button"
                                onClick={() => handleRemoveTag(tag)}
                                disabled={tagMutationLoading}
                                className="rounded-full hover:text-destructive transition-colors ml-0.5"
                                aria-label={`Remove ${formatTagLabel(tag)}`}
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            )}
                          </span>
                        );
                      })}
                      {canManageEmployees && addableTags.length > 0 && (
                        <div className="relative">
                          <select
                            value=""
                            onChange={(e) => {
                              const tag = e.target.value;
                              e.target.value = '';
                              void handleAddTag(tag);
                            }}
                            disabled={tagMutationLoading}
                            className="absolute inset-0 opacity-0 w-full cursor-pointer"
                          >
                            <option value="">Add tag...</option>
                            {addableTags.map((t) => (
                              <option key={t.value} value={t.value}>
                                {t.label}
                              </option>
                            ))}
                          </select>
                          <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer text-xs">
                            <Plus className="h-3 w-3" /> Add tag
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </SheetHeader>

                {/* Actions bar */}
                <div className="px-5 py-1.5 border-t flex flex-wrap items-center gap-1.5 bg-muted/20">
                  {canManageEmployees && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={goToEdit}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1" />
                      Edit
                    </Button>
                  )}
                  {showTrainingAction && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setTrainingOpen(true)}
                    >
                      <GraduationCap className="h-3.5 w-3.5 mr-1" />
                      Training
                    </Button>
                  )}
                  {showApproveReject && (
                    <>
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-green-600 hover:bg-green-700"
                        onClick={() => setShowApprovalDialog(true)}
                        disabled={busy || !readyForMaster}
                        title={
                          readyForMaster
                            ? undefined
                            : 'Agreement and both trainings must be complete'
                        }
                      >
                        <Check className="h-3.5 w-3.5 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => setShowRejectDialog(true)}
                        disabled={busy}
                      >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Reject
                      </Button>
                    </>
                  )}
                  {showSubmitForApproval && (
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void handleSubmitForApproval()}
                      disabled={busy}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {employee.approvalStatus === 'rejected'
                        ? 'Resubmit'
                        : 'Send to Pending'}
                    </Button>
                  )}
                  {canManageEmployees &&
                    employee.approvalStatus === 'approved' &&
                    isPlaced && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-7 text-xs"
                        onClick={() => void openEndPlacement()}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" />
                        End Placement
                      </Button>
                    )}
                </div>

                {showApproveReject && !readyForMaster && (
                  <div className="px-5 py-1.5 border-t">
                    <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800">
                      Cannot approve to Master until{' '}
                      {!agreementComplete && !trainingsComplete
                        ? 'the agreement is signed and both trainings have certificates'
                        : !agreementComplete
                          ? 'the onboarding agreement is signed'
                          : `both trainings are complete (${trainingDone}/${trainingRequired})`}
                      .
                    </div>
                  </div>
                )}

                {/* Sticky tabs */}
                <div className="px-5 py-1.5 border-t">
                  <TabsList className="w-full h-8 flex flex-wrap justify-start gap-0.5 p-0.5">
                    <TabsTrigger value="overview" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="experience" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                      Experience
                    </TabsTrigger>
                    <TabsTrigger value="onboarding" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                      Onboarding
                    </TabsTrigger>
                    <TabsTrigger value="documents" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                      Documents
                      {documents.length > 0 && (
                        <span className="ml-1 tabular-nums text-muted-foreground">
                          ({documents.length})
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="flex-1 min-w-[4.5rem] text-xs h-7 px-2 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm data-[state=active]:font-semibold">
                      Notes
                      {notes.length > 0 && (
                        <span className="ml-1 tabular-nums text-muted-foreground">
                          ({notes.length})
                        </span>
                      )}
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="px-8 py-7">
                  {/* ── Overview ── */}
                  <TabsContent value="overview" className="mt-0 space-y-8">
                    <div className="space-y-4">
                      <SectionTitle>Contact</SectionTitle>
                      <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                        <DetailCell label="Email" className="sm:col-span-1">
                          <span className="break-all">{employee.email || '—'}</span>
                        </DetailCell>
                        <DetailCell label="Phone">{employee.phone || '—'}</DetailCell>
                        {employee.alternatePhone && (
                          <DetailCell label="Alt. phone">{employee.alternatePhone}</DetailCell>
                        )}
                        {employee.gender && (
                          <DetailCell label="Gender">
                            <span className="capitalize">{employee.gender}</span>
                          </DetailCell>
                        )}
                        {employee.dateOfBirth && (
                          <DetailCell label="Date of birth">
                            {format(new Date(employee.dateOfBirth), 'MMM d, yyyy')}
                          </DetailCell>
                        )}
                        <DetailCell label="Address" className="col-span-2 sm:col-span-3">
                          <div className="space-y-0.5">
                            <div>{employee.address || '—'}</div>
                            {employee.addressLine2 && <div>{employee.addressLine2}</div>}
                            {(addressLine || employee.country) && (
                              <div className="text-muted-foreground font-normal text-sm">
                                {[addressLine, employee.country].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </DetailCell>
                      </div>
                    </div>

                    {emergency && (
                      <div className="space-y-4">
                        <SectionTitle>Emergency contact</SectionTitle>
                        <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                          <DetailCell label="Name">{emergency.name}</DetailCell>
                          <DetailCell label="Phone">{emergency.phone}</DetailCell>
                          {emergency.relationship && (
                            <DetailCell label="Relationship">{emergency.relationship}</DetailCell>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <SectionTitle>Availability & status</SectionTitle>
                      <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                        <DetailCell label="Position">{positionLabel}</DetailCell>
                        {employee.department && (
                          <DetailCell label="Department">{employee.department}</DetailCell>
                        )}
                        {employee.availableFrom && (
                          <DetailCell label="Available from">
                            <span className="inline-flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              {format(new Date(employee.availableFrom), 'MMM d, yyyy')}
                            </span>
                          </DetailCell>
                        )}
                        {(employee.availabilityTypes?.length ?? 0) > 0 && (
                          <DetailCell label="Availability">
                            <span className="capitalize">
                              {(employee.availabilityTypes ?? [])
                                .map((t) => t.replace(/_/g, ' '))
                                .join(', ')}
                            </span>
                          </DetailCell>
                        )}
                        {employee.residencyStatus && (
                          <DetailCell label="Residency">
                            <span className="capitalize">
                              {employee.residencyStatus.replace('_', ' ')}
                            </span>
                          </DetailCell>
                        )}
                        {(employee.shiftsAvailable?.length ?? 0) > 0 && (
                          <DetailCell label="Shifts">
                            {employee.shiftsAvailable!.join(', ')}
                          </DetailCell>
                        )}
                        {employee.ableTwelveHourShift != null && (
                          <DetailCell label="12-hour shifts">
                            {employee.ableTwelveHourShift ? 'Yes' : 'No'}
                          </DetailCell>
                        )}
                        {(employee.englishProficiency?.length ?? 0) > 0 && (
                          <DetailCell label="English">
                            {employee.englishProficiency!.join(', ')}
                          </DetailCell>
                        )}
                        {employee.experienceDuties && (
                          <DetailCell label="Experience / Duties" className="col-span-2 sm:col-span-3">
                            <p className="text-sm font-normal text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {employee.experienceDuties}
                            </p>
                          </DetailCell>
                        )}
                      </div>
                    </div>

                    {hasPay && (
                      <div className="space-y-4">
                        <SectionTitle>Salary & payment</SectionTitle>
                        <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                          {employee.hourlyRate != null && (
                            <DetailCell label="Hourly rate">
                              ${Number(employee.hourlyRate).toFixed(2)} CAD
                            </DetailCell>
                          )}
                          {employee.salaryPaymentMethod && (
                            <DetailCell label="Payment method">
                              {employee.salaryPaymentMethod === 'deposit'
                                ? 'Direct Deposit'
                                : 'Cheque'}
                            </DetailCell>
                          )}
                          {employee.salaryPaymentMethod === 'deposit' && (
                            <>
                              {employee.bankName && (
                                <DetailCell label="Bank">{employee.bankName}</DetailCell>
                              )}
                              {employee.bankInstitutionNumber && (
                                <DetailCell label="Institution #">
                                  {employee.bankInstitutionNumber}
                                </DetailCell>
                              )}
                              {employee.bankTransitNumber && (
                                <DetailCell label="Transit #">
                                  {employee.bankTransitNumber}
                                </DetailCell>
                              )}
                              {employee.bankAccountNumber && (
                                <DetailCell label="Account #">
                                  {employee.bankAccountNumber}
                                </DetailCell>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-1.5 text-base text-muted-foreground border-t pt-5">
                      <p>
                        Added by {employee.addedByName} on{' '}
                        {format(new Date(employee.createdAt), 'MMM d, yyyy')}
                      </p>
                      {employee.approvedByName && employee.approvedAt && (
                        <p>
                          Approved by {employee.approvedByName} on{' '}
                          {format(new Date(employee.approvedAt), 'MMM d, yyyy')}
                        </p>
                      )}
                      {employee.rejectionReason && (
                        <p className="text-destructive">
                          Rejection reason: {employee.rejectionReason}
                        </p>
                      )}
                      <p>
                        Last updated:{' '}
                        {format(new Date(employee.updatedAt), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </TabsContent>

                  {/* ── Experience ── */}
                  <TabsContent value="experience" className="mt-0 space-y-8">
                    {hasEducation ? (
                      <div className="space-y-4">
                        <SectionTitle>Education</SectionTitle>
                        <div className="rounded-xl border bg-card p-6 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-5">
                          {employee.educationLevel && (
                            <DetailCell label="Level">{employee.educationLevel}</DetailCell>
                          )}
                          {(employee.educationFromYear || employee.educationEndYear) && (
                            <DetailCell label="Years">
                              {employee.educationFromYear ?? '?'} –{' '}
                              {employee.educationEndYear ?? '?'}
                            </DetailCell>
                          )}
                          {employee.graduated != null && (
                            <DetailCell label="Graduated">
                              {employee.graduated ? 'Yes' : 'No'}
                            </DetailCell>
                          )}
                          {employee.courseStudied && (
                            <DetailCell label="Course">{employee.courseStudied}</DetailCell>
                          )}
                          {employee.diplomaName && (
                            <DetailCell label="Diploma / Degree" className="col-span-2">
                              {employee.diplomaName}
                            </DetailCell>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed px-8 py-10 text-center">
                        <GraduationCap className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-base text-muted-foreground">No education on file.</p>
                      </div>
                    )}

                    {workExperiences.length > 0 ? (
                      <div className="space-y-4">
                        <SectionTitle>Work experience</SectionTitle>
                        <div className="space-y-3">
                          {workExperiences.map((w, i) => (
                            <div
                              key={w.id ?? i}
                              className="rounded-xl border bg-card px-5 py-4 space-y-1"
                            >
                              <div className="font-semibold text-base">
                                {w.companyName}
                                {w.position ? (
                                  <span className="font-normal text-muted-foreground">
                                    {' '}
                                    — {w.position}
                                  </span>
                                ) : null}
                              </div>
                              {(w.duration || w.contactNumber) && (
                                <div className="text-sm text-muted-foreground">
                                  {[w.duration, w.contactNumber].filter(Boolean).join(' · ')}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed px-8 py-10 text-center">
                        <Briefcase className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-base text-muted-foreground">
                          No work experience listed.
                        </p>
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Onboarding ── */}
                  <TabsContent value="onboarding" className="mt-0 space-y-8">
                    {canManageEmployees && (
                      <div className="space-y-4">
                        <SectionTitle>Agreement</SectionTitle>
                        <AgreementStatusCard
                          employeeId={employee.id}
                          employeeEmail={employee.email ?? undefined}
                          onEmailUpdated={(email) => {
                            onUpdated?.({ ...employee, email });
                            onListRefresh?.();
                          }}
                          previewEmployee={employee}
                          includeDemoSignature={employee.approvalStatus === 'approved'}
                        />
                      </div>
                    )}

                    <div className="space-y-4">
                      <SectionTitle>Training</SectionTitle>
                      <EmployeeClientTrainingCard
                        employeeId={employee.id}
                        canWrite={canManageEmployees}
                        open={open}
                        onChanged={onListRefresh}
                      />
                      {showTrainingAction && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setTrainingOpen(true)}
                        >
                          <GraduationCap className="h-3.5 w-3.5 mr-1" />
                          Resend / Upload certificates
                        </Button>
                      )}
                    </div>

                    {employee.approvalStatus === 'approved' && isPlaced && (
                      <div className="space-y-4">
                        <SectionTitle>Current placement</SectionTitle>
                        <div className="rounded-xl border bg-card p-6 space-y-3">
                          {employee.activeClientId ? (
                            <ViewActiveClientButton
                              clientId={employee.activeClientId}
                              clientName={employee.activeClientName}
                              className="w-full sm:w-auto"
                            />
                          ) : employee.activeClientName ? (
                            <p className="text-base font-medium">{employee.activeClientName}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground">Active assignment</p>
                          )}
                          {canManageEmployees && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => void openEndPlacement()}
                            >
                              <Ban className="h-3.5 w-3.5 mr-1" />
                              End Job Placement
                            </Button>
                          )}
                        </div>
                      </div>
                    )}

                    {employee.activeClientName && !isPlaced && (
                      <div className="space-y-4">
                        <SectionTitle>Active client</SectionTitle>
                        <div className="rounded-xl border bg-card p-6">
                          {employee.activeClientId ? (
                            <ViewActiveClientButton
                              clientId={employee.activeClientId}
                              clientName={employee.activeClientName}
                              className="w-full sm:w-auto"
                            />
                          ) : (
                            <p className="text-base font-medium">{employee.activeClientName}</p>
                          )}
                        </div>
                      </div>
                    )}

                    {employee.approvalStatus === 'approved' && (
                      <div className="space-y-4">
                        <SectionTitle>Employment history</SectionTitle>
                        <EmploymentHistoryPanel
                          employeeId={employee.id}
                          enabled
                          refreshKey={historyKey}
                        />
                      </div>
                    )}

                    {!canManageEmployees &&
                      employee.approvalStatus !== 'approved' &&
                      !employee.activeClientName && (
                        <div className="rounded-xl border border-dashed px-8 py-14 text-center">
                          <p className="text-base text-muted-foreground">
                            No onboarding details available.
                          </p>
                        </div>
                      )}
                  </TabsContent>

                  {/* ── Documents ── */}
                  <TabsContent value="documents" className="mt-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <SectionTitle>Documents</SectionTitle>
                      {documents.length > 0 &&
                        (() => {
                          const withExpiry = documents
                            .map((d) => getExpiryStatus(d.expiryDate))
                            .filter(Boolean) as { label: string; className: string }[];
                          const expired = withExpiry.filter((e) =>
                            e.label.startsWith('Expired'),
                          ).length;
                          const expiring = withExpiry.filter((e) =>
                            e.label.startsWith('Expires'),
                          ).length;
                          return (
                            <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                              <span className="font-medium">{documents.length} documents</span>
                              {expired > 0 && (
                                <span className="inline-flex items-center gap-1 font-medium text-rose-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                                  {expired} expired
                                </span>
                              )}
                              {expiring > 0 && (
                                <span className="inline-flex items-center gap-1 font-medium text-amber-700">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                  {expiring} expiring soon
                                </span>
                              )}
                            </div>
                          );
                        })()}
                    </div>
                    {documents.length === 0 ? (
                      <div className="rounded-xl border border-dashed px-8 py-14 text-center">
                        <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                        <p className="text-base text-muted-foreground">No documents uploaded</p>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {(() => {
                          const known = new Set(DOC_TYPE_ORDER);
                          const groups: { type: string; docs: EmployeeDocument[] }[] = [];
                          for (const type of DOC_TYPE_ORDER) {
                            const docs = documents.filter((d) => d.type === type);
                            if (docs.length) groups.push({ type, docs });
                          }
                          const unknown = documents.filter((d) => !known.has(d.type));
                          if (unknown.length) groups.push({ type: '__uncategorized', docs: unknown });

                          return groups.map(({ type, docs }) => (
                            <div key={type} className="space-y-1">
                              <div className="flex items-center gap-2 px-1">
                                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                                  {type === '__uncategorized' ? 'Uncategorized' : humanizeDocType(type)}
                                </span>
                                <span className="text-[10px] font-medium text-muted-foreground/50">
                                  {docs.length}
                                </span>
                              </div>
                              <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
                                {docs.map((doc) => (
                                  <DocumentCard
                                    key={doc.id}
                                    employeeId={employee.id}
                                    doc={doc}
                                    onView={() =>
                                      setPreviewDoc({
                                        id: doc.id,
                                        fileName: doc.fileName || doc.name,
                                        name: doc.name || doc.fileName || 'Document',
                                        mimeType: doc.mimeType,
                                      })
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    )}
                  </TabsContent>

                  {/* ── Notes ── */}
                  <TabsContent value="notes" className="mt-0 space-y-4">
                    <SectionTitle>Notes</SectionTitle>
                    {canManageEmployees && (
                      <div className="rounded-xl border bg-card p-5 space-y-3">
                        <Textarea
                          placeholder="Add a note..."
                          value={noteContent}
                          onChange={(e) => setNoteContent(e.target.value)}
                          rows={3}
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleAddNote()}
                          disabled={!noteContent.trim() || busy}
                        >
                          Add Note
                        </Button>
                      </div>
                    )}
                    {notes.length === 0 ? (
                      <div className="rounded-xl border border-dashed px-8 py-10 text-center">
                        <p className="text-base text-muted-foreground">No notes yet</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {notes.map((note) => (
                          <div key={note.id} className="rounded-xl border bg-card px-4 py-3">
                            <div className="flex items-center justify-between mb-1.5 gap-2">
                              <span className="font-medium text-sm">{note.userName}</span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {format(new Date(note.createdAt), 'MMM d, yyyy h:mm a')}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                              {note.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                </div>
              </ScrollArea>
            </Tabs>
          </div>
        </ModalContent>
      </ModalRoot>

      <AlertDialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Approve {employee.firstName} {employee.lastName} to Master only when the
              agreement is signed and both default trainings have certificates
              ({trainingDone}/{trainingRequired}), plus required ID documents. They can then be
              linked to a client or added to a job.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleApprove}
              className="bg-green-600 hover:bg-green-700"
              disabled={busy}
            >
              Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRejectDialog} onOpenChange={setShowRejectDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject Employee</AlertDialogTitle>
            <AlertDialogDescription>
              Please provide a reason for rejecting {employee.firstName} {employee.lastName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 space-y-2">
            <Textarea
              placeholder="Reason for rejection..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={2000}
            />
            {!rejectReason.trim() && (
              <p className="text-xs text-muted-foreground">A rejection reason is required.</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReject}
              className="bg-red-600 hover:bg-red-700"
              disabled={busy || !rejectReason.trim()}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EndPlacementDialog
        open={endOpen}
        onOpenChange={setEndOpen}
        target={endTarget}
        onEnded={() => {
          setHistoryKey((k) => k + 1);
          void fetchEmployee(employee.id).then((updated) => {
            onUpdated?.(updated);
            onListRefresh?.();
          });
        }}
      />

      <EmployeeTrainingDialog
        employee={employee}
        open={trainingOpen}
        onOpenChange={setTrainingOpen}
        onChanged={() => {
          void fetchEmployee(employee.id).then((updated) => {
            onUpdated?.(updated);
            onListRefresh?.();
          });
        }}
      />

      <EmployeePdfPreviewDialog
        open={Boolean(previewDoc)}
        onOpenChange={(next) => {
          if (!next) setPreviewDoc(null);
        }}
        employeeId={employee.id}
        docId={previewDoc?.id ?? null}
        fileName={previewDoc?.fileName}
        mimeType={previewDoc?.mimeType}
        title={previewDoc?.name || 'Document'}
        badge={null}
      />
    </>
  );
}
