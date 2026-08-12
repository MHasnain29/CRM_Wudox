import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Plus, X, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchApprovalPolicy,
  updateApprovalPolicy,
  resetApprovalPolicyToDefaults,
  type ApprovalPolicyData,
  type ApprovalWorkflowType,
  type WorkflowPolicyConfig,
} from '@/lib/api';
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
import { useApprovalMetadata } from '@/hooks/useApprovalMetadata';
import {
  buildParentKeyMap,
  findNextSeniorRoleKey,
  getValidRolesForRouteStep,
  validateAllWorkflowRoutes,
  validateApprovalRouteHierarchy,
  type RoleHierarchyNode,
} from '@/lib/approvalRouteValidation';

type Props = {
  subCompanyId?: string;
  isActive?: boolean;
};

const DEFAULT_ROUTE = ['sales_manager'];

const APPROVAL_WORKFLOW_GROUPS: {
  title: string;
  description?: string;
  workflows: ApprovalWorkflowType[];
}[] = [
  {
    title: 'Clients',
    workflows: ['client_manual_add', 'client_manual_edit', 'client_import', 'contact_import'],
  },
  {
    title: 'Leads',
    description: 'Reassignments are approved from Leads → Reassignments.',
    workflows: ['lead_request', 'lead_extension', 'lead_reassignment'],
  },
  {
    title: 'Proposals',
    workflows: ['proposal_review', 'proposal_extension'],
  },
  {
    title: 'Recruitment',
    description: 'Employee registration and client placement approvals.',
    workflows: ['employee_add', 'employee_assignment'],
  },
];

function getRoute(cfg: WorkflowPolicyConfig): string[] {
  return cfg.mode === 'route' ? cfg.route : [];
}

function roleName(roles: { key: string; name: string }[], key: string): string {
  return roles.find((r) => r.key === key)?.name ?? key.replace(/_/g, ' ');
}

function buildRoutePreview(route: string[], roles: { key: string; name: string }[]): string {
  if (route.length === 0) return 'No roles selected';
  return route
    .map((key, i) => {
      const label = roleName(roles, key);
      return i === route.length - 1 ? `${label} approves` : `${label} forwards`;
    })
    .join(' → ');
}

