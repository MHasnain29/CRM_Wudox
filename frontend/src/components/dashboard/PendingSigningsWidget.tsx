/**
 * Pending Signings widget — onboarding agreements sent via PandaDoc that are
 * still awaiting the employee's signature. Shared by the Recruitment Manager
 * and Recruiter dashboards (data comes from GET /dashboard/recruitment).
 */
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { FileSignature } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { PendingSigning } from '@/lib/recruitmentDashboardApi';

const STATUS_CLASS: Record<string, string> = {
  sent: 'bg-amber-50 text-amber-700 border-amber-200',
  viewed: 'bg-blue-50 text-blue-700 border-blue-200',
  draft: 'bg-slate-50 text-slate-700 border-slate-200',
};

function statusLabel(status: string | null): string {
  if (!status) return 'sent';
  return status.replace(/^document\./, '');
}

export function PendingSigningsWidget({ items }: { items: PendingSigning[] }) {
  const navigate = useNavigate();

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-muted-foreground" />
            Pending Signings
            {items.length > 0 && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                {items.length}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Onboarding agreements awaiting employee signature</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/employees')}>
          Employees
        </Button>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No agreements awaiting signature.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground border-b">
                <th className="pb-2 font-medium">Employee</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Sent by</th>
                <th className="pb-2 font-medium">Sent</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map((s) => {
                const label = statusLabel(s.status);
                return (
                  <tr
                    key={s.id}
                    className="border-b last:border-0 cursor-pointer hover:bg-muted/40"
                    onClick={() => navigate('/employees')}
                  >
                    <td className="py-3">
                      <span className="font-medium">{s.name}</span>
                      {s.email && (
                        <span className="block text-xs text-muted-foreground">{s.email}</span>
                      )}
                    </td>
                    <td className="py-3">
                      <Badge
                        variant="outline"
                        className={STATUS_CLASS[label] ?? 'bg-amber-50 text-amber-700 border-amber-200'}
                      >
                        {label}
                      </Badge>
                    </td>
                    <td className="py-3">{s.addedByName}</td>
                    <td className="py-3 text-muted-foreground whitespace-nowrap">
                      {s.sentAt ? formatDistanceToNow(parseISO(s.sentAt), { addSuffix: true }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
