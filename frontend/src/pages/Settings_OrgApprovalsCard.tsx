import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchOrgApprovalPolicy,
  updateOrgApprovalPolicy,
  resetOrgApprovalPolicyToDefaults,
  ORG_APPROVAL_WORKFLOW_TYPES,
  type OrgApprovalPolicyData,
  type OrgApprovalWorkflowType,
  type WorkflowPolicyConfig,
} from '@/lib/api';

const ORG_ROLE_OPTIONS = [
  { key: 'director', name: 'Director' },
  { key: 'operations_manager', name: 'Operations Manager' },
];

const DEFAULT_ROUTE = ['director'] as const;

const ORG_WORKFLOW_LABELS: Record<OrgApprovalWorkflowType, string> = {
  database_client_add: 'Global database — manual add',
  database_client_import: 'Global database — CSV import',
  database_contact_import: 'Global database — contact CSV import',
};

type Props = { isActive?: boolean };

function buildRoutePreview(route: string[]): string {
  if (!route.length) return 'Not configured';
  return route
    .map((k, i) => {
      const label = ORG_ROLE_OPTIONS.find((r) => r.key === k)?.name ?? k;
      return i === route.length - 1 ? `${label} approves` : `${label} forwards`;
    })
    .join(' → ');
}

export function SettingsOrgApprovalsCard({ isActive = true }: Props) {
  const [policy, setPolicy] = useState<OrgApprovalPolicyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setLoading(true);
    fetchOrgApprovalPolicy()
      .then((data) => { if (!cancelled) setPolicy(data); })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Failed to load org approvals'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isActive]);

  const updateWorkflow = (workflow: OrgApprovalWorkflowType, cfg: WorkflowPolicyConfig) => {
    if (!policy) return;
    setPolicy({ ...policy, workflows: { ...policy.workflows, [workflow]: cfg } });
  };

  const setRequireApproval = (workflow: OrgApprovalWorkflowType, require: boolean) => {
    if (!policy) return;
    const current = policy.workflows[workflow];
    if (!require) {
      updateWorkflow(workflow, { mode: 'bypass' });
      return;
    }
    const route =
      current.mode === 'route' && current.route.length > 0 ? current.route : [...DEFAULT_ROUTE];
    updateWorkflow(workflow, { mode: 'route', route });
  };

  const handleSave = async () => {
    if (!policy) return;
    setSaving(true);
    try {
      const saved = await updateOrgApprovalPolicy({
        workflows: policy.workflows,
        databaseImportDestination: policy.databaseImportDestination,
        superUserClientDestination: policy.superUserClientDestination,
      });
      setPolicy(saved);
      toast.success('Global database approval settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      const saved = await resetOrgApprovalPolicyToDefaults();
      setPolicy(saved);
      toast.success('Restored org defaults');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed');
    } finally {
      setSaving(false);
    }
  };

  const addPreview = useMemo(() => {
    if (!policy) return '';
    const wf = policy.workflows.database_client_add;
    if (wf.mode === 'bypass') return 'Direct add — no approval';
    if (wf.mode !== 'route' || !wf.route.length) return 'Not configured';
    return buildRoutePreview(wf.route);
  }, [policy]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Global Database</CardTitle>
        <CardDescription>
          How Database Manager client adds are handled org-wide (not per agency). Manual add preview: {addPreview}.
          Global mode uses the queues below; agency mode lets the Database Manager pick an agency on each add/import
          (Client Visibility applies).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading || !policy ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="rounded-lg border p-4 space-y-3">
              <div>
                <p className="font-medium text-sm">Database Manager — add &amp; import destination</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Controls which upload paths Database Manager may use. Global or agency only = fixed path.
                  Both = Database Manager chooses global or agency on each CSV import and Add Client.
                </p>
              </div>
              <RadioGroup
                value={policy.databaseImportDestination}
                onValueChange={(v) =>
                  setPolicy({ ...policy, databaseImportDestination: v as 'global' | 'agency' | 'both' })
                }
                className="space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="global" id="db-dest-global" className="mt-0.5" />
                  <Label htmlFor="db-dest-global" className="font-normal cursor-pointer leading-snug">
                    Global database
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="agency" id="db-dest-agency" className="mt-0.5" />
                  <Label htmlFor="db-dest-agency" className="font-normal cursor-pointer leading-snug">
                    Agency only (Client Visibility — agency chosen per add/import)
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="both" id="db-dest-both" className="mt-0.5" />
                  <Label htmlFor="db-dest-both" className="font-normal cursor-pointer leading-snug">
                    Both — ask global or agency on each add/import
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="rounded-lg border p-4 space-y-3">
              <div>
                <p className="font-medium text-sm">Super Users — add &amp; import destination</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Applies to Super Admin, Director, Company Director, and Operations Manager on Add Client and CSV
                  import. Agency path uses Client Visibility (Settings → Client Visibility) before org-wide sharing.
                  Global path uses the global database queue above.
                </p>
              </div>
              <RadioGroup
                value={policy.superUserClientDestination}
                onValueChange={(v) =>
                  setPolicy({ ...policy, superUserClientDestination: v as 'global' | 'agency' | 'both' })
                }
                className="space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="global" id="su-dest-global" className="mt-0.5" />
                  <Label htmlFor="su-dest-global" className="font-normal cursor-pointer leading-snug">
                    Global database
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="agency" id="su-dest-agency" className="mt-0.5" />
                  <Label htmlFor="su-dest-agency" className="font-normal cursor-pointer leading-snug">
                    Agency only (Client Visibility — agency chosen per add/import when Both is off)
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="both" id="su-dest-both" className="mt-0.5" />
                  <Label htmlFor="su-dest-both" className="font-normal cursor-pointer leading-snug">
                    Both — ask global or agency on each add/import
                  </Label>
                </div>
              </RadioGroup>
            </div>
            {ORG_APPROVAL_WORKFLOW_TYPES.map((workflow) => {
              const cfg = policy.workflows[workflow];
              const requiresApproval = cfg.mode === 'route';
              const route = cfg.mode === 'route' ? cfg.route : [...DEFAULT_ROUTE];
              return (
                <div key={workflow} className="rounded-lg border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-sm">{ORG_WORKFLOW_LABELS[workflow]}</p>
                      <p className="text-xs text-muted-foreground">
                        {requiresApproval
                          ? buildRoutePreview(route)
                          : 'Direct add — global database immediately; Client Visibility delay does not apply'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`org-require-${workflow}`} className="text-sm text-muted-foreground">
                        Require approval
                      </Label>
                      <Switch
                        id={`org-require-${workflow}`}
                        checked={requiresApproval}
                        onCheckedChange={(v) => setRequireApproval(workflow, v)}
                      />
                    </div>
                  </div>
                  {requiresApproval && (
                    <div className="flex flex-wrap items-center gap-2 pl-1">
                      {route.map((roleKey, index) => (
                        <div key={`${workflow}-${index}`} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Step {index + 1}</span>
                          <Select
                            value={roleKey}
                            onValueChange={(v) => {
                              const next = [...route];
                              next[index] = v;
                              updateWorkflow(workflow, { mode: 'route', route: next });
                            }}
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ORG_ROLE_OPTIONS.map((r) => (
                                <SelectItem key={r.key} value={r.key}>{r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                      {route.length < 2 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const other = route[0] === 'director' ? 'operations_manager' : 'director';
                            updateWorkflow(workflow, { mode: 'route', route: [...route, other] });
                          }}
                        >
                          Add step
                        </Button>
                      )}
                      {route.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => updateWorkflow(workflow, { mode: 'route', route: route.slice(0, 1) })}
                        >
                          Remove second step
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save global settings
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={saving} className="gap-2">
                <RotateCcw className="h-4 w-4" />
                Reset defaults
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
