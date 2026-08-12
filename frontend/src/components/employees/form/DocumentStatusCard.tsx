import { AlertTriangle, CheckCircle2, CircleDashed, Clock3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  buildDocChecklist,
  checklistItemStatus,
  summarizeDocChecklist,
  type EmployeeFormState,
} from './formTypes';

/** Live document health summary for the right panel (replaces "0/5 Documents"). */
export function DocumentStatusCard({ form }: { form: EmployeeFormState }) {
  const items = buildDocChecklist(form);
  const summary = summarizeDocChecklist(items);
  const pct = summary.total > 0 ? Math.round((summary.complete / summary.total) * 100) : 0;
  const missingLabels = items
    .filter((i) => checklistItemStatus(i) === 'missing')
    .map((i) => i.label);

  const stats = [
    { label: 'Complete', count: summary.complete, icon: CheckCircle2, className: 'text-green-600' },
    { label: 'Expiring Soon', count: summary.expiring, icon: Clock3, className: 'text-amber-600' },
    { label: 'Expired', count: summary.expired, icon: AlertTriangle, className: 'text-red-600' },
    { label: 'Missing', count: summary.missing, icon: CircleDashed, className: 'text-muted-foreground' },
  ];

  return (
    <Card className="shadow-sm border-primary/20 bg-primary/[0.03]">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">Document Status</p>
          <p className="text-xs font-semibold tabular-nums text-primary">
            {summary.complete}/{summary.total} Complete
          </p>
        </div>
        <Progress value={pct} className="h-2" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {stats.map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs">
              <s.icon className={`h-3.5 w-3.5 shrink-0 ${s.className}`} />
              <span className="text-muted-foreground flex-1">{s.label}</span>
              <span className={`font-semibold tabular-nums ${s.count > 0 ? s.className : 'text-muted-foreground/50'}`}>
                {s.count}
              </span>
            </div>
          ))}
        </div>
        {missingLabels.length > 0 && (
          <p className="text-[11px] text-muted-foreground border-t pt-2">
            Missing: {missingLabels.join(', ')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
