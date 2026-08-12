import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Job, JobAssignment } from '@/lib/jobTypes';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toggleJobAssignmentRole, fetchJobAssignmentRequests } from '@/lib/jobsApi';
import {
  fetchEmployees,
  fetchEmployee,
  updateEmployee,
  createEmployeeAssignmentRequest,
  postApprovalAction,
} from '@/lib/api';
import { fetchMatchingEmployeesForJob } from '@/lib/employeeJobMatchesApi';
import { usePermission } from '@/hooks/usePermission';
import { toast } from 'sonner';
import { MoveToJobDialog } from './MoveToJobDialog';
import { JobLicenseGateDialog } from './JobLicenseGateDialog';
import { JobEmployeesAssignableTable } from './JobEmployeesAssignableTable';
import {
  JobSkillMismatchDialog,
  SKILL_MISMATCH_OVERLAY_ATTR,
  missingRequiredSkills,
} from './JobSkillMismatchDialog';
import { EndPlacementDialog, type EndPlacementTarget } from '@/components/employees/EndPlacementDialog';
import { EmployeeCallInterface } from '@/components/employees/EmployeeCallInterface';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { useCallStore } from '@/lib/callStore';
import type { Employee } from '@/lib/employeeTypes';
import { 
  Search, 
  UserPlus, 
  UserMinus, 
  Users, 
  ShieldCheck, 
  MoreHorizontal,
  ArrowRight,
  Ban,
  AlertTriangle,
  X,
  PhoneCall,
  Mail,
  Loader2,
} from 'lucide-react';

interface JobEmployeesDialogProps {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function JobEmployeesDialog({ job: jobProp, open, onOpenChange }: JobEmployeesDialogProps) {
  const queryClient = useQueryClient();
  const canApprove = usePermission('employees:approve');

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('assigned');
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string>>(new Set());
  const [endTarget, setEndTarget] = useState<EndPlacementTarget | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [bulkEndQueue, setBulkEndQueue] = useState<EndPlacementTarget[]>([]);
  const [busy, setBusy] = useState(false);
  const [assigningEmployeeId, setAssigningEmployeeId] = useState<string | null>(null);
  const [assigningAsBackup, setAssigningAsBackup] = useState(false);
  const [pendingBlacklist, setPendingBlacklist] = useState<{
    employeeId: string;
    employeeName: string;
  } | null>(null);
  const [skillGate, setSkillGate] = useState<{
    employeeId: string;
    employeeName: string;
    asBackup: boolean;
    missingSkills: string[];
  } | null>(null);
  const [licenseGate, setLicenseGate] = useState<{
    employeeId: string;
    employeeName: string;
    asBackup: boolean;
    allowSkillMismatch?: boolean;
  } | null>(null);
  const [callingEmployee, setCallingEmployee] = useState<Employee | null>(null);
  const [emailingRecipients, setEmailingRecipients] = useState<Array<{ email: string; name: string }> | null>(null);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const { openCallInterface, isCallInterfaceOpen, isMinimized, activeCall } = useCallStore();

  // Live job comes from the parent's react-query data via props
  const job = jobProp;

  // Approved employees in the job's agency (enrich assigned rows)
  const { data: employeesResult } = useQuery({
    queryKey: ['employees', 'job-picker', job?.agencyId ?? 'scope'],
    queryFn: () =>
      fetchEmployees({
        approvalStatus: 'approved',
        limit: 200,
        agencyIds: job?.agencyId ? [job.agencyId] : undefined,
      }),
    enabled: open && Boolean(job),
  });
  const employees = useMemo(() => employeesResult?.data ?? [], [employeesResult]);

  // Available Master employees for this job (skill match temporarily off — backend lists all available)
  const { data: matchingEmployees = [] } = useQuery({
    queryKey: ['job-matching-employees', job?.id],
    queryFn: () => fetchMatchingEmployeesForJob(job!.id),
    enabled: open && Boolean(job),
  });

  // Assignment requests awaiting approval for this job
  const { data: pendingRequests = [] } = useQuery({
    queryKey: ['job-assignment-requests', job?.id],
    queryFn: () => fetchJobAssignmentRequests(job!.id),
    enabled: open && Boolean(job),
  });
  const pendingByEmployeeId = useMemo(
    () => new Map(pendingRequests.map((r) => [r.employeeId, r])),
    [pendingRequests],
  );

