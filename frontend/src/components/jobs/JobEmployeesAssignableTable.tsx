/**
 * Assignable employee rows for Manage Employees — Available / All Employees tabs.
 */
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { JobAssignmentRequest } from '@/lib/jobsApi';
import { Check, Loader2, Mail, PhoneCall, ShieldCheck, Users, X } from 'lucide-react';

export type AssignableEmployeeRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone?: string | null;
  skills?: string[];
  workStatus: string | null;
  specialTags?: string[];
  /** Active placement on any client/job (not necessarily this job). */
  activeAssignmentId?: string | null;
  activeClientId?: string | null;
  activeClientName?: string | null;
  activeJobTitle?: string | null;
};

type Props = {
  employees: AssignableEmployeeRow[];
  pendingByEmployeeId: Map<string, JobAssignmentRequest>;
  assignedEmployeeIds: Set<string>;
  canApprove: boolean;
  busy: boolean;
  /** Employee currently being added to the roster (shows row spinner). */
  assigningEmployeeId?: string | null;
  assigningAsBackup?: boolean;
  showBackup: boolean;
  primaryFull: boolean;
  backupFull: boolean;
  onCall: (employeeId: string) => void;
  onEmail: (email: string | null | undefined, name: string, employeeId: string) => void;
  onAssign: (employeeId: string, name: string, asBackup: boolean) => void;
  onDecideRequest: (requestId: string, name: string, action: 'approve' | 'reject') => void;
};

export function JobEmployeesAssignableTable({
  employees,
  pendingByEmployeeId,
  assignedEmployeeIds,
  canApprove,
  busy,
  assigningEmployeeId = null,
  assigningAsBackup = false,
  showBackup,
  primaryFull,
  backupFull,
  onCall,
  onEmail,
  onAssign,
  onDecideRequest,
}: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Employee</TableHead>
          <TableHead>Skills</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-[220px]">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {employees.map((emp) => {
          const pending = pendingByEmployeeId.get(emp.id);
          const displayName = `${emp.firstName} ${emp.lastName}`.trim();
          const alreadyAssigned = assignedEmployeeIds.has(emp.id);
          const blacklisted = emp.specialTags?.includes('blacklisted');
          const placedElsewhere =
            !alreadyAssigned &&
            (emp.workStatus === 'active' ||
              emp.workStatus === 'scheduled' ||
              Boolean(emp.activeAssignmentId) ||
              Boolean(emp.activeClientId));
          const notAssignable = alreadyAssigned || blacklisted || placedElsewhere;
          const isAssigningThis = assigningEmployeeId === emp.id;
          const primaryLoading = isAssigningThis && !assigningAsBackup;
          const backupLoading = isAssigningThis && assigningAsBackup;

          return (
            <TableRow key={emp.id}>
              <TableCell>
                <div>
                  <div className="font-medium">
                    {emp.firstName} {emp.lastName}
                  </div>
                  <div className="text-xs text-muted-foreground">{emp.email}</div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {(emp.skills ?? []).slice(0, 3).map((skill) => (
                    <Badge key={skill} variant="secondary" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                  {(emp.skills ?? []).length > 3 && (
                    <Badge variant="outline" className="text-xs">
                      +{(emp.skills ?? []).length - 3}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                {alreadyAssigned ? (
                  <Badge variant="default">On this job</Badge>
                ) : blacklisted ? (
                  <Badge variant="destructive">Blacklisted</Badge>
                ) : placedElsewhere ? (
                  <Badge
                    variant="secondary"
                    className="max-w-[220px] truncate"
                    title={
                      emp.activeJobTitle
                        ? `On ${emp.activeJobTitle}`
                        : emp.activeClientName
                          ? `Placed at ${emp.activeClientName}`
                          : emp.workStatus === 'scheduled'
                            ? 'Scheduled elsewhere'
                            : 'Placed elsewhere'
                    }
                  >
                    {emp.activeJobTitle
                      ? `On ${emp.activeJobTitle}`
                      : emp.activeClientName
                        ? `Placed · ${emp.activeClientName}`
                        : emp.workStatus === 'scheduled'
                          ? 'Scheduled elsewhere'
                          : 'Placed elsewhere'}
                  </Badge>
                ) : pending ? (
                  <Badge
                    variant="outline"
                    className="bg-amber-50 text-amber-700 border-amber-200"
                  >
                    Legacy pending{pending.isBackup ? ' (backup)' : ''}
                  </Badge>
                ) : (
                  <Badge variant={emp.workStatus === 'none' ? 'outline' : 'default'}>
                    {emp.workStatus === 'none' ? 'Available' : emp.workStatus}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex gap-1 items-center">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!emp.phone?.trim()}
                          onClick={() => onCall(emp.id)}
                        >
                          <PhoneCall className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {emp.phone?.trim() ? 'Call' : 'No phone on file'}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!emp.email?.trim()}
                          onClick={() => onEmail(emp.email, displayName, emp.id)}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {emp.email?.trim() ? 'Email' : 'No email on file'}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>

                  {notAssignable ? null : pending && canApprove ? (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-green-700 hover:text-green-700"
                              onClick={() => onDecideRequest(pending.id, displayName, 'approve')}
                              disabled={busy}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Activate legacy request</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              onClick={() => onDecideRequest(pending.id, displayName, 'reject')}
                              disabled={busy}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Reject request</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </>
                  ) : (
                    <>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onAssign(emp.id, displayName, false)}
                              disabled={busy || Boolean(pending) || primaryFull}
                            >
                              {primaryLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                              ) : (
                                <ShieldCheck className="h-4 w-4 text-blue-600" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {primaryLoading
                              ? 'Adding…'
                              : pending
                                ? 'Clear legacy request first'
                                : 'Add as Primary'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {showBackup && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onAssign(emp.id, displayName, true)}
                                disabled={busy || Boolean(pending) || backupFull}
                              >
                                {backupLoading ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
                                ) : (
                                  <Users className="h-4 w-4 text-orange-500" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {backupLoading
                                ? 'Adding…'
                                : pending
                                  ? 'Clear legacy request first'
                                  : 'Add to Backup Pool'}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
