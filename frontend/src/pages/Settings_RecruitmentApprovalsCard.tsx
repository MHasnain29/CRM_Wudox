import { useEffect, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

/**
 * Recruitment-side approval flow — UI demo only (not enforced by the API).
 * One flow covers employee add / client assignment preview; default approver
 * is Recruitment Manager. Stored in localStorage.
 */

const DEFAULT_APPROVER = 'recruitment_manager';

const APPROVER_ROLES: { key: string; name: string }[] = [
  { key: 'recruitment_manager', name: 'Recruitment Manager' },
  { key: 'sr_recruiter', name: 'Sr. Recruiter' },
  { key: 'operations_manager', name: 'Operations Manager' },
  { key: 'company_director', name: 'Company Director' },
  { key: 'director', name: 'Director' },
];

const COVERED_ACTIONS = [
  'New employee application',
  'Employee edits',
  'Client assignment',
  'Document updates',
];

type RecruitmentApprovalsState = { requireApproval: boolean; approver: string };

const STORAGE_KEY = 'recruitment-approvals-ui';

const defaultState = (): RecruitmentApprovalsState => ({
  requireApproval: true,
  approver: DEFAULT_APPROVER,
});

function loadState(): RecruitmentApprovalsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<RecruitmentApprovalsState>;
    if (typeof parsed.requireApproval !== 'boolean' || typeof parsed.approver !== 'string') {
      return defaultState();
    }
    return { requireApproval: parsed.requireApproval, approver: parsed.approver };
  } catch {
    return defaultState();
  }
}

const roleName = (key: string) => APPROVER_ROLES.find((r) => r.key === key)?.name ?? key;

export function RecruitmentApprovalsCard() {
  const [state, setState] = useState<RecruitmentApprovalsState>(loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* non-critical */
    }
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Briefcase className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Recruitment approvals</CardTitle>
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px]">
            UI demo — not enforced
          </Badge>
        </div>
        <CardDescription>
          Preview of recruitment approval settings. By default, requests would route to the
          Recruitment Manager. This card is demo-only and is not wired to the backend.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">Employee changes</p>
              <p className="text-xs text-muted-foreground">
                {state.requireApproval
                  ? `Demo: requests would go to ${roleName(state.approver)}.`
                  : 'Demo: no approval — actions would apply immediately.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="rec-require-approval" className="text-sm text-muted-foreground">
                Require approval
              </Label>
              <Switch
                id="rec-require-approval"
                checked={state.requireApproval}
                onCheckedChange={(v) => setState((prev) => ({ ...prev, requireApproval: v }))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {COVERED_ACTIONS.map((action) => (
              <Badge key={action} variant="secondary" className="text-xs font-normal">
                {action}
              </Badge>
            ))}
          </div>

          {state.requireApproval && (
            <div className="space-y-1.5 pt-1">
              <Label className="text-xs text-muted-foreground">Approver role</Label>
              <Select
                value={state.approver}
                onValueChange={(v) => setState((prev) => ({ ...prev, approver: v }))}
              >
                <SelectTrigger className="w-full max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPROVER_ROLES.map((r) => (
                    <SelectItem key={r.key} value={r.key}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
