import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useStore } from "@/lib/store";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Timer,
  RefreshCw,
  Unplug,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";

interface HubstaffStatus {
  connected: boolean;
  id?: string;
  hubstaffOrgId?: number;
  orgName?: string | null;
  syncEnabled?: boolean;
  lastSyncAt?: string | null;
  lastSyncError?: string | null;
  linkedCount?: number;
  unlinkedCount?: number;
  orgTimezone?: string | null;
  tasksOrganizationId?: string | null;
  tasksIntegrationId?: number | null;
  taskSyncStatus?: string;
  taskSyncError?: string | null;
  lastTaskSyncAt?: string | null;
  latestRun?: {
    status: string;
    startDate: string;
    endDate: string;
    taskStatus: string;
  } | null;
}

interface HubstaffMemberLink {
  id: string;
  hubstaffUserId: number;
  hubstaffName: string | null;
  hubstaffEmail: string | null;
  userId: string | null;
  autoMatched: boolean;
  user?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null;
}

interface OrgChoice {
  id: number;
  name: string;
}

interface ProjectMapping {
  id: string;
  hubstaffProjectId: number;
  projectName: string;
  subCompanyId: string;
  workProfile: string | null;
  internal: boolean;
}
interface EligibleUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}
const WORK_PROFILES = [
  ["software", "Software / IT"],
  ["marketing_sales", "Marketing / Sales"],
  ["recruitment", "Recruitment"],
  ["general", "General"],
];
const UNMAPPED = "__none__";

