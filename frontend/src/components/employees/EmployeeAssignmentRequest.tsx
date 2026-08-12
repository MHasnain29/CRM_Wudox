/**
 * Client + Job assignment request — Active Clients, job picker, approval chain.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  createEmployeeAssignmentRequest,
  fetchEmployee,
  fetchEmployeeAssignments,
  postApprovalAction,
} from '@/lib/api';
import { fetchJob } from '@/lib/jobsApi';
import { usePermission } from '@/hooks/usePermission';
import type { EmployeeAssignment } from '@/lib/employeeTypes';
import {
  AssignmentDetailsFields,
  AssignmentDetailsSummary,
  EMPTY_ASSIGNMENT_DETAILS,
  type AssignmentDetailsForm,
} from './AssignmentDetailsFields';
import { LinkClientJobFields } from './LinkClientJobFields';
import { EmploymentHistoryPanel } from './EmploymentHistoryPanel';
import { JobLicenseRequirementPanel } from './JobLicenseRequirementPanel';
import { ViewActiveClientButton } from './ViewActiveClientButton';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import {
  JobSkillMismatchDialog,
  missingRequiredSkills,
} from '@/components/jobs/JobSkillMismatchDialog';
type Props = {
  employeeId: string;
  enabled: boolean;
  subCompanyId?: string | null;
  /** When false, hide the create form (e.g. already placed) but still show pending/history. */
  allowCreate?: boolean;
  /** Shown when create is blocked because employee is already placed. */
  placedMessage?: string | null;
  /** Hide outer card title when embedded in a dialog that already has one. */
  embedded?: boolean;
  onChanged?: () => void;
  /** Prefill client/job when opened from Job Matches board. */
  initialClientId?: string;
  initialJobId?: string;
};

function assignmentLabel(a: EmployeeAssignment): string {
  if (a.jobTitle || a.targetType === 'job') {
    const job = a.jobTitle ?? a.jobId ?? 'Job';
    const client = a.clientName ?? a.jobCompany;
    return client ? `${job} · ${client}` : job;
  }
  return a.positionTitle
    ? `${a.clientName ?? a.clientId ?? 'Client'} — ${a.positionTitle}`
    : (a.clientName ?? a.clientId ?? 'Client');
}

function detailsComplete(d: AssignmentDetailsForm): boolean {
  return Boolean(
    d.workLocation.trim() &&
      d.positionTitle.trim() &&
      d.payRate.trim() &&
      d.shiftSchedule.trim() &&
      d.supervisorInfo.trim() &&
      d.requiredPpe.trim(),
  );
}

