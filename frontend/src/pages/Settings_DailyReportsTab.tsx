import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useStore } from '@/lib/store';
import { useHasPermission } from '@/lib/access';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  REPORT_PROFILES,
  getDailyReportSettings,
  getReportHistory,
  previewDailyReport,
  retryReportDelivery,
  saveDailyReportSettings,
  saveReportProfile,
  type DailyReportPolicy,
  type DailyReportSettingsData,
  type ReportDelivery,
  type ReportProfile,
  type ReportScope,
} from '@/lib/dailyReportsApi';

const TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg',
  'America/Halifax', 'America/St_Johns', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dubai',
  'Europe/London', 'UTC',
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}

const recipientEmailSchema = z.string().email();

/** Remount on agency changes so an earlier request cannot populate the next agency's form. */
export function DailyReportsTab() {
  const contextKey = useStore((state) =>
    `${state.currentUser?.id ?? ''}:${state.viewedSubCompanyId ?? state.currentSubCompany?.id ?? ''}`);
  return <DailyReportsSettings key={contextKey} />;
}

function DailyReportsSettings() {
  const navigate = useNavigate();
  const canEdit = useHasPermission('settings:write');
  const [scope, setScope] = useState<ReportScope>('agency');
  const [data, setData] = useState<DailyReportSettingsData | null>(null);
  const [policy, setPolicy] = useState<DailyReportPolicy | null>(null);
  const [savedPolicy, setSavedPolicy] = useState('');
  const [history, setHistory] = useState<ReportDelivery[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewDate, setPreviewDate] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [canManageOrganization, setCanManageOrganization] = useState(false);
  const generation = useRef(0);
  const initialScopeResolved = useRef(false);
  const explicitlyChosenScope = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);

  const load = useCallback(async () => {
    const token = ++generation.current;
    const isCurrent = () => mounted.current && generation.current === token;
    setLoading(true);
    setError('');
    setData(null);
    setPolicy(null);
    setHistory([]);
    setHistoryError('');
    setPreviewDate('');
    setMemberSearch('');
    const results = await Promise.allSettled([getDailyReportSettings(scope), getReportHistory(scope)]);
    if (!isCurrent()) return;
    const settingsResult = results[0];
    if (settingsResult.status === 'fulfilled') {
      setCanManageOrganization(settingsResult.value.canManageOrganization);
      if (!initialScopeResolved.current) {
        initialScopeResolved.current = true;
        if (!explicitlyChosenScope.current && scope === 'agency' && settingsResult.value.defaultScope === 'organization' && settingsResult.value.canManageOrganization) {
          setScope('organization');
          return;
        }
      }
      setData(settingsResult.value);
      setPolicy(settingsResult.value.policy);
      setSavedPolicy(JSON.stringify(settingsResult.value.policy));
    } else {
      setError(message(settingsResult.reason));
    }
    const historyResult = results[1];
    if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
    else setHistoryError(message(historyResult.reason));
    setLoading(false);
  }, [scope]);

  useEffect(() => { void load(); }, [load]);

  const perform = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    try { await action(); }
    catch (err) { if (mounted.current) toast.error(message(err)); }
    finally { if (mounted.current) setBusy(null); }
  };

  const updatePolicy = (patch: Partial<DailyReportPolicy>) => {
    setPolicy((previous) => previous ? { ...previous, ...patch } : previous);
  };

  const changeProfile = (subjectType: 'user' | 'role', subjectId: string, profile: ReportProfile | null) => {
    void perform(`profile:${subjectType}:${subjectId}`, async () => {
      await saveReportProfile(subjectType, subjectId, profile);
      if (!mounted.current) return;
      const refreshed = await getDailyReportSettings(scope);
      if (!mounted.current) return;
      // Updating a profile must not discard unsaved delivery settings.
      setData((previous) => previous ? { ...previous, members: refreshed.members, roles: refreshed.roles } : previous);
      toast.success('Reporting profile saved');
    });
  };

  const dirty = policy !== null && (!policy.id || JSON.stringify(policy) !== savedPolicy);
  const locked = !canEdit || busy !== null;
  const deliveryLocked = locked || !data?.canConfigureDelivery;
  const savedEmail = data?.policy.recipientEmail ?? '';
  const savedEmailValid = recipientEmailSchema.safeParse(savedEmail).success;
  const members = data?.members.filter((person) =>
    `${person.firstName} ${person.lastName} ${person.email} ${person.role}`.toLowerCase().includes(memberSearch.toLowerCase())) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <CardTitle>Daily report emails</CardTitle>
              <CardDescription>Send one combined report with every user’s work results and recorded time to an email address you choose.</CardDescription>
            </div>
            {canManageOrganization && (
              <div className="space-y-1.5 min-w-48">
                <Label htmlFor="report-scope">Report settings for</Label>
                <Select value={scope} onValueChange={(value) => { explicitlyChosenScope.current = true; initialScopeResolved.current = true; setScope(value as ReportScope); }} disabled={busy !== null}>
                  <SelectTrigger id="report-scope"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agency">Current agency</SelectItem>
                    <SelectItem value="organization">Company overview</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? <div role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Loading daily report settings…</div> : error ? (
            <div role="alert" className="space-y-3"><p className="text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></div>
          ) : policy && data ? (
            <>
              {!data.canConfigureDelivery && <p className="text-sm text-muted-foreground">Configuring this combined report requires access to all users, CRM results and Hubstaff time in this scope.</p>}
              <div className="flex items-center gap-2">
                <Checkbox id="daily-report-enabled" checked={policy.enabled} disabled={deliveryLocked} onCheckedChange={(checked) => updatePolicy({ enabled: checked === true })} />
                <Label htmlFor="daily-report-enabled">Enable daily report emails</Label>
              </div>
              <div className="max-w-xl space-y-2">
                <Label htmlFor="report-recipient-email">Recipient email</Label>
                <Input
                  id="report-recipient-email"
                  type="email"
                  autoComplete="email"
                  placeholder="reports@example.com"
                  value={policy.recipientEmail ?? ''}
                  required={policy.enabled}
                  disabled={deliveryLocked}
                  onChange={(event) => updatePolicy({ recipientEmail: event.target.value || null })}
                  onBlur={() => updatePolicy({ recipientEmail: policy.recipientEmail?.trim() || null })}
                  aria-describedby="report-recipient-help"
                />
                <p id="report-recipient-help" className="text-xs text-muted-foreground">Enter one address, including an external address. The email contains the combined results. Opening the detailed CRM report requires a signed-in account with access.</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-4 space-y-2 text-sm">
                <p className="font-medium">{scope === 'organization' ? 'All users across the company' : 'All users in this agency'}</p>
                <p className="text-muted-foreground">{data.agencies.map((agency) => agency.name).join(', ')}</p>
                <div className="flex flex-wrap gap-2"><Badge variant="secondary">Software / IT: Hubstaff</Badge><Badge variant="secondary">Other teams: Hubstaff + CRM</Badge></div>
                <p className="text-muted-foreground">Software work uses Hubstaff tasks and recorded time. Other teams combine Hubstaff time with CRM emails, replies, follow-ups and other work results. Everyone is included in the same report.</p>
                <p className="text-muted-foreground">Hubstaff is optional. Daily emails still include available CRM results when it is not connected, with a “Hubstaff not connected” notice. Hubstaff details appear in future reports after connection and synchronization.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="report-period">Report period</Label>
                  <Select value={policy.period} disabled={deliveryLocked} onValueChange={(value) => updatePolicy({ period: value as DailyReportPolicy['period'] })}>
                    <SelectTrigger id="report-period"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="previous_day">Previous day</SelectItem><SelectItem value="today">Today, as of send time</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-time">Send time</Label>
                  <Input id="report-time" type="time" disabled={deliveryLocked} value={`${String(policy.sendHour).padStart(2, '0')}:${String(policy.sendMinute).padStart(2, '0')}`} onChange={(event) => {
                    if (!event.target.value) return;
                    const [sendHour, sendMinute] = event.target.value.split(':').map(Number);
                    updatePolicy({ sendHour, sendMinute });
                  }} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-timezone">Timezone</Label>
                  <Input id="report-timezone" list="report-timezones" value={policy.timezone} disabled={deliveryLocked} onChange={(event) => updatePolicy({ timezone: event.target.value })} />
                  <datalist id="report-timezones">{TIMEZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="report-shift">Expected shift hours</Label>
                  <Input id="report-shift" type="number" min={1} max={24} step={1} disabled={deliveryLocked} value={policy.shiftHours} onChange={(event) => updatePolicy({ shiftHours: Number(event.target.value) })} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">A previous-day report sent the following morning allows time for late uploads. Today’s report includes work recorded before its cutoff. Shift hours provide context; reports do not assign a universal productivity score.</p>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={deliveryLocked} onClick={() => void perform('save', async () => {
                  const email = policy.recipientEmail?.trim() ?? '';
                  if (policy.enabled && !email) throw new Error('Enter the recipient email before enabling daily reports.');
                  if (email && !recipientEmailSchema.safeParse(email).success) throw new Error('Enter one valid email address.');
                  if (!Number.isInteger(policy.shiftHours) || policy.shiftHours < 1 || policy.shiftHours > 24) throw new Error('Expected shift hours must be a whole number between 1 and 24.');
                  try { new Intl.DateTimeFormat('en', { timeZone: policy.timezone }); } catch { throw new Error('Enter a valid timezone, such as America/Toronto or Asia/Karachi.'); }
                  const result = await saveDailyReportSettings(scope, policy);
                  if (!mounted.current) return;
                  setData(result);
                  setPolicy(result.policy);
                  setSavedPolicy(JSON.stringify(result.policy));
                  toast.success('Daily report settings saved');
                })}>{busy === 'save' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save changes</Button>
                {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      {data && policy && !loading && (
        <>
          <Card>
            <details>
              <summary className="cursor-pointer p-6 font-semibold">Advanced: reporting profiles</summary>
              <CardContent className="space-y-6">
                <p className="text-sm text-muted-foreground">Profiles choose the work source for each employee: Software / IT uses Hubstaff; other profiles use Hubstaff and CRM. Changes save immediately.</p>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Role defaults (company-wide)</summary>
                  <p className="mt-2 text-xs text-muted-foreground">Role defaults apply across the company. Individual employee assignments take priority.{!canManageOrganization && ' Changing role defaults requires access to settings for the whole company.'}</p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data.roles.map((role) => (
                      <div key={role.key} className="space-y-1.5"><Label htmlFor={`report-role-${role.key}`}>{role.name}</Label>
                        <Select disabled={locked || !canManageOrganization} value={role.profile} onValueChange={(value) => changeProfile('role', role.key, value as ReportProfile)}>
                          <SelectTrigger id={`report-role-${role.key}`}><SelectValue /></SelectTrigger>
                          <SelectContent>{REPORT_PROFILES.map((profile) => <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </details>
                <div className="space-y-3">
                  <Label htmlFor="report-member-search">Employee profiles</Label>
                  <Input id="report-member-search" placeholder="Search employees by name, email or role" value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} className="max-w-md" />
                  <div className="max-h-96 overflow-auto rounded-md border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Role</TableHead><TableHead>Reporting profile</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {members.map((person) => (
                          <TableRow key={person.id}>
                            <TableCell><span className="font-medium">{person.firstName} {person.lastName}</span><span className="block text-xs text-muted-foreground">{person.email}</span></TableCell>
                            <TableCell className="capitalize">{person.role.replace(/_/g, ' ')}</TableCell>
                            <TableCell className="min-w-48">
                              <Select disabled={locked} value={person.profileOverride ?? '__role_default__'} onValueChange={(value) => changeProfile('user', person.id, value === '__role_default__' ? null : value as ReportProfile)}>
                                <SelectTrigger aria-label={`Reporting profile for ${person.firstName} ${person.lastName}`}><SelectValue /></SelectTrigger>
                                <SelectContent><SelectItem value="__role_default__">Role default ({REPORT_PROFILES.find((profile) => profile.key === (data.roles.find((role) => role.key === person.role)?.profile ?? person.profile))?.label})</SelectItem>{REPORT_PROFILES.map((profile) => <SelectItem key={profile.key} value={profile.key}>{profile.label}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                          </TableRow>
                        ))}
                        {members.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">No matching employees.</TableCell></TableRow>}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </details>
          </Card>

          <Card>
            <CardHeader><CardTitle>Preview a report</CardTitle><CardDescription>Build a saved preview using the saved settings. Previewing does not send an email.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">Saved recipient: <span className="font-medium">{savedEmail || 'No email address saved'}</span></p>
              {dirty && <p className="text-sm text-amber-700 dark:text-amber-400">Save your changes before previewing the updated settings.</p>}
              {!savedEmailValid && <p className="text-sm text-muted-foreground">Save a valid recipient email to create a preview.</p>}
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5"><Label htmlFor="report-preview-date">Report date (optional)</Label><Input id="report-preview-date" type="date" value={previewDate} onChange={(event) => setPreviewDate(event.target.value)} disabled={deliveryLocked} /></div>
                <Button variant="outline" disabled={deliveryLocked || dirty || !savedEmailValid} onClick={() => void perform('preview', async () => {
                  const result = await previewDailyReport(scope, previewDate || undefined);
                  if (mounted.current) navigate(`/daily-reports/${encodeURIComponent(result.id)}`);
                })}>{busy === 'preview' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create preview</Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><div className="flex items-center justify-between gap-3"><div><CardTitle>Delivery history</CardTitle><CardDescription>Track delivery of the combined daily report.</CardDescription></div><Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void perform('history', async () => {
              const items = await getReportHistory(scope);
              if (mounted.current) { setHistory(items); setHistoryError(''); }
            })}><RefreshCw className={`h-4 w-4 mr-2 ${busy === 'history' ? 'animate-spin' : ''}`} />Refresh</Button></div></CardHeader>
            <CardContent>
              {historyError && <p role="alert" className="mb-3 text-sm text-destructive">{historyError}</p>}
              <Table>
                <TableHeader><TableRow><TableHead>Report date</TableHead><TableHead>Recipient email</TableHead><TableHead>Status</TableHead><TableHead>Attempts since retry</TableHead><TableHead>Report</TableHead></TableRow></TableHeader>
                <TableBody>{history.map((delivery) => (
                  <TableRow key={delivery.id}>
                    <TableCell className="whitespace-nowrap">{delivery.reportDate.slice(0, 10)}</TableCell>
                    <TableCell>{delivery.recipientEmail}</TableCell>
                    <TableCell><Badge variant={delivery.status === 'failed' ? 'destructive' : 'secondary'}>{delivery.status.replace(/_/g, ' ')}</Badge>{delivery.lastError && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{delivery.lastError}</p>}{delivery.acceptedAt && <p className="mt-1 text-xs text-muted-foreground">Accepted {new Date(delivery.acceptedAt).toLocaleString()}</p>}</TableCell>
                    <TableCell>{delivery.attempts}</TableCell>
                    <TableCell><div className="flex items-center gap-2"><Button variant="link" size="sm" asChild><Link to={`/daily-reports/${encodeURIComponent(delivery.snapshotId)}`}>View</Link></Button>{delivery.status === 'failed' && canEdit && data.canConfigureDelivery && <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void perform(`retry:${delivery.id}`, async () => {
                      await retryReportDelivery(delivery.id);
                      if (!mounted.current) return;
                      toast.success('Delivery retry requested');
                      const items = await getReportHistory(scope);
                      if (mounted.current) setHistory(items);
                    })}>{busy === `retry:${delivery.id}` && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}Retry email</Button>}</div></TableCell>
                  </TableRow>
                ))}{history.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No report deliveries yet.</TableCell></TableRow>}</TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