  const refreshJobs = async () => {
    await queryClient.invalidateQueries({ queryKey: ['jobs'] });
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
    await queryClient.invalidateQueries({ queryKey: ['job-assignment-requests'] });
    await queryClient.invalidateQueries({ queryKey: ['job-matching-employees'] });
  };

  // Calculate limits - use defaults when job is null
  const maxScheduled = job ? Math.ceil(job.openPositions * (1 + job.backupPercentage / 100)) : 0;
  const primaryLimit = job?.openPositions ?? 0;
  const backupLimit = maxScheduled - primaryLimit;
  
  // Get assigned employees
  const assignments = job?.assignments || [];
  const primaryAssignments = assignments.filter(a => !a.isBackup);
  const backupAssignments = assignments.filter(a => a.isBackup);
  
  // Get selected assignments
  const selectedAssignments = useMemo(() => 
    assignments.filter(a => selectedAssignmentIds.has(a.id)),
    [assignments, selectedAssignmentIds]
  );

  const assignedEmployeeIds = useMemo(
    () => new Set(assignments.map((a) => a.employeeId)),
    [assignments],
  );

  const matchesSearch = (emp: { firstName: string; lastName: string; email?: string | null }) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
    return fullName.includes(query) || (emp.email ?? '').toLowerCase().includes(query);
  };

  // Available employees: skill + license matches (server), then search
  const availableEmployees = useMemo(() => {
    if (!job) return [];

    return matchingEmployees.filter((emp) => {
      if (assignedEmployeeIds.has(emp.id)) return false;
      return matchesSearch(emp);
    });
  }, [matchingEmployees, job, assignedEmployeeIds, searchQuery]);