export function EmployeeAssignmentRequest({
  employeeId,
  enabled,
  subCompanyId,
  allowCreate = true,
  placedMessage = null,
  embedded = false,
  onChanged,
  initialClientId,
  initialJobId,
}: Props) {
  const canWrite = usePermission('employees:write');
  const canApprove = usePermission('employees:approve');
  const { agencyId: scopeAgencyId } = useRecruitmentAgencyId();
  const linkAgencyId = subCompanyId || scopeAgencyId || null;
  const [assignments, setAssignments] = useState<EmployeeAssignment[]>([]);
  const [clientId, setClientId] = useState('');
  const [jobId, setJobId] = useState('');
  const [details, setDetails] = useState<AssignmentDetailsForm>(EMPTY_ASSIGNMENT_DETAILS);
  const [licensesOk, setLicensesOk] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const [jobRequiredSkills, setJobRequiredSkills] = useState<string[]>([]);
  const [employeeSkills, setEmployeeSkills] = useState<string[]>([]);
  const [employeeDisplayName, setEmployeeDisplayName] = useState('Employee');
  const [skillMismatchOpen, setSkillMismatchOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const rows = await fetchEmployeeAssignments(employeeId);
      setAssignments(rows);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load assignments');
      setAssignments([]);
    } finally {
      setLoading(false);
    }
  }, [employeeId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled || !employeeId) return;
    let cancelled = false;
    fetchEmployee(employeeId)
      .then((emp) => {
        if (cancelled) return;
        setEmployeeSkills(emp.skills ?? []);
        setEmployeeDisplayName(`${emp.firstName} ${emp.lastName}`.trim() || 'Employee');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, employeeId]);

  // Prefill details from selected job
  useEffect(() => {
    // No job selected → no license requirement to satisfy.
    if (!jobId) {
      setLicensesOk(true);
      setJobRequiredSkills([]);
      return;
    }
    let cancelled = false;
    fetchJob(jobId)
      .then((job) => {
        if (cancelled) return;
        setJobRequiredSkills(job.screeningCriteria?.requiredSkills ?? []);
        setDetails((prev) => ({
          ...prev,
          workLocation: prev.workLocation || job.location,
          positionTitle: prev.positionTitle || job.title,
          payRate:
            prev.payRate ||
            (job.salaryMin != null
              ? `$${job.salaryMin}${job.salaryMax != null ? `–$${job.salaryMax}` : ''}/hr`
              : prev.payRate),
          shiftSchedule:
            prev.shiftSchedule ||
            `${job.shiftSchedule.startTime}–${job.shiftSchedule.endTime} · ${job.shiftSchedule.workDays
              .slice(0, 5)
              .join(', ')}`,
        }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (!enabled) return null;

  const submitAssignment = async (allowSkillMismatch?: boolean) => {
    setBusyId('create');
    try {
      const { assignment: request, clientTraining, assignmentEmail } =
        await createEmployeeAssignmentRequest(
        employeeId,
        {
          targetType: 'job',
          activeClientId: clientId,
          jobId,
          allowSkillMismatch: allowSkillMismatch || undefined,
          workLocation: details.workLocation.trim(),
          positionTitle: details.positionTitle.trim(),
          payRate: details.payRate.trim(),
          shiftSchedule: details.shiftSchedule.trim(),
          expectedDuration: details.expectedDuration.trim() || null,
          supervisorInfo: details.supervisorInfo.trim(),
          requiredPpe: details.requiredPpe.trim(),
          workplaceHazards: details.workplaceHazards.trim() || null,
        },
      );
      setClientId('');
      setJobId('');
      setDetails(EMPTY_ASSIGNMENT_DETAILS);
      setSkillMismatchOpen(false);
      toast.success(
        request.status === 'approved'
          ? 'Employee added to job roster'
          : 'Assignment submitted for approval',
      );
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
      await refresh();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit assignment');
    } finally {
      setBusyId(null);
    }
  };

  const handleSubmit = async () => {
    if (!canWrite) return;
    if (!clientId) {
      toast.error('Select an active client');
      return;
    }
    if (!jobId) {
      toast.error('Select a job for this client');
      return;
    }
    if (!detailsComplete(details)) {
      toast.error('Fill in all required assignment details');
      return;
    }
    if (!licensesOk) {
      toast.error('Upload a valid license for every type this job requires');
      return;
    }
    const missing = missingRequiredSkills(employeeSkills, jobRequiredSkills);
    if (missing.length > 0) {
      setSkillMismatchOpen(true);
      return;
    }
    await submitAssignment();
  };

  const skillMismatchMissing = missingRequiredSkills(employeeSkills, jobRequiredSkills);

  const handleDecision = async (id: string, action: 'approve' | 'reject') => {
    if (!canApprove) return;
    setBusyId(id);
    try {
      await postApprovalAction('employee_assignment', id, action, {
        subCompanyId: linkAgencyId ?? undefined,
        remarks: action === 'reject' ? 'Rejected from employee details' : undefined,
      });
      toast.success(action === 'approve' ? 'Assignment approved — placed on job' : 'Assignment rejected');
      await refresh();
      onChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  };

  const creating = busyId === 'create';
  const activePlacements = assignments.filter((a) => a.status === 'approved' && a.isActive);
  const pendingOrActive = assignments.filter(
    (a) => a.status === 'pending' || (a.status === 'approved' && a.isActive),
  );
  // Defense in depth: block create if live assignment list already has an active placement.
  const canCreate = allowCreate && activePlacements.length === 0;
  const blockMessage =
    placedMessage ||
    (allowCreate && activePlacements.length > 0
      ? 'This employee already has an active placement. End that placement or use Move to Job before linking again.'
      : !allowCreate
        ? 'This employee already has an active placement. End that placement or use Move to Job before linking again.'
        : null);

  return (
    <div className="relative space-y-4">
      <Card>
        {!embedded && (
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Link to Client & Job
            </CardTitle>
            <CardDescription>
              Select an Active Client and the job to place on. Job placements are added to the roster
              immediately (no manager approval).
            </CardDescription>
          </CardHeader>
        )}
        <CardContent className={embedded ? 'pt-4 space-y-3' : 'space-y-3'}>
          {canWrite && canCreate && (
            <div className="space-y-3 rounded-md border p-3">
              <LinkClientJobFields
                employeeId={employeeId}
                clientId={clientId}
                jobId={jobId}
                onClientChange={setClientId}
                onJobChange={setJobId}
                agencyId={linkAgencyId}
                disabled={creating}
                initialClientId={initialClientId}
                initialJobId={initialJobId}
              />
              {jobId && (
                <JobLicenseRequirementPanel
                  employeeId={employeeId}
                  jobId={jobId}
                  disabled={creating}
                  onValidityChange={setLicensesOk}
                />
              )}
              <AssignmentDetailsFields
                value={details}
                onChange={setDetails}
                disabled={creating}
              />
              <Button
                onClick={() => void handleSubmit()}
                className="w-full"
                disabled={
                  creating || !clientId || !jobId || !detailsComplete(details) || !licensesOk
                }
              >
                {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Add to job roster
              </Button>
            </div>
          )}

          {canWrite && !canCreate && blockMessage && (
            <div className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
              {blockMessage}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Open requests</p>
            {loading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </p>
            ) : pendingOrActive.length === 0 ? (
              <p className="text-xs text-muted-foreground">No open assignment requests.</p>
            ) : (
              pendingOrActive.map((a) => {
                const linkedClientId = a.activeClientId ?? a.clientId ?? null;
                return (
                <div key={a.id} className="rounded border px-2 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {a.targetType === 'client' ? 'Client' : 'Job'}: {assignmentLabel(a)}
                    </span>
                    <Badge
                      variant={
                        a.status === 'approved'
                          ? 'default'
                          : a.status === 'pending'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {a.status}
                      {a.isActive ? ' · active' : ''}
                    </Badge>
                  </div>
                  <AssignmentDetailsSummary
                    assignment={{
                      clientName: a.clientName ?? a.jobCompany ?? null,
                      workLocation: a.workLocation ?? '',
                      positionTitle: a.positionTitle ?? '',
                      payRate: a.payRate ?? '',
                      shiftSchedule: a.shiftSchedule ?? '',
                      expectedDuration: a.expectedDuration ?? '',
                      supervisorInfo: a.supervisorInfo ?? '',
                      requiredPpe: a.requiredPpe ?? '',
                      workplaceHazards: a.workplaceHazards ?? '',
                    }}
                  />
                  {linkedClientId && (
                    <ViewActiveClientButton
                      clientId={linkedClientId}
                      clientName={a.clientName ?? a.jobCompany}
                      label="View client"
                      className="w-full"
                    />
                  )}
                  {a.detailsSentToCandidateAt && (
                    <p className="text-xs text-muted-foreground">
                      Details sent · {new Date(a.detailsSentToCandidateAt).toLocaleString()}
                    </p>
                  )}
                  {a.status === 'pending' && canApprove && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={busyId === a.id || !a.detailsSentToCandidateAt}
                        onClick={() => void handleDecision(a.id, 'approve')}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        disabled={busyId === a.id}
                        onClick={() => void handleDecision(a.id, 'reject')}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <EmploymentHistoryPanel
        employeeId={employeeId}
        enabled
        refreshKey={historyKey}
      />

      <JobSkillMismatchDialog
        open={skillMismatchOpen}
        onOpenChange={setSkillMismatchOpen}
        employeeName={employeeDisplayName}
        missingSkills={skillMismatchMissing}
        busy={busyId === 'create'}
        onAllow={() => void submitAssignment(true)}
      />
    </div>
  );
}