export function SettingsApprovalsTab({ subCompanyId, isActive = true }: Props) {
  const { metadata, loading: metadataLoading, error: metadataError } = useApprovalMetadata({
    enabled: isActive,
  });
  const [policy, setPolicy] = useState<ApprovalPolicyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const assignableRoles = metadata?.assignableRoles ?? [];

  const hierarchyRoles = useMemo<RoleHierarchyNode[]>(
    () =>
      assignableRoles.map((r) => ({
        key: r.key,
        name: r.name,
        parentKey: r.parentKey ?? null,
      })),
    [assignableRoles],
  );

  const updateWorkflow = (workflow: ApprovalWorkflowType, cfg: WorkflowPolicyConfig) => {
    if (!policy) return;
    setPolicy({
      ...policy,
      workflows: { ...policy.workflows, [workflow]: cfg },
    });
  };

  const applyRoute = (
    workflow: ApprovalWorkflowType,
    route: string[],
    options?: { silent?: boolean },
  ): boolean => {
    const issues = validateApprovalRouteHierarchy(route, hierarchyRoles);
    if (issues.length > 0) {
      if (!options?.silent) toast.error(issues[0].message);
      return false;
    }
    updateWorkflow(workflow, { mode: 'route', route });
    return true;
  };

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchApprovalPolicy(subCompanyId ? { subCompanyId } : undefined)
      .then((data) => {
        if (!cancelled) setPolicy(data);
      })
      .catch((e) => {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Failed to load approval policy';
          setLoadError(message);
          setPolicy(null);
          toast.error(message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [subCompanyId, isActive]);

  const setRequireApproval = (workflow: ApprovalWorkflowType, require: boolean) => {
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

  const setRouteRole = (workflow: ApprovalWorkflowType, index: number, roleKey: string) => {
    if (!policy) return;
    const cfg = policy.workflows[workflow];
    if (cfg.mode !== 'route') return;
    const route = [...cfg.route];
    route[index] = roleKey;
    applyRoute(workflow, route);
  };

  const addRouteStep = (workflow: ApprovalWorkflowType) => {
    if (!policy) return;
    const cfg = policy.workflows[workflow];
    if (cfg.mode !== 'route' || cfg.route.length >= 5) return;
    const parentByKey = buildParentKeyMap(hierarchyRoles);
    const lastKey = cfg.route[cfg.route.length - 1];
    const nextKey = lastKey ? findNextSeniorRoleKey(lastKey, cfg.route, parentByKey) : null;
    if (!nextKey) {
      toast.error(
        'No higher role available for the next step. Add a parent role under Settings → Roles, or reorder the route.',
      );
      return;
    }
    applyRoute(workflow, [...cfg.route, nextKey]);
  };

  const removeRouteStep = (workflow: ApprovalWorkflowType, index: number) => {
    if (!policy) return;
    const cfg = policy.workflows[workflow];
    if (cfg.mode !== 'route' || cfg.route.length <= 1) return;
    updateWorkflow(workflow, {
      mode: 'route',
      route: cfg.route.filter((_, i) => i !== index),
    });
  };

  const moveRouteStep = (workflow: ApprovalWorkflowType, index: number, dir: -1 | 1) => {
    if (!policy) return;
    const cfg = policy.workflows[workflow];
    if (cfg.mode !== 'route') return;
    const next = index + dir;
    if (next < 0 || next >= cfg.route.length) return;
    const route = [...cfg.route];
    [route[index], route[next]] = [route[next], route[index]];
    applyRoute(workflow, route);
  };

  const handleSave = async () => {
    if (!policy) return;
    const hierarchyIssues = validateAllWorkflowRoutes(policy.workflows, hierarchyRoles);
    if (hierarchyIssues.length > 0) {
      toast.error(hierarchyIssues[0].message);
      return;
    }
    setSaving(true);
    try {
      const saved = await updateApprovalPolicy({
        subCompanyId,
        allowLeadSelfAssign: policy.allowLeadSelfAssign,
        workflows: policy.workflows,
      });
      setPolicy(saved);
      toast.success('Approval workflows saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    setRestoring(true);
    try {
      const restored = await resetApprovalPolicyToDefaults(
        subCompanyId ? { subCompanyId } : undefined,
      );
      setPolicy(restored);
      setRestoreOpen(false);
      toast.success('Approval workflows restored to defaults');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const showLoading = loading || metadataLoading;
  const showError = loadError || metadataError;

  const roleOptions = useMemo(
    () => assignableRoles.sort((a, b) => a.name.localeCompare(b.name)),
    [assignableRoles],
  );

  const workflowMetaByKey = useMemo(
    () => new Map(metadata?.workflows.map((w) => [w.workflow, w]) ?? []),
    [metadata?.workflows],
  );

  const renderWorkflowCard = (wf: ApprovalWorkflowType) => {
    if (!policy) return null;
    const cfg = policy.workflows[wf];
    if (!cfg) return null;
    const wfMeta = workflowMetaByKey.get(wf);
    const label =
      wfMeta?.label ??
      (wf === 'lead_reassignment' ? 'Lead reassignments' : wf.replace(/_/g, ' '));
    const requiresApproval = cfg.mode === 'route';
    const route = getRoute(cfg);
    const parentByKey = buildParentKeyMap(hierarchyRoles);
    const canAddSeniorStep =
      route.length < 5 &&
      route.length > 0 &&
      !!findNextSeniorRoleKey(route[route.length - 1], route, parentByKey);
    const permHint = wfMeta
      ? `${wfMeta.forwardPermission} (forward) · ${wfMeta.finalPermission}${
          wfMeta.finalPermissionFallback ? ` / ${wfMeta.finalPermissionFallback}` : ''
        } (final)`
      : null;

    return (
      <div key={wf} className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">
              {requiresApproval
                ? buildRoutePreview(route, roleOptions)
                : 'No approval — action applies immediately when allowed'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={`require-${wf}`} className="text-sm text-muted-foreground">
              Require approval
            </Label>
            <Switch
              id={`require-${wf}`}
              checked={requiresApproval}
              onCheckedChange={(v) => setRequireApproval(wf, v)}
            />
          </div>
        </div>

        {requiresApproval && (
          <div className="space-y-2 pl-1">
            {permHint && (
              <p className="text-xs text-muted-foreground">
                Permissions for roles in this route: {permHint}
                </p>
            )}
            {route.map((roleKey, index) => {
              const isLast = index === route.length - 1;
              const stepRoleOptions = getValidRolesForRouteStep(route, index, hierarchyRoles);
              return (
                <div key={`${wf}-${index}`} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground w-14 shrink-0">Step {index + 1}</span>
                  <Select value={roleKey} onValueChange={(v) => setRouteRole(wf, index, v)}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {stepRoleOptions.map((r) => (
                        <SelectItem key={r.key} value={r.key}>
                          {r.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Badge variant="secondary" className="text-xs font-normal">
                    {isLast ? 'Final approves' : 'Forwards'}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === 0}
                      onClick={() => moveRouteStep(wf, index, -1)}
                      aria-label="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={index === route.length - 1}
                      onClick={() => moveRouteStep(wf, index, 1)}
                      aria-label="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      disabled={route.length <= 1}
                      onClick={() => removeRouteStep(wf, index)}
                      aria-label="Remove step"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            {route.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                disabled={!canAddSeniorStep}
                onClick={() => addRouteStep(wf)}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add role to route
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approval workflows</CardTitle>
        <CardDescription>
          Configure the full approval flow here: bypass or an ordered route (up to 5 roles). Default
          client/proposal routes end with Company Director (per agency). Super Admin, Director, and
          Company Director can direct-approve over junior steps without a forward (audit shows name
          and date). Grant matching permissions under Settings → Roles → Permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {showLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading approval settings…</span>
          </div>
        ) : showError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {loadError ?? metadataError}
          </div>
        ) : !policy || !metadata ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No approval settings available.</p>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <Label htmlFor="allow-self-assign">Allow lead self-assign</Label>
                <p className="text-sm text-muted-foreground">
                  When off, associates must submit a lead request instead of creating a lead directly.
                </p>
              </div>
              <Switch
                id="allow-self-assign"
                checked={policy.allowLeadSelfAssign}
                onCheckedChange={(v) => setPolicy({ ...policy, allowLeadSelfAssign: v })}
              />
            </div>

            <div className="space-y-8">
              {APPROVAL_WORKFLOW_GROUPS.map((group) => (
                <div key={group.title} className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">{group.title}</h3>
                    {group.description && (
                      <p className="text-xs text-muted-foreground">{group.description}</p>
                    )}
                  </div>
                  <div className="space-y-4">{group.workflows.map((wf) => renderWorkflowCard(wf))}</div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={saving || restoring}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Save approval workflows
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRestoreOpen(true)}
                disabled={saving || restoring}
              >
                {restoring ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Restore defaults
              </Button>
            </div>

            <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Restore default approval workflows?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This resets all workflows for this agency to the application defaults: client
                    add/edit and CSV import use Sales Manager then Company Director; proposal review
                    uses the same; lead requests, extensions, reassignments, and proposal extensions
                    use Sales Manager only. Lead self-assign is turned on. Role
                    forward/final capabilities are updated to match.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRestoreDefaults} disabled={restoring}>
                    {restoring ? 'Restoring…' : 'Restore defaults'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