  // All approved Master employees for this job's agency (including already assigned)
  const allAgencyEmployees = useMemo(() => {
    if (!job) return [];
    return employees
      .filter((emp) => matchesSearch(emp))
      .slice()
      .sort((a, b) =>
        `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
      );
  }, [employees, job, searchQuery]);

  /** Current tab list for Contact All. */
  const currentListContacts = useMemo(() => {
    const seen = new Set<string>();
    const recipients: Array<{ email: string; name: string }> = [];
    const push = (email: string | null | undefined, name: string) => {
      const trimmed = email?.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      recipients.push({ email: trimmed, name: name.trim() || trimmed });
    };

    if (activeTab === 'available') {
      for (const emp of availableEmployees) {
        push(emp.email, `${emp.firstName} ${emp.lastName}`);
      }
      return recipients;
    }

    if (activeTab === 'all') {
      for (const emp of allAgencyEmployees) {
        push(emp.email, `${emp.firstName} ${emp.lastName}`);
      }
      return recipients;
    }

    for (const a of assignments) {
      const emp = employees.find((e) => e.id === a.employeeId);
      push(emp?.email, emp ? `${emp.firstName} ${emp.lastName}` : a.employeeName);
    }
    return recipients;
  }, [activeTab, availableEmployees, allAgencyEmployees, assignments, employees]);

  const currentListTotal =
    activeTab === 'available'
      ? availableEmployees.length
      : activeTab === 'all'
        ? allAgencyEmployees.length
        : assignments.length;

  // Early return AFTER all hooks
  if (!job) return null;

  const handleCallEmployee = async (employeeId: string) => {
    try {
      const detail =
        employees.find((e) => e.id === employeeId) ?? (await fetchEmployee(employeeId));
      if (!detail.phone?.trim()) {
        toast.error('No phone on file');
        return;
      }
      // Keep Manage Employees open; call sheet stacks above (elevated z-index).
      setCallingEmployee(detail);
      openCallInterface();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load employee for call');
    }
  };

  const handleEmailEmployee = (email: string | null | undefined, name: string) => {
    const trimmed = email?.trim();
    if (!trimmed) {
      toast.error('No email on file');
      return;
    }
    setEmailingRecipients([{ email: trimmed, name: name.trim() || trimmed }]);
    setIsEmailOpen(true);
  };

  const handleContactAll = () => {
    if (currentListTotal === 0) {
      toast.error('No employees in the current list');
      return;
    }
    if (currentListContacts.length === 0) {
      toast.error('None of the employees in the current list have an email on file');
      return;
    }
    const withoutEmail =
      activeTab === 'available'
        ? availableEmployees.filter((e) => !e.email?.trim()).length
        : activeTab === 'all'
          ? allAgencyEmployees.filter((e) => !e.email?.trim()).length
          : assignments.filter((a) => {
              const emp = employees.find((e) => e.id === a.employeeId);
              return !emp?.email?.trim();
            }).length;
    if (withoutEmail > 0) {
      toast.message(
        `Contacting ${currentListContacts.length} of ${currentListTotal} (${withoutEmail} without email)`,
      );
    }
    setEmailingRecipients(currentListContacts);
    setIsEmailOpen(true);
  };

  // Selection handlers
  const toggleSelection = (assignmentId: string) => {
    const newSet = new Set(selectedAssignmentIds);
    if (newSet.has(assignmentId)) {
      newSet.delete(assignmentId);
    } else {
      newSet.add(assignmentId);
    }
    setSelectedAssignmentIds(newSet);
  };

  const selectAllPrimary = () => {
    const newSet = new Set(selectedAssignmentIds);
    primaryAssignments.forEach(a => newSet.add(a.id));
    setSelectedAssignmentIds(newSet);
  };

  const selectAllBackup = () => {
    const newSet = new Set(selectedAssignmentIds);
    backupAssignments.forEach(a => newSet.add(a.id));
    setSelectedAssignmentIds(newSet);
  };

  const clearSelection = () => {
    setSelectedAssignmentIds(new Set());
  };

  const isAllPrimarySelected = primaryAssignments.length > 0 && 
    primaryAssignments.every(a => selectedAssignmentIds.has(a.id));
  
  const isAllBackupSelected = backupAssignments.length > 0 && 
    backupAssignments.every(a => selectedAssignmentIds.has(a.id));

  // Instant job roster add (no manager approval).
  const handleAssignEmployee = async (
    employeeId: string,
    employeeName: string,
    asBackup: boolean,
    opts?: { allowSkillMismatch?: boolean },
  ) => {
    if (!asBackup && primaryAssignments.length >= primaryLimit) {
      toast.error(`Primary positions are full (${primaryLimit}/${primaryLimit})`);
      return;
    }
    if (asBackup && backupAssignments.length >= backupLimit) {
      toast.error(`Backup pool is full (${backupAssignments.length}/${backupLimit})`);
      return;
    }

    if (!opts?.allowSkillMismatch) {
      const emp =
        employees.find((e) => e.id === employeeId) ??
        matchingEmployees.find((e) => e.id === employeeId);
      const missing = missingRequiredSkills(
        emp?.skills,
        job.screeningCriteria?.requiredSkills,
      );
      if (missing.length > 0) {
        setSkillGate({ employeeId, employeeName, asBackup, missingSkills: missing });
        return;
      }
    }

    // License-required jobs: verify (and allow uploading) licenses first.
    if (job.licenseRequired && job.requiredLicenseTypes.length > 0) {
      setSkillGate(null);
      setLicenseGate({
        employeeId,
        employeeName,
        asBackup,
        allowSkillMismatch: opts?.allowSkillMismatch,
      });
      return;
    }

    await submitAssignEmployee(employeeId, employeeName, asBackup, opts?.allowSkillMismatch);
  };

  const submitAssignEmployee = async (
    employeeId: string,
    employeeName: string,
    asBackup: boolean,
    allowSkillMismatch?: boolean,
  ) => {
    setAssigningEmployeeId(employeeId);
    setAssigningAsBackup(asBackup);
    setBusy(true);
    try {
      const { assignment: request, clientTraining, assignmentEmail } =
        await createEmployeeAssignmentRequest(
        employeeId,
        {
          targetType: 'job',
          jobId: job.id,
          isBackup: asBackup,
          allowSkillMismatch: allowSkillMismatch || undefined,
        },
      );
      await refreshJobs();
      setSkillGate(null);
      if (request.status === 'approved') {
        toast.success(`${employeeName} added to roster${asBackup ? ' as backup' : ''}`);
      } else {
        toast.success(`${employeeName} queued — refresh if they do not appear yet`);
      }
      if (assignmentEmail?.sent) {
        toast.message('Assignment details email sent to the employee');
      } else if (assignmentEmail?.warning) {
        toast.warning(assignmentEmail.warning);
      }
      if (clientTraining?.started && clientTraining.emailSent) {
        toast.message('Client training email sent to the employee');
      } else if (clientTraining?.warning) {
        toast.warning(clientTraining.warning);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit assignment request');
    } finally {
      setAssigningEmployeeId(null);
      setAssigningAsBackup(false);
      setBusy(false);
    }
  };

  // Approve/reject a pending assignment request right from the roster dialog.
  const handleDecideRequest = async (
    requestId: string,
    employeeName: string,
    action: 'approve' | 'reject',
  ) => {
    setBusy(true);
    try {
      await postApprovalAction('employee_assignment', requestId, action, {
        subCompanyId: job.agencyId ?? undefined,
        remarks: action === 'reject' ? 'Rejected from job roster dialog' : undefined,
      });
      await refreshJobs();
      toast.success(
        action === 'approve'
          ? `${employeeName} approved and placed on job`
          : `Request for ${employeeName} rejected`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action} request`);
    } finally {
      setBusy(false);
    }
  };

