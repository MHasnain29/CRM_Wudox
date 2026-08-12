/**
 * Full employment / assignment history for an employee (recruitment demo).
 */
import { useEffect, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchEmployeeAssignments } from '@/lib/api';
import {
  PLACEMENT_END_REASON_LABELS,
  type EmployeeAssignment,
  type PlacementEndReason,
} from '@/lib/employeeTypes';
import { toast } from 'sonner';
import { ViewActiveClientButton } from './ViewActiveClientButton';

type Props = {
  employeeId: string;
  enabled?: boolean;
  refreshKey?: number;
};

function statusVariant(
  status: EmployeeAssignment['status'],
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'approved') return 'default';
  if (status === 'pending') return 'secondary';
  if (status === 'rejected') return 'destructive';
  return 'outline';
}

function labelFor(a: EmployeeAssignment): string {
  if (a.targetType === 'job' || a.jobTitle) {
    const job = a.jobTitle ?? a.jobId ?? 'Job';
    const client = a.clientName ?? a.jobCompany;
    return client ? `${job} · ${client}` : job;
  }
  return a.positionTitle
    ? `${a.clientName ?? a.clientId ?? 'Client'} — ${a.positionTitle}`
    : (a.clientName ?? a.clientId ?? 'Client');
}

export function EmploymentHistoryPanel({
  employeeId,
  enabled = true,
  refreshKey = 0,
}: Props) {
  const [assignments, setAssignments] = useState<EmployeeAssignment[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    void fetchEmployeeAssignments(employeeId)
      .then((rows) => {
        if (!cancelled) setAssignments(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : 'Failed to load history');
          setAssignments([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, enabled, refreshKey]);

  if (!enabled) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Employment history</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </p>
        ) : assignments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No placements yet.</p>
        ) : (
          assignments.map((a) => (
            <div key={a.id} className="rounded border px-3 py-2 space-y-1.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">{labelFor(a)}</p>
                  <p className="text-muted-foreground">
                    {a.targetType === 'job' ? 'Job placement' : 'Client link'}
                    {a.positionTitle ? ` · ${a.positionTitle}` : ''}
                  </p>
                </div>
                <Badge variant={statusVariant(a.status)} className="shrink-0 capitalize">
                  {a.status}
                  {a.isActive ? ' · active' : ''}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
                {a.workLocation && (
                  <span>
                    Location: <span className="text-foreground">{a.workLocation}</span>
                  </span>
                )}
                {a.payRate && (
                  <span>
                    Pay: <span className="text-foreground">{a.payRate}</span>
                  </span>
                )}
                {a.shiftSchedule && (
                  <span className="col-span-2">
                    Shift: <span className="text-foreground">{a.shiftSchedule}</span>
                  </span>
                )}
                {a.supervisorInfo && (
                  <span className="col-span-2">
                    Supervisor: <span className="text-foreground">{a.supervisorInfo}</span>
                  </span>
                )}
                <span>
                  Started:{' '}
                  <span className="text-foreground">
                    {new Date(a.approvedAt ?? a.submittedAt).toLocaleDateString()}
                  </span>
                </span>
                {a.endedAt && (
                  <span>
                    Ended:{' '}
                    <span className="text-foreground">
                      {new Date(a.endedAt).toLocaleDateString()}
                    </span>
                  </span>
                )}
              </div>

              {(a.activeClientId ?? a.clientId) && (
                <ViewActiveClientButton
                  clientId={(a.activeClientId ?? a.clientId)!}
                  clientName={a.clientName ?? a.jobCompany}
                  label="View client"
                  className="w-full"
                />
              )}

              {a.status === 'ended' && (
                <div className="rounded bg-muted/50 px-2 py-1.5 space-y-1">
                  {a.endReason && (
                    <p>
                      End reason:{' '}
                      <span className="font-medium text-foreground">
                        {PLACEMENT_END_REASON_LABELS[a.endReason as PlacementEndReason] ??
                          a.endReason}
                      </span>
                    </p>
                  )}
                  {a.rating != null && a.rating > 0 && (
                    <div className="flex items-center gap-1">
                      <span>Rating:</span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`h-3.5 w-3.5 ${
                            n <= (a.rating ?? 0)
                              ? 'fill-amber-400 text-amber-400'
                              : 'text-muted-foreground/40'
                          }`}
                        />
                      ))}
                      <span className="text-foreground">{a.rating}/5</span>
                    </div>
                  )}
                  {a.endNotes && (
                    <p className="text-muted-foreground">
                      Notes: <span className="text-foreground">{a.endNotes}</span>
                    </p>
                  )}
                </div>
              )}

              {a.rejectionReason && (
                <p className="text-muted-foreground">
                  Rejection: <span className="text-foreground">{a.rejectionReason}</span>
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