export function HubstaffTab() {
  const { currentUser, currentSubCompany } = useStore();
  const agencyId = currentSubCompany?.id ?? currentUser?.subCompanyId ?? null;
  const agencyQuery = agencyId
    ? `?subCompanyId=${encodeURIComponent(agencyId)}`
    : "";
  const latestAgency = useRef(agencyQuery);
  latestAgency.current = agencyQuery;
  const [users, setUsers] = useState<EligibleUser[]>([]);
  const [projects, setProjects] = useState<ProjectMapping[]>([]);
  const [agencies, setAgencies] = useState<{ id: string; name: string }[]>([]);
  const [orgTimezone, setOrgTimezone] = useState("");
  const [tasksOrg, setTasksOrg] = useState("");
  const [tasksIntegration, setTasksIntegration] = useState("");
  const [savingConfig, setSavingConfig] = useState(false);
  const [historyStart, setHistoryStart] = useState("");
  const [historyEnd, setHistoryEnd] = useState("");

  const [status, setStatus] = useState<HubstaffStatus | null>(null);
  const [members, setMembers] = useState<HubstaffMemberLink[]>([]);
  const [loading, setLoading] = useState(true);

  const [token, setToken] = useState("");
  const [orgChoices, setOrgChoices] = useState<OrgChoice[] | null>(null);
  const [chosenOrgId, setChosenOrgId] = useState<string>("");
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadStatus = useCallback(async () => {
    const res = await apiFetch<{ data: HubstaffStatus }>(
      `/hubstaff/status${agencyQuery}`,
    );
    if (latestAgency.current !== agencyQuery) return;
    if (res.ok) {
      setStatus(res.data.data);
      setOrgTimezone(res.data.data.orgTimezone ?? "");
      setTasksOrg(res.data.data.tasksOrganizationId ?? "");
      setTasksIntegration(
        res.data.data.tasksIntegrationId
          ? String(res.data.data.tasksIntegrationId)
          : "",
      );
    }
    setLoading(false);
  }, [agencyQuery]);

  const loadMembers = useCallback(async () => {
    const [res, eligible, projectResponse] = await Promise.all([
      apiFetch<{ data: HubstaffMemberLink[] }>(
        `/hubstaff/members${agencyQuery}`,
      ),
      apiFetch<{ data: EligibleUser[] }>(
        `/hubstaff/eligible-users${agencyQuery}`,
      ),
      apiFetch<{
        data: ProjectMapping[];
        agencies: { id: string; name: string }[];
      }>(`/hubstaff/projects${agencyQuery}`),
    ]);
    if (latestAgency.current !== agencyQuery) return;
    if (res.ok) setMembers(res.data.data ?? []);
    if (eligible.ok) setUsers(eligible.data.data ?? []);
    if (projectResponse.ok) {
      setProjects(projectResponse.data.data);
      setAgencies(projectResponse.data.agencies);
    }
  }, [agencyQuery]);

  useEffect(() => {
    setStatus(null);
    setMembers([]);
    setProjects([]);
    setUsers([]);
    setLoading(true);
    setToken("");
    setRotatedToken(null);
    setOrgChoices(null);
    setChosenOrgId("");
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (status?.connected) loadMembers();
  }, [status?.connected, loadMembers]);

  const handleConnect = async () => {
    const pat = rotatedToken ?? token.trim();
    if (!pat) {
      toast.error("Paste your Hubstaff personal access token first");
      return;
    }
    setConnecting(true);
    const body: Record<string, unknown> = { personalAccessToken: pat };
    if (orgTimezone.trim()) body.orgTimezone = orgTimezone.trim();
    if (orgChoices && chosenOrgId) body.organizationId = Number(chosenOrgId);

    const res = await apiFetch<{
      data: {
        connected?: boolean;
        requiresOrganizationChoice?: boolean;
        organizations?: OrgChoice[];
        rotatedToken?: string;
        newLinks?: number;
      };
    }>(`/hubstaff/connect${agencyQuery}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (latestAgency.current !== agencyQuery) return;
    setConnecting(false);

    if (res.ok === false) {
      toast.error(res.error || "Failed to connect Hubstaff");
      return;
    }
    if (res.data.data.requiresOrganizationChoice) {
      setOrgChoices(res.data.data.organizations ?? []);
      setRotatedToken(res.data.data.rotatedToken ?? null);
      toast.info(
        "This token can see multiple organizations — pick one to finish connecting",
      );
      return;
    }
    toast.success(
      `Hubstaff connected${res.data.data.newLinks ? ` — ${res.data.data.newLinks} member(s) found` : ""}`,
    );
    setToken("");
    setOrgChoices(null);
    setRotatedToken(null);
    setChosenOrgId("");
    loadStatus();
  };

  const handleDisconnect = async () => {
    if (
      !window.confirm(
        "Disconnect Hubstaff? Synced time data is kept, but syncing stops.",
      )
    )
      return;
    const res = await apiFetch(`/hubstaff/disconnect${agencyQuery}`, {
      method: "DELETE",
    });
    if (res.ok === false) {
      toast.error(res.error || "Failed to disconnect");
      return;
    }
    toast.success("Hubstaff disconnected");
    setMembers([]);
    loadStatus();
  };

  const handleSync = async () => {
    setSyncing(true);
    const res = await apiFetch<{
      data: { upserted: number; newLinks: number };
    }>(`/hubstaff/sync${agencyQuery}`, {
      method: "POST",
      body: JSON.stringify({
        ...(historyStart ? { startDate: historyStart } : {}),
        ...(historyEnd ? { endDate: historyEnd } : {}),
      }),
    });
    if (latestAgency.current !== agencyQuery) return;
    setSyncing(false);
    if (res.ok === false) {
      toast.error(res.error || "Sync failed");
      return;
    }
    toast.success(`Synced ${res.data.data.upserted} daily record(s)`);
    loadStatus();
    loadMembers();
  };

  const handleLink = async (hubstaffUserId: number, userId: string | null) => {
    const res = await apiFetch<{ data: HubstaffMemberLink }>(
      `/hubstaff/members/${hubstaffUserId}/link${agencyQuery}`,
      { method: "PUT", body: JSON.stringify({ userId }) },
    );
    if (res.ok === false) {
      toast.error(res.error || "Failed to update mapping");
      return;
    }
    setMembers((prev) =>
      prev.map((m) =>
        m.hubstaffUserId === hubstaffUserId ? res.data.data : m,
      ),
    );
    toast.success("Mapping updated");
  };

  const saveConfiguration = async () => {
    setSavingConfig(true);
    const result = await apiFetch(`/hubstaff/configuration${agencyQuery}`, {
      method: "PUT",
      body: JSON.stringify({
        orgTimezone: orgTimezone.trim(),
        tasksOrganizationId: tasksOrg.trim() || null,
        tasksIntegrationId: tasksIntegration.trim()
          ? Number(tasksIntegration)
          : null,
      }),
    });
    if (latestAgency.current !== agencyQuery) return;
    setSavingConfig(false);
    if (result.ok === false) {
      toast.error(result.error || "Could not save Hubstaff configuration");
      return;
    }
    toast.success("Hubstaff reporting configuration saved");
    loadStatus();
  };
  const saveProject = async (
    project: ProjectMapping,
    changes: Partial<ProjectMapping>,
  ) => {
    const next = { ...project, ...changes };
    const result = await apiFetch<{ data: ProjectMapping }>(
      `/hubstaff/projects/${project.hubstaffProjectId}${agencyQuery}`,
      {
        method: "PUT",
        body: JSON.stringify({
          subCompanyId: next.subCompanyId,
          workProfile: next.workProfile,
          internal: next.internal,
        }),
      },
    );
    if (result.ok === false) {
      toast.error(result.error || "Could not update project");
      return;
    }
    setProjects((current) =>
      current.map((item) => (item.id === project.id ? result.data.data : item)),
    );
    loadMembers();
  };

  return (
    <TabsContent value="hubstaff" className="space-y-4 mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Hubstaff Time Tracking
          </CardTitle>
          <CardDescription>
            Connect your Hubstaff organization to sync tracked hours and
            activity for every mapped user. Data refreshes automatically every
            30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : status?.connected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-sm font-medium">
                  Connected to{" "}
                  <span className="font-semibold">
                    {status.orgName ?? `org #${status.hubstaffOrgId}`}
                  </span>
                </span>
                <Badge variant="secondary">
                  {status.linkedCount ?? 0} mapped
                </Badge>
                {(status.unlinkedCount ?? 0) > 0 && (
                  <Badge
                    variant="outline"
                    className="text-orange-600 border-orange-200"
                  >
                    {status.unlinkedCount} unmapped
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Last activity sync:{" "}
                {status.lastSyncAt
                  ? format(parseISO(status.lastSyncAt), "MMM d, yyyy h:mm a")
                  : "never"}
              </p>
              {status.lastSyncError && (
                <div className="flex items-start gap-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{status.lastSyncError}</span>
                </div>
              )}
              {status.taskSyncStatus && (
                <p className="text-sm">
                  Task import:{" "}
                  {status.taskSyncStatus === "available"
                    ? "Available"
                    : status.taskSyncStatus}
                  .
                  {status.taskSyncError && (
                    <span className="text-orange-700">
                      {" "}
                      {status.taskSyncError}
                    </span>
                  )}
                </p>
              )}
              {status.latestRun && (
                <p className="text-xs text-muted-foreground">
                  Last run: {status.latestRun.status}; covered{" "}
                  {status.latestRun.startDate.slice(0, 10)} to{" "}
                  {status.latestRun.endDate.slice(0, 10)}.
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
                <div>
                  <Label htmlFor="hubstaff-history-start">
                    History from (optional)
                  </Label>
                  <Input
                    id="hubstaff-history-start"
                    type="date"
                    value={historyStart}
                    onChange={(event) => setHistoryStart(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="hubstaff-history-end">
                    History through (optional)
                  </Label>
                  <Input
                    id="hubstaff-history-end"
                    type="date"
                    value={historyEnd}
                    onChange={(event) => setHistoryEnd(event.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Sync now refreshes the last 14 days by default. Select dates to
                backfill older task time, up to Hubstaff’s three-year history
                limit.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSync} disabled={syncing}>
                  {syncing ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-1" />
                  )}
                  Sync now
                </Button>
                <Button size="sm" variant="outline" onClick={handleDisconnect}>
                  <Unplug className="h-4 w-4 mr-1" />
                  Disconnect
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="hubstaff-pat">Personal access token</Label>
                <Input
                  id="hubstaff-pat"
                  type="password"
                  placeholder="Paste your Hubstaff personal access token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  disabled={!!rotatedToken}
                />
                <p className="text-xs text-muted-foreground">
                  Create one at developer.hubstaff.com → Personal Access Tokens.
                  It only needs read access to organizations, users, projects,
                  activities, and tasks.
                </p>
              </div>
              {orgChoices && (
                <div className="space-y-1.5">
                  <Label>Organization</Label>
                  <Select value={chosenOrgId} onValueChange={setChosenOrgId}>
                    <SelectTrigger className="w-72">
                      <SelectValue placeholder="Choose the organization to sync" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgChoices.map((o) => (
                        <SelectItem key={o.id} value={String(o.id)}>
                          {o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                onClick={handleConnect}
                disabled={connecting || (!!orgChoices && !chosenOrgId)}
              >
                {connecting && (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                )}
                {orgChoices ? "Finish connecting" : "Connect Hubstaff"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Report day and task estimates
            </CardTitle>
            <CardDescription>
              Tasks and completion are imported from Hubstaff. Make task changes
              there.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-sm space-y-1">
              <Label htmlFor="hubstaff-timezone">
                Hubstaff organization timezone
              </Label>
              <Input
                id="hubstaff-timezone"
                value={orgTimezone}
                placeholder="America/Toronto"
                onChange={(event) => setOrgTimezone(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enter the same timezone used by your organization in Hubstaff.
                Daily reports need this to match the correct working day.
              </p>
            </div>
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-medium">
                Optional: Hubstaff Tasks estimates
              </summary>
              <p className="text-xs text-muted-foreground">
                If you use the separate Hubstaff Tasks product, connect its
                organization and the corresponding integration in Hubstaff Time
                Tracking. Your token must also have access to that product.
              </p>
              <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
                <div>
                  <Label htmlFor="hubstaff-tasks-org">
                    Hubstaff Tasks organization ID
                  </Label>
                  <Input
                    id="hubstaff-tasks-org"
                    inputMode="numeric"
                    value={tasksOrg}
                    onChange={(event) => setTasksOrg(event.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="hubstaff-tasks-integration">
                    Hubstaff Tasks integration ID
                  </Label>
                  <Input
                    id="hubstaff-tasks-integration"
                    inputMode="numeric"
                    value={tasksIntegration}
                    onChange={(event) =>
                      setTasksIntegration(event.target.value)
                    }
                  />
                </div>
              </div>
            </details>
            <Button
              onClick={saveConfiguration}
              disabled={savingConfig || !orgTimezone.trim()}
            >
              {savingConfig ? "Saving…" : "Save reporting configuration"}
            </Button>
          </CardContent>
        </Card>
      )}
      {status?.connected && projects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project reporting</CardTitle>
            <CardDescription>
              Assign each Hubstaff project to its agency and type of work.
              Internal work remains visible without counting toward client
              delivery.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hubstaff project</TableHead>
                  <TableHead>Agency</TableHead>
                  <TableHead>Type of work</TableHead>
                  <TableHead>Internal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>{project.projectName}</TableCell>
                    <TableCell>
                      <Select
                        value={project.subCompanyId}
                        onValueChange={(value) =>
                          saveProject(project, { subCompanyId: value })
                        }
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {agencies.map((agency) => (
                            <SelectItem key={agency.id} value={agency.id}>
                              {agency.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={project.workProfile ?? UNMAPPED}
                        onValueChange={(value) =>
                          saveProject(project, {
                            workProfile: value === UNMAPPED ? null : value,
                          })
                        }
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED}>
                            Use employee profile
                          </SelectItem>
                          {WORK_PROFILES.map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        aria-label={`Internal work: ${project.projectName}`}
                        checked={project.internal}
                        onCheckedChange={(value) =>
                          saveProject(project, { internal: value })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {status?.connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">User mapping</CardTitle>
            <CardDescription>
              Hubstaff members are auto-matched to CRM users by email. Fix any
              that could not be matched — unmapped members' time is synced but
              not shown on the Time Tracking page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No Hubstaff members yet — run a sync to load them.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hubstaff member</TableHead>
                    <TableHead>Hubstaff email</TableHead>
                    <TableHead>CRM user</TableHead>
                    <TableHead className="w-24">Match</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">
                        {m.hubstaffName ?? `#${m.hubstaffUserId}`}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.hubstaffEmail ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={m.userId ?? UNMAPPED}
                          onValueChange={(v) =>
                            handleLink(
                              m.hubstaffUserId,
                              v === UNMAPPED ? null : v,
                            )
                          }
                        >
                          <SelectTrigger className="w-64">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>
                              — Not mapped —
                            </SelectItem>
                            {users.map((u) => (
                              <SelectItem key={u.id} value={u.id}>
                                {u.firstName} {u.lastName} ({u.email})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {m.userId ? (
                          <Badge
                            variant={m.autoMatched ? "secondary" : "outline"}
                          >
                            {m.autoMatched ? "auto" : "manual"}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-orange-600 border-orange-200"
                          >
                            unmapped
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </TabsContent>
  );
}