  const openEndPlacement = (assignment: JobAssignment) => {
    setEndTarget({
      employeeId: assignment.employeeId,
      employeeName: assignment.employeeName,
      jobId: job.id,
      jobAssignmentId: assignment.id,
      jobTitle: job.title,
      clientName: job.company,
    });
    setBulkEndQueue([]);
    setEndOpen(true);
  };

  const handleRemoveEmployee = (assignment: JobAssignment) => {
    openEndPlacement(assignment);
  };

  const changeAssignmentRole = async (assignmentId: string, toBackup: boolean, successMsg: string) => {
    setBusy(true);
    try {
      await toggleJobAssignmentRole(job.id, assignmentId, toBackup);
      await refreshJobs();
      toast.success(successMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setBusy(false);
    }
  };

  const handleMoveToBackup = (assignmentId: string, employeeName: string) => {
    if (backupAssignments.length >= backupLimit) {
      toast.error('Backup pool is full');
      return;
    }
    void changeAssignmentRole(assignmentId, true, `${employeeName} moved to backup pool`);
  };

  const handleMoveToPrimary = (assignmentId: string, employeeName: string) => {
    if (primaryAssignments.length >= primaryLimit) {
      toast.error('Primary positions are full');
      return;
    }
    void changeAssignmentRole(assignmentId, false, `${employeeName} moved to primary`);
  };

  const addSpecialTagViaApi = async (employeeId: string, tag: string) => {
    const emp = await fetchEmployee(employeeId);
    const nextTags = Array.from(new Set([...(emp.tags ?? []), tag]));
    await updateEmployee(employeeId, { tags: nextTags });
    await queryClient.invalidateQueries({ queryKey: ['employees'] });
  };

  const handleAddNoShow = async (assignment: JobAssignment) => {
    setBusy(true);
    try {
      await addSpecialTagViaApi(assignment.employeeId, 'no_show');
      toast.success(`${assignment.employeeName} marked as No Show`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark as No Show');
    } finally {
      setBusy(false);
    }
  };

  const handleBlacklist = (assignment: JobAssignment) => {
    setPendingBlacklist({
      employeeId: assignment.employeeId,
      employeeName: assignment.employeeName,
    });
    openEndPlacement(assignment);
  };

  // Bulk action handlers
  const handleBulkRemove = () => {
    if (selectedAssignments.length === 0) return;
    const queue = selectedAssignments.map((a) => ({
      employeeId: a.employeeId,
      employeeName: a.employeeName,
      jobId: job.id,
      jobAssignmentId: a.id,
      jobTitle: job.title,
      clientName: job.company,
    }));
    setBulkEndQueue(queue.slice(1));
    setEndTarget(queue[0]!);
    setEndOpen(true);
  };

  const handleBulkMoveToPrimary = async () => {
    const backupSelected = selectedAssignments.filter(a => a.isBackup);
    const availableSlots = primaryLimit - primaryAssignments.length;

    if (backupSelected.length === 0) {
      toast.error('No backup employees selected');
      return;
    }
    if (backupSelected.length > availableSlots) {
      toast.error(`Only ${availableSlots} primary slots available`);
      return;
    }

    setBusy(true);
    try {
      for (const a of backupSelected) {
        await toggleJobAssignmentRole(job.id, a.id, false);
      }
      await refreshJobs();
      toast.success(`${backupSelected.length} employee(s) moved to primary`);
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move employees');
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  };

  const handleBulkMoveToBackup = async () => {
    const primarySelected = selectedAssignments.filter(a => !a.isBackup);
    const availableSlots = backupLimit - backupAssignments.length;

    if (primarySelected.length === 0) {
      toast.error('No primary employees selected');
      return;
    }
    if (primarySelected.length > availableSlots) {
      toast.error(`Only ${availableSlots} backup slots available`);
      return;
    }

    setBusy(true);
    try {
      for (const a of primarySelected) {
        await toggleJobAssignmentRole(job.id, a.id, true);
      }
      await refreshJobs();
      toast.success(`${primarySelected.length} employee(s) moved to backup pool`);
      clearSelection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to move employees');
      await refreshJobs();
    } finally {
      setBusy(false);
    }
  };

  const handleBulkMoveToJob = () => {
    setMoveDialogOpen(true);
  };

  const renderAssignmentRow = (assignment: JobAssignment, isBackup: boolean) => {
    const emp = employees.find((e) => e.id === assignment.employeeId);
    const displayName = emp
      ? `${emp.firstName} ${emp.lastName}`
      : assignment.employeeName;
    const phone = emp?.phone;
    const email = emp?.email;
    const skills = emp?.skills?.slice(0, 3) ?? [];

    return (
    <TableRow key={assignment.id} className={selectedAssignmentIds.has(assignment.id) ? 'bg-muted/50' : ''}>
      <TableCell className="w-[40px]">
        <Checkbox
          checked={selectedAssignmentIds.has(assignment.id)}
          onCheckedChange={() => toggleSelection(assignment.id)}
        />
      </TableCell>
      <TableCell>
        <div className="font-medium">
          {displayName}
          {isBackup && (
            <Badge variant="outline" className="ml-2 text-xs bg-orange-50 text-orange-700 border-orange-200">
              Backup
            </Badge>
          )}
        </div>
        {(phone || email) && (
          <div className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
            {phone && <div>{phone}</div>}
            {email && <div className="truncate max-w-[200px]">{email}</div>}
          </div>
        )}
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {skills.map((s) => (
              <Badge key={s} variant="secondary" className="text-[10px] px-1.5 py-0">
                {s}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!phone?.trim()}
                  onClick={() => void handleCallEmployee(assignment.employeeId)}
                >
                  <PhoneCall className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{phone?.trim() ? 'Call' : 'No phone on file'}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!email?.trim()}
                  onClick={() => handleEmailEmployee(email, displayName)}
                >
                  <Mail className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{email?.trim() ? 'Email' : 'No email on file'}</TooltipContent>
            </Tooltip>
            {isBackup ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMoveToPrimary(assignment.id, displayName)}
                    disabled={primaryAssignments.length >= primaryLimit}
                  >
                    <ShieldCheck className="h-4 w-4 text-blue-600" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move to Primary</TooltipContent>
              </Tooltip>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleMoveToBackup(assignment.id, displayName)}
                    disabled={backupAssignments.length >= backupLimit || job.jobType === 'internal'}
                  >
                    <Users className="h-4 w-4 text-orange-500" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Move to Backup Pool</TooltipContent>
              </Tooltip>
            )}
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleRemoveEmployee(assignment)}>
                <UserMinus className="h-4 w-4 mr-2 text-destructive" />
                End Placement
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              {isBackup ? (
                <DropdownMenuItem 
                  onClick={() => handleMoveToPrimary(assignment.id, displayName)}
                  disabled={primaryAssignments.length >= primaryLimit}
                >
                  <ShieldCheck className="h-4 w-4 mr-2 text-blue-600" />
                  Move to Primary
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem 
                  onClick={() => handleMoveToBackup(assignment.id, displayName)}
                  disabled={backupAssignments.length >= backupLimit || job.jobType === 'internal'}
                >
                  <Users className="h-4 w-4 mr-2 text-orange-500" />
                  Move to Backup
                </DropdownMenuItem>
              )}
              
              <DropdownMenuItem onClick={() => {
                setSelectedAssignmentIds(new Set([assignment.id]));
                setMoveDialogOpen(true);
              }}>
                <ArrowRight className="h-4 w-4 mr-2" />
                Move to Another Job
              </DropdownMenuItem>
              
              <DropdownMenuSeparator />
              
              <DropdownMenuItem onClick={() => handleAddNoShow(assignment)}>
                <AlertTriangle className="h-4 w-4 mr-2 text-orange-500" />
                Mark as No Show
              </DropdownMenuItem>
              
              <DropdownMenuItem 
                onClick={() => handleBlacklist(assignment)}
                className="text-destructive"
              >
                <Ban className="h-4 w-4 mr-2" />
                Blacklist & Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
    );
  };

  const nestedOverManageEmployees =
    isEmailOpen || (isCallInterfaceOpen && !isMinimized) || Boolean(skillGate);

  const isOutsideOnSkillOverlay = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest(`[${SKILL_MISMATCH_OVERLAY_ATTR}]`));
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Only the top layer should dismiss — keep Manage Employees open
          // while skill mismatch / call sheet is up.
          if (!next && (Boolean(skillGate) || assigningEmployeeId)) return;
          if (!next && isCallInterfaceOpen && !isMinimized) return;
          onOpenChange(next);
        }}
      >
        <DialogContent
          className="flex w-[min(100vw-1.5rem,72rem)] max-w-6xl h-[min(94vh,900px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl"
          onInteractOutside={(e) => {
            if (
              nestedOverManageEmployees ||
              assigningEmployeeId ||
              isOutsideOnSkillOverlay(e.target)
            ) {
              e.preventDefault();
            }
          }}
          onPointerDownOutside={(e) => {
            if (
              nestedOverManageEmployees ||
              assigningEmployeeId ||
              isOutsideOnSkillOverlay(e.target)
            ) {
              e.preventDefault();
            }
          }}
        >
          <DialogHeader className="shrink-0 border-b px-6 py-5 text-left space-y-1">
            <DialogTitle className="text-xl flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              Manage Employees — {job.title}
            </DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Capacity Overview */}
            <div className="grid grid-cols-3 gap-4 p-5 bg-muted/30 rounded-xl border">
              <div className="text-center">
                <div className="text-2xl font-bold">{job.openPositions}</div>
                <div className="text-xs text-muted-foreground">Required</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 flex items-center justify-center gap-1">
                  <ShieldCheck className="h-5 w-5" />
                  {primaryAssignments.length}/{primaryLimit}
                </div>
                <div className="text-xs text-muted-foreground">Primary</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-500 flex items-center justify-center gap-1">
                  <Users className="h-5 w-5" />
                  {backupAssignments.length}/{backupLimit}
                </div>
                <div className="text-xs text-muted-foreground">Backup ({job.backupPercentage}%)</div>
              </div>
            </div>

            {/* Bulk Actions Bar */}
            {selectedAssignmentIds.size > 0 && (
              <div className="flex items-center gap-2 p-3 bg-primary/10 border border-primary/20 rounded-lg">
                <span className="text-sm font-medium">
                  {selectedAssignmentIds.size} selected
                </span>
                <Button variant="ghost" size="sm" onClick={clearSelection}>
                  <X className="h-4 w-4" />
                </Button>
                <Separator orientation="vertical" className="h-6" />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleBulkMoveToPrimary}
                        disabled={selectedAssignments.filter(a => a.isBackup).length === 0}
                      >
                        <ShieldCheck className="h-4 w-4 mr-1 text-blue-600" />
                        Primary
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move selected to Primary</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleBulkMoveToBackup}
                        disabled={selectedAssignments.filter(a => !a.isBackup).length === 0 || job.jobType === 'internal'}
                      >
                        <Users className="h-4 w-4 mr-1 text-orange-500" />
                        Backup
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move selected to Backup Pool</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={handleBulkMoveToJob}>
                        <ArrowRight className="h-4 w-4 mr-1" />
                        Move to Job
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Move selected to another job</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={handleBulkRemove} className="text-destructive hover:text-destructive">
                        <UserMinus className="h-4 w-4 mr-1" />
                        End Placement
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>End placement for selected (rating required)</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:min-w-[480px]">
                  <TabsTrigger value="assigned">
                    Assigned ({assignments.length})
                  </TabsTrigger>
                  <TabsTrigger value="available">
                    Available ({availableEmployees.length})
                  </TabsTrigger>
                  <TabsTrigger value="all">
                    All Employees ({allAgencyEmployees.length})
                  </TabsTrigger>
                </TabsList>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleContactAll}
                  disabled={currentListTotal === 0 || currentListContacts.length === 0}
                  title={
                    currentListTotal === 0
                      ? 'No employees in the current list'
                      : currentListContacts.length === 0
                        ? 'No employees with email in the current list'
                        : `Email ${currentListContacts.length} employee${currentListContacts.length === 1 ? '' : 's'}`
                  }
                >
                  <Mail className="h-4 w-4 mr-2" />
                  Contact All
                  {currentListContacts.length > 0 && (
                    <span className="ml-1 text-muted-foreground">({currentListContacts.length})</span>
                  )}
                </Button>
              </div>

              <TabsContent value="assigned" className="space-y-4">
                {assignments.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>No employees assigned yet</p>
                    <p className="text-sm">Switch to Available or All Employees to assign</p>
                  </div>
                ) : (
                  <div className="max-h-[400px] overflow-y-auto overscroll-contain pr-1">
                    {/* Primary Employees */}
                    <div className="space-y-2">
                      <h3 className="font-medium text-sm flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-blue-600" />
                        Primary ({primaryAssignments.length}/{primaryLimit})
                      </h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[40px]">
                              <Checkbox
                                checked={isAllPrimarySelected}
                                onCheckedChange={(checked) => {
                                  if (checked) selectAllPrimary();
                                  else {
                                    const newSet = new Set(selectedAssignmentIds);
                                    primaryAssignments.forEach(a => newSet.delete(a.id));
                                    setSelectedAssignmentIds(newSet);
                                  }
                                }}
                                disabled={primaryAssignments.length === 0}
                              />
                            </TableHead>
                            <TableHead>Employee</TableHead>
                            <TableHead className="w-[200px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {primaryAssignments.map((assignment) => renderAssignmentRow(assignment, false))}
                          {primaryAssignments.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-muted-foreground">
                                No primary employees assigned
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <Separator className="my-4" />

                    {/* Backup Employees */}
                    <div className="space-y-2">
                      <h3 className="font-medium text-sm flex items-center gap-2">
                        <Users className="h-4 w-4 text-orange-500" />
                        Backup Pool ({backupAssignments.length}/{backupLimit})
                      </h3>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[40px]">
                              <Checkbox
                                checked={isAllBackupSelected}
                                onCheckedChange={(checked) => {
                                  if (checked) selectAllBackup();
                                  else {
                                    const newSet = new Set(selectedAssignmentIds);
                                    backupAssignments.forEach(a => newSet.delete(a.id));
                                    setSelectedAssignmentIds(newSet);
                                  }
                                }}
                                disabled={backupAssignments.length === 0}
                              />
                            </TableHead>
                            <TableHead>Employee</TableHead>
                            <TableHead className="w-[200px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {backupAssignments.map((assignment) => renderAssignmentRow(assignment, true))}
                          {backupAssignments.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-muted-foreground">
                                No backup employees assigned
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="available" className="space-y-4 mt-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search employees..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="max-h-[400px] overflow-y-auto overscroll-contain pr-1">
                  {availableEmployees.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No available employees found</p>
                      <p className="text-sm">
                        {searchQuery
                          ? 'Try a different search term'
                          : 'No available Master employees in this agency to assign'}
                      </p>
                    </div>
                  ) : (
                    <JobEmployeesAssignableTable
                      employees={availableEmployees}
                      pendingByEmployeeId={pendingByEmployeeId}
                      assignedEmployeeIds={assignedEmployeeIds}
                      canApprove={canApprove}
                      busy={busy}
                      assigningEmployeeId={assigningEmployeeId}
                      assigningAsBackup={assigningAsBackup}
                      showBackup={job.jobType === 'external' && backupLimit > 0}
                      primaryFull={primaryAssignments.length >= primaryLimit}
                      backupFull={backupAssignments.length >= backupLimit}
                      onCall={(id) => void handleCallEmployee(id)}
                      onEmail={(email, name) => handleEmailEmployee(email, name)}
                      onAssign={(id, name, asBackup) => void handleAssignEmployee(id, name, asBackup)}
                      onDecideRequest={(requestId, name, action) =>
                        void handleDecideRequest(requestId, name, action)
                      }
                    />
                  )}
                </div>
              </TabsContent>

              <TabsContent value="all" className="space-y-4 mt-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search all agency employees..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <div className="max-h-[400px] overflow-y-auto overscroll-contain pr-1">
                  {allAgencyEmployees.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No employees found</p>
                      <p className="text-sm">
                        {searchQuery
                          ? 'Try a different search term'
                          : 'No approved Master employees for this agency'}
                      </p>
                    </div>
                  ) : (
                    <JobEmployeesAssignableTable
                      employees={allAgencyEmployees}
                      pendingByEmployeeId={pendingByEmployeeId}
                      assignedEmployeeIds={assignedEmployeeIds}
                      canApprove={canApprove}
                      busy={busy}
                      assigningEmployeeId={assigningEmployeeId}
                      assigningAsBackup={assigningAsBackup}
                      showBackup={job.jobType === 'external' && backupLimit > 0}
                      primaryFull={primaryAssignments.length >= primaryLimit}
                      backupFull={backupAssignments.length >= backupLimit}
                      onCall={(id) => void handleCallEmployee(id)}
                      onEmail={(email, name) => handleEmailEmployee(email, name)}
                      onAssign={(id, name, asBackup) => void handleAssignEmployee(id, name, asBackup)}
                      onDecideRequest={(requestId, name, action) =>
                        void handleDecideRequest(requestId, name, action)
                      }
                    />
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </DialogContent>
      </Dialog>

      {assigningEmployeeId
        ? createPortal(
            <div className="fixed inset-0 z-[410] flex flex-col items-center justify-center gap-3 bg-black/40 pointer-events-auto">
              <div className="flex flex-col items-center gap-3 rounded-xl border bg-background px-8 py-6 shadow-lg">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium text-foreground">Adding employee to job…</p>
                <p className="text-xs text-muted-foreground">Please wait</p>
              </div>
            </div>,
            document.body,
          )
        : null}

      <JobSkillMismatchDialog
        open={Boolean(skillGate)}
        onOpenChange={(next) => {
          if (!next && !assigningEmployeeId) setSkillGate(null);
        }}
        employeeName={skillGate?.employeeName ?? ''}
        missingSkills={skillGate?.missingSkills ?? []}
        busy={Boolean(assigningEmployeeId) || busy}
        onAllow={() => {
          if (!skillGate || assigningEmployeeId) return;
          const { employeeId, employeeName, asBackup } = skillGate;
          void handleAssignEmployee(employeeId, employeeName, asBackup, {
            allowSkillMismatch: true,
          });
        }}
      />

      <MoveToJobDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        assignments={selectedAssignments}
        currentJob={job}
        onComplete={clearSelection}
      />

      <JobLicenseGateDialog
        open={Boolean(licenseGate)}
        onOpenChange={(next) => {
          if (!next) setLicenseGate(null);
        }}
        jobId={job.id}
        jobTitle={job.title}
        employees={
          licenseGate ? [{ id: licenseGate.employeeId, name: licenseGate.employeeName }] : []
        }
        confirmLabel={licenseGate?.asBackup ? 'Add to Backup Pool' : 'Add as Primary'}
        busy={busy}
        onConfirm={() => {
          if (!licenseGate) return;
          const { employeeId, employeeName, asBackup, allowSkillMismatch } = licenseGate;
          void submitAssignEmployee(employeeId, employeeName, asBackup, allowSkillMismatch).then(
            () => setLicenseGate(null),
          );
        }}
      />

      <EndPlacementDialog
        open={endOpen}
        onOpenChange={(next) => {
          setEndOpen(next);
          if (!next) {
            setEndTarget(null);
            setBulkEndQueue([]);
            setPendingBlacklist(null);
          }
        }}
        target={endTarget}
        onEnded={() => {
          void refreshJobs();
          if (pendingBlacklist) {
            const { employeeId, employeeName } = pendingBlacklist;
            setPendingBlacklist(null);
            addSpecialTagViaApi(employeeId, 'blacklisted')
              .then(() => toast.success(`${employeeName} blacklisted`))
              .catch((err) =>
                toast.error(err instanceof Error ? err.message : 'Failed to blacklist'),
              );
          }
          if (endTarget) {
            setSelectedAssignmentIds((prev) => {
              const next = new Set(prev);
              const assignment = assignments.find((a) => a.employeeId === endTarget.employeeId);
              if (assignment) next.delete(assignment.id);
              return next;
            });
          }
          if (bulkEndQueue.length > 0) {
            const [next, ...rest] = bulkEndQueue;
            setBulkEndQueue(rest);
            setEndTarget(next!);
            setEndOpen(true);
          } else {
            clearSelection();
          }
        }}
      />

      {(callingEmployee || activeCall?.employee) && isCallInterfaceOpen && !isMinimized && (
        <EmployeeCallInterface
          employee={callingEmployee ?? (activeCall!.employee as Employee)}
          subCompanyId={job.agencyId}
          open={isCallInterfaceOpen && !isMinimized}
          onOpenChange={(next) => {
            if (!next) {
              if (!activeCall || activeCall.status === 'ended') {
                setCallingEmployee(null);
              }
            }
          }}
        />
      )}

      <EmailComposeDialog
        open={isEmailOpen}
        onOpenChange={(next) => {
          setIsEmailOpen(next);
          if (!next) setEmailingRecipients(null);
        }}
        fixedRecipients={emailingRecipients}
        selectedAgencyId={job.agencyId}
      />
    </>
  );
}
