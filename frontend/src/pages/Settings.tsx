import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyHeader } from '@/components/StickyHeader';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  CheckCircle2, 
  XCircle, 
  Phone, 
  Mail, 
  Coffee, 
  Clock, 
  ArrowRight, 
  CheckSquare, 
  Calendar,
  FileText,
  MessageSquare,
  UserPlus,
  CheckCheck,
  AlertCircle,
  Tag as TagIcon,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Workflow,
  CalendarClock,
  Briefcase,
  Building2,
  Inbox,
  Factory,
  Bug,
  Loader2,
  RefreshCw,
  RotateCcw,
  ExternalLink,
  Plug,
  Upload,
  X,
  Eye,
  Download,
  Target,
  Users,
  Info,
  LogIn,
  Shield,
  ClipboardList,
  Link2,
  PenLine,
  Star,
  MoreVertical,
  Timer,
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { getBackupPercentagePreference, setBackupPercentagePreference } from '@/lib/jobsApi';
import { useAuthStore } from '@/lib/authStore';
import {
  useCanAccessMultipleAgencies,
  useCanManageAgencies,
  useCanManageCallScripts,
  useCanViewTeamScope,
  useHasPermission,
} from '@/lib/access';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ActivityType, ActivityLog, CallScript, ClientStatusType } from '@/lib/types';
import { PipelineConfigTab } from './Settings_PipelineTab';
import { RolesPermissionsTab } from './Settings_RolesTab';
import { SettingsApprovalsTab } from './Settings_ApprovalsTab';
import { SettingsOrgApprovalsCard } from './Settings_OrgApprovalsCard';
import { ClientNotesTab } from './Settings_ClientNotesTab';
import { AgencyLinkTab } from './Settings_AgencyLinkTab';
import { SettingsRecruitmentAgreementTab } from './Settings_RecruitmentAgreementTab';
import { EmailTemplatesSection, AutoSignatureCard } from './Settings_EmailTemplates';
import { NotificationsSection } from './Settings_Notifications';
import { PhoneSystemTab } from './Settings_PhoneSystemTab';
import { HubstaffTab } from './Settings_HubstaffTab';
import { SignatureCreatorWidget } from '@/components/SignatureCreatorWidget';
import { AvailabilitySettings } from '@/components/AvailabilitySettings';
import {
  fetchSubCompanies,
  createSubCompany,
  updateSubCompany,
  fetchEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  fetchSettingsIndustries,
  fetchSettingsTags,
  createSettingsIndustry,
  createSettingsTag,
  updateSettingsIndustry,
  updateSettingsTag,
  deleteSettingsIndustry,
  deleteSettingsTag,
  fetchIndustryRequests,
  fetchTagRequests,
  fetchIndustryRequestsPendingCount,
  fetchTagRequestsPendingCount,
  fetchJobTitleRequests,
  fetchJobTitleRequestsPendingCount,
  approveIndustryRequest,
  rejectIndustryRequest,
  approveTagRequest,
  rejectTagRequest,
  approveJobTitleRequest,
  rejectJobTitleRequest,
  fetchSettingsJobTitles,
  createSettingsJobTitle,
  updateSettingsJobTitle,
  deleteSettingsJobTitle,
  syncSettingsFromClients,
  fetchBugReportRecipients,
  addBugReportRecipient,
  removeBugReportRecipient,
  type ApiEmailTemplate,
  type SettingsIndustry,
  type SettingsTag,
  type SettingsJobTitle,
  type ResourceRequest,
  type BugReportRecipient as BugReportRecipientType,
  fetchActivityLogs,
  fetchClientVisibilitySetting,
  updateClientVisibilitySetting,
  fetchDailyReportSettings,
  updateDailyReportSettings,
  fetchEmailSendWindowSettings,
  updateEmailSendWindowSettings,
  disableEmailSendWindowSettings,
  fetchIdleTimeSetting,
  updateIdleTimeSetting,
  type DailyReportSettings,
  type EmailSendWindowSettings,
  fetchCallScripts as fetchCallScriptsApi,
  createCallScript as createCallScriptApi,
  updateCallScript as updateCallScriptApi,
  deleteCallScript as deleteCallScriptApi,
  type ApiCallScript,
  getGoogleAuthUrl,
  disconnectGoogleCalendar,
  fetchProposalDefaultFiles,
  uploadProposalDefaultFile,
  deleteProposalDefaultFile,
  type ProposalDefaultFile,
  fetchProposalDefaultSetting,
  updateProposalDefaultSetting,
  fetchProposalAwaitingClientDays,
  updateProposalAwaitingClientDays,
  fetchLeadDeadlineDays,
  updateLeadDeadlineDays,
  fetchProposalTypeTemplates,
  updateProposalTypeTemplates,
  type ProposalTypeTemplates,
  pandaDocGetTemplates,
  fetchReviewTemplates,
  uploadReviewTemplate,
  deleteReviewTemplate,
  downloadReviewTemplate,
  previewReviewTemplate,
  type ReviewTemplate,
  fetchPerformanceTargets,
  savePerformanceTarget,
  type PerformanceTargetValues,
  type PerformanceTargetRoleRow,
  fetchSigningAuthorities,
  createSigningAuthority,
  updateSigningAuthority,
  setPrimarySigningAuthority,
  deleteSigningAuthority,
  type SigningAuthority,
  uploadAgencyLogo,
} from '@/lib/api';

import { isValidHttpOrHttpsUrl, resolveAgencyLogoSrc } from '@/lib/branding';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import { buildPerformanceTargetRoleOptions } from '@/lib/roleLabels';

const clientStatusOptions: { value: ClientStatusType; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'ex', label: 'Ex-Client' },
  { value: 'lost', label: 'Lost' },
  { value: 'unsubscribed', label: 'Unsubscribed' },
  { value: 'permanently_closed', label: 'Permanently Closed' },
];

function minuteOfDayToTimeString(minuteOfDay: number | null): string {
  if (minuteOfDay == null || minuteOfDay < 0 || minuteOfDay > 1439) return '';
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function timeStringToMinuteOfDay(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}


/**
 * Per-agency Google Calendar integration card.
 * Rendered inside the Edit Agency modal's "Integrations" tab.
 * Requires the caller to provide the target agency + a callback to refresh state after connect/disconnect.
 */
function AgencyGoogleIntegrationCard(props: {
  agencyId: string;
  agencyName: string;
  connected: boolean;
  connectedEmail: string | null;
  onChanged: () => void;
}) {
  const { agencyId, agencyName, connected, connectedEmail, onChanged } = props;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    const url = await getGoogleAuthUrl(agencyId);
    setConnecting(false);
    if (url) {
      window.location.href = url;
    } else {
      toast.error('Google Calendar integration is not configured on this server');
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm(`Disconnect Google Calendar for ${agencyName}? Future meetings scheduled for this agency will no longer get Meet links automatically.`)) {
      return;
    }
    setDisconnecting(true);
    const ok = await disconnectGoogleCalendar(agencyId);
    setDisconnecting(false);
    if (ok) {
      toast.success(`Google Calendar disconnected for ${agencyName}`);
      onChanged();
    } else {
      toast.error('Failed to disconnect');
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4" /> Google Calendar
        </CardTitle>
        <CardDescription>
          Connect this agency's Google account to auto-generate Meet links and add events to the connected calendar for every meeting scheduled by users in this agency.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-white border flex items-center justify-center shadow-sm shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium">Google Calendar &amp; Meet</p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {connected ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-xs text-emerald-600 font-medium">
                      Connected{connectedEmail ? ` as ${connectedEmail}` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Not connected</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connected ? (
              <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={disconnecting}>
                {disconnecting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Disconnect
              </Button>
            ) : (
              <Button size="sm" onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                )}
                Connect
              </Button>
            )}
          </div>
        </div>

        {connected ? (
          <p className="text-xs text-muted-foreground mt-3">
            When users in this agency schedule a meeting, toggle "Auto-generate Google Meet link" to create a Meet link and add the event to Google Calendar automatically.
          </p>
        ) : (
          <div className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3">
            <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
              <strong>Heads-up:</strong> All meetings scheduled by users in this agency will be created on the connected Google account's calendar, with that account shown as the event organiser. Use a shared/team account (e.g. <code className="rounded bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5">scheduling@youragency.com</code>) rather than a personal account.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Performance Target Inputs ────────────────────────────────────────────────
interface PerformanceTargetInputsProps {
  draft: PerformanceTargetValues;
  isSaving: boolean;
  hasExisting: boolean;
  onDraftChange: (vals: PerformanceTargetValues) => void;
  onSave: () => void;
}

function PerformanceTargetInputs({ draft, isSaving, hasExisting, onDraftChange, onSave }: PerformanceTargetInputsProps) {
  function handleChange(field: keyof PerformanceTargetValues, raw: string) {
    const parsed = parseInt(raw, 10);
    const val = isNaN(parsed) || parsed < 0 ? 0 : Math.min(parsed, 9999);
    onDraftChange({ ...draft, [field]: val });
  }

  return (
    <div className="space-y-4 pt-2">
      {!hasExisting && (
        <p className="text-xs text-amber-600">No target configured yet for this role.</p>
      )}
      <div className="flex flex-wrap gap-4">
        {(
          [
            { field: 'emailsTarget' as const,    label: 'Emails / day',       color: 'text-purple-600' },
            { field: 'callsTarget'  as const,    label: 'Calls / day',        color: 'text-blue-600'   },
            { field: 'meetingScheduleCountTarget' as const, label: 'Meeting schedule count', color: 'text-teal-600' },
          ] as const
        ).map(({ field, label: fLabel, color }) => (
          <div key={field} className="flex flex-col gap-1">
            <Label className={`text-xs font-medium ${color}`}>{fLabel}</Label>
            <Input
              type="number"
              min={0}
              max={9999}
              value={draft[field]}
              onChange={(e) => handleChange(field, e.target.value)}
              className="w-24 h-9 text-center text-sm"
            />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={onSave} disabled={isSaving} className="mt-1">
        {isSaving && <Loader2 className="h-3 w-3 animate-spin mr-1.5" />}
        Save Targets
      </Button>
    </div>
  );
}

export default function Settings() {
  const { currentUser, currentSubCompany, subCompanies, setSubCompanies, pipelineStages, addPipelineStage, updatePipelineStage, deletePipelineStage, reorderPipelineStages } = useStore();
  const { assignableRoles } = useAssignableRoles();
  const perfTargetRoleOptions = useMemo(
    () => buildPerformanceTargetRoleOptions(assignableRoles),
    [assignableRoles],
  );
  const [backupPercentage, setBackupPercentage] = useState<number>(getBackupPercentagePreference);
  const permissions = useAuthStore((s) => s.permissions);
  const hasRolesRead = useHasPermission('roles:read');
  const hasSettingsWrite = useHasPermission('settings:write');
  const hasSettingsRead = useHasPermission('settings:read');
  const hasAgenciesCrossOrg = useHasPermission('agencies:cross_org');
  const hasClientNotesConfigure = useHasPermission('client_notes:configure');
  const hasPipelineConfigure = useHasPermission('pipeline:configure');
  const hasUsersLinkAgency = useHasPermission('users:link_agency');
  const canAccessMultipleAgencies = useCanAccessMultipleAgencies();
  const canViewTeamScope = useCanViewTeamScope();
  const canManageAgencies = useCanManageAgencies();
  const canManageRoles =
    hasRolesRead || (hasSettingsWrite && canAccessMultipleAgencies);
  const canConfigureClientNotes = hasClientNotesConfigure;
  const isSuperAdmin = canManageAgencies;
  const canApprove = hasSettingsWrite;
  const canManageLoginBrandingTab =
    hasSettingsWrite && (canManageAgencies || hasAgenciesCrossOrg);
  const canManageScripts = useCanManageCallScripts();
  const canManageTargets =
    hasSettingsWrite || (hasSettingsRead && canViewTeamScope && !canAccessMultipleAgencies);
  const canSeeClientVisibilityTab =
    hasSettingsRead && (canAccessMultipleAgencies || hasSettingsWrite);
  const canManageProposalDefaults =
    hasSettingsWrite && canAccessMultipleAgencies;
  const canManageReviewTemplates =
    hasSettingsWrite && canAccessMultipleAgencies;
  const canManageAgencyPipeline =
    hasPipelineConfigure || (hasSettingsWrite && canAccessMultipleAgencies);
  const canLinkAgencies = hasUsersLinkAgency;
  const canManageHubstaff = useHasPermission('hubstaff:manage');
  const [activityTypeFilter, setActivityTypeFilter] = useState<ActivityType | 'all'>('all');
  const [activitySearch, setActivitySearch] = useState('');
  const [liveActivityLogs, setLiveActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [isAddTagOpen, setIsAddTagOpen] = useState(false);
  const [isEditTagOpen, setIsEditTagOpen] = useState(false);
  const [isDeleteTagOpen, setIsDeleteTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [editingTag, setEditingTag] = useState<SettingsTag | null>(null);
  const [editedTagName, setEditedTagName] = useState('');
  const [deletingTag, setDeletingTag] = useState<SettingsTag | null>(null);
  const [settingsTags, setSettingsTags] = useState<SettingsTag[]>([]);
  const [settingsTagsTotalCount, setSettingsTagsTotalCount] = useState(0);
  const [settingsIndustries, setSettingsIndustries] = useState<SettingsIndustry[]>([]);
  const [settingsIndustriesTotalCount, setSettingsIndustriesTotalCount] = useState(0);
  const [industryRequests, setIndustryRequests] = useState<ResourceRequest[]>([]);
  const [tagRequests, setTagRequests] = useState<ResourceRequest[]>([]);
  const [jobTitleRequests, setJobTitleRequests] = useState<ResourceRequest[]>([]);
  const [requestsPendingCount, setRequestsPendingCount] = useState(0);
  const [isAddIndustryOpen, setIsAddIndustryOpen] = useState(false);
  const [settingsJobTitles, setSettingsJobTitles] = useState<SettingsJobTitle[]>([]);
  const [settingsJobTitlesTotalCount, setSettingsJobTitlesTotalCount] = useState(0);
  const [isAddJobTitleOpen, setIsAddJobTitleOpen] = useState(false);
  const [newJobTitleName, setNewJobTitleName] = useState('');
  const [editingJobTitle, setEditingJobTitle] = useState<SettingsJobTitle | null>(null);
  const [editedJobTitleName, setEditedJobTitleName] = useState('');
  const [deletingJobTitle, setDeletingJobTitle] = useState<SettingsJobTitle | null>(null);
  const [isEditJobTitleOpen, setIsEditJobTitleOpen] = useState(false);
  const [isDeleteJobTitleOpen, setIsDeleteJobTitleOpen] = useState(false);
  const [newIndustryName, setNewIndustryName] = useState('');
  const [editingIndustry, setEditingIndustry] = useState<SettingsIndustry | null>(null);
  const [editedIndustryName, setEditedIndustryName] = useState('');
  const [deletingIndustry, setDeletingIndustry] = useState<SettingsIndustry | null>(null);
  const [isEditIndustryOpen, setIsEditIndustryOpen] = useState(false);
  const [isDeleteIndustryOpen, setIsDeleteIndustryOpen] = useState(false);
  
  // Pipeline configuration state
  const [isAddStageOpen, setIsAddStageOpen] = useState(false);
  const [isEditStageOpen, setIsEditStageOpen] = useState(false);
  const [isDeleteStageOpen, setIsDeleteStageOpen] = useState(false);
  const [newStageLabel, setNewStageLabel] = useState('');
  const [newStageColor, setNewStageColor] = useState('#3b82f6');
  const [editingStage, setEditingStage] = useState<string>('');
  const [editedStageLabel, setEditedStageLabel] = useState('');
  const [editedStageColor, setEditedStageColor] = useState('');
  const [deletingStage, setDeletingStage] = useState('');
  const [draggedStage, setDraggedStage] = useState<string | null>(null);
  const [agenciesLoading, setAgenciesLoading] = useState(false);
  const [isAddAgencyOpen, setIsAddAgencyOpen] = useState(false);
  const [isEditAgencyOpen, setIsEditAgencyOpen] = useState(false);
  const [editingAgency, setEditingAgency] = useState<{
    id: string;
    name: string;
    mainOrgId: string;
    emailFooterText?: string | null;
    emailTagline?: string | null;
    logoUrl?: string | null;
    agencyLogoUrl?: string | null;
    agencyEmail?: string | null;
    agencyPhone?: string | null;
    appProjectName?: string | null;
    emailFromAddress?: string | null;
    emailFromName?: string | null;
    emailSendAsDomain?: string | null;
    emailInboundDomain?: string | null;
    emailInboundLocalpart?: string | null;
    googleCalendarConnected?: boolean;
    googleConnectedEmail?: string | null;
  } | null>(null);
  const [agencyName, setAgencyName] = useState('');
  const [agencyEmailFooter, setAgencyEmailFooter] = useState('');
  const [agencyEmailTagline, setAgencyEmailTagline] = useState('');
  const [editAgencyAgencyLogoUrl, setEditAgencyAgencyLogoUrl] = useState('');
  const [editAgencyLogoUploading, setEditAgencyLogoUploading] = useState(false);
  const [logoPreviewSrc, setLogoPreviewSrc] = useState<string | null>(null);
  const logoPreviewObjUrlRef = useRef<string | null>(null);
  const editAgencyLogoInputRef = useRef<HTMLInputElement>(null);

  const resolveLogoPreview = (storedUrl: string, agencyId: string): string | null =>
    resolveAgencyLogoSrc(storedUrl, agencyId);
  const [editAgencyEmail, setEditAgencyEmail] = useState('');
  const [editAgencyPhone, setEditAgencyPhone] = useState('');
  const [editEmailFromAddress, setEditEmailFromAddress] = useState('');
  const [editEmailFromName, setEditEmailFromName] = useState('');
  const [editEmailSendAsDomain, setEditEmailSendAsDomain] = useState('');
  const [editEmailInboundDomain, setEditEmailInboundDomain] = useState('');
  const [editEmailInboundLocalpart, setEditEmailInboundLocalpart] = useState('');
  const [editAgencyTab, setEditAgencyTab] = useState('settings');
  const [companyProjectDraft, setCompanyProjectDraft] = useState('');
  const [companyLogoDraft, setCompanyLogoDraft] = useState('');
  const [companyBrandingSaving, setCompanyBrandingSaving] = useState(false);
  const [bugReportRecipients, setBugReportRecipients] = useState<BugReportRecipientType[]>([]);
  const [newBugReportEmail, setNewBugReportEmail] = useState('');
  const [addingBugRecipient, setAddingBugRecipient] = useState(false);
  const [initialSettingsListsLoaded, setInitialSettingsListsLoaded] = useState(false);
  const hasAutoSyncedRef = useRef(false);

  // Client visibility delay state
  const [clientVisibilityDays, setClientVisibilityDays] = useState<number>(7);
  const [clientVisibilityImmediate, setClientVisibilityImmediate] = useState(false);
  const [clientVisibilityLoading, setClientVisibilityLoading] = useState(false);
  const [clientVisibilitySaving, setClientVisibilitySaving] = useState(false);
  const clientVisibilityDaysStorageKey = `client-visibility-last-days:${currentSubCompany?.id ?? ''}`;

  // Daily report email settings
  const [dailyReportSettings, setDailyReportSettings] = useState<DailyReportSettings>({
    enabled: false, sendHour: 18, sendMinute: 0, timezone: 'America/Toronto', shiftHours: 8,
  });
  const [dailyReportLoading, setDailyReportLoading] = useState(false);
  const [dailyReportSaving, setDailyReportSaving] = useState(false);

  // Email send window settings (cutoff/start)
  const [emailSendWindowSettings, setEmailSendWindowSettings] = useState<EmailSendWindowSettings>({
    enabled: false,
    startMinuteOfDay: null,
    cutoffMinuteOfDay: null,
    timezone: 'America/Toronto',
  });
  const [emailSendWindowLoading, setEmailSendWindowLoading] = useState(false);
  const [emailSendWindowSaving, setEmailSendWindowSaving] = useState(false);

  // Idle time threshold settings
  const [idleThresholdMinutes, setIdleThresholdMinutes] = useState(5);
  const [idleTimeLoading, setIdleTimeLoading] = useState(false);
  const [idleTimeSaving, setIdleTimeSaving] = useState(false);

  // Proposal default files state
  const [proposalDefaultFiles, setProposalDefaultFiles] = useState<ProposalDefaultFile[]>([]);
  const [proposalDefaultFilesLoading, setProposalDefaultFilesLoading] = useState(false);
  const [proposalDefaultUploading, setProposalDefaultUploading] = useState(false);
  const [reviewTemplates, setReviewTemplates] = useState<ReviewTemplate[]>([]);
  const [reviewTemplatesLoading, setReviewTemplatesLoading] = useState(false);
  const [signingAuthorities, setSigningAuthorities] = useState<SigningAuthority[]>([]);
  const [signingAuthoritiesLoading, setSigningAuthoritiesLoading] = useState(false);
  const [signingAuthorityForm, setSigningAuthorityForm] = useState<{ mode: 'create' | 'edit'; record?: SigningAuthority } | null>(null);
  const [signingAuthorityDeleting, setSigningAuthorityDeleting] = useState<string | null>(null);
  const [rtTempFile, setRtTempFile] = useState<File | null>(null);
  const [rtDirectFile, setRtDirectFile] = useState<File | null>(null);
  const [rtTempUploading, setRtTempUploading] = useState(false);
  const [rtDirectUploading, setRtDirectUploading] = useState(false);
  const [proposalMaxFiles, setProposalMaxFiles] = useState(5);
  const [proposalMaxFilesSaving, setProposalMaxFilesSaving] = useState(false);
  const [proposalAwaitingClientDays, setProposalAwaitingClientDays] = useState(7);
  const [proposalAwaitingClientSaving, setProposalAwaitingClientSaving] = useState(false);
  const [leadDeadlineDays, setLeadDeadlineDays] = useState(7);
  const [leadDeadlineSaving, setLeadDeadlineSaving] = useState(false);

  // Proposal type template mapping state
  const [proposalTypeTemplates, setProposalTypeTemplates] = useState<ProposalTypeTemplates>({
    tempTemplateId: null,
    tempTemplateName: null,
    directTemplateId: null,
    directTemplateName: null,
    bothTemplateId: null,
    bothTemplateName: null,
    employeeOnboardingTemplateId: null,
    employeeOnboardingTemplateName: null,
  });
  const [proposalTypeTemplatesLoading, setProposalTypeTemplatesLoading] = useState(false);
  const [proposalTypeTemplatesSaving, setProposalTypeTemplatesSaving] = useState(false);
  const [pandaDocTemplatesList, setPandaDocTemplatesList] = useState<{ id: string; name: string }[]>([]);

  // Performance targets state
  const [perfTargetsLoading, setPerfTargetsLoading] = useState(false);
  const [perfRoleTargets, setPerfRoleTargets] = useState<PerformanceTargetRoleRow[]>([]);
  const [selectedPerfRole, setSelectedPerfRole] = useState<string>('sales_associate');
  const [perfDraft, setPerfDraft] = useState<PerformanceTargetValues>({ emailsTarget: 0, callsTarget: 0, meetingScheduleCountTarget: 0 });
  const [perfSaving, setPerfSaving] = useState(false);

  // Call scripts state
  const [dbCallScripts, setDbCallScripts] = useState<ApiCallScript[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [isAddScriptOpen, setIsAddScriptOpen] = useState(false);
  const [isEditScriptOpen, setIsEditScriptOpen] = useState(false);
  const [isDeleteScriptOpen, setIsDeleteScriptOpen] = useState(false);
  const [scriptName, setScriptName] = useState('');
  const [scriptContent, setScriptContent] = useState('');
  const [scriptClientStatus, setScriptClientStatus] = useState<string>('__none__');
  const [scriptIsActive, setScriptIsActive] = useState(true);
  const [editingScript, setEditingScript] = useState<ApiCallScript | null>(null);
  const [deletingScript, setDeletingScript] = useState<ApiCallScript | null>(null);
  const [scriptMutating, setScriptMutating] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') ?? 'activity';

  useEffect(() => {
    if (tabFromUrl !== 'company') return;
    if (canManageLoginBrandingTab) return;
    setSearchParams({ tab: 'activity' }, { replace: true });
  }, [tabFromUrl, canManageLoginBrandingTab, setSearchParams]);

  // Activity tab: every role (including Director) only sees their own logs here.
  // Reports keeps its own agency-wide aggregation for elevated roles.
  useEffect(() => {
    if (tabFromUrl !== 'activity') return;
    if (!currentUser.id) return;
    setActivityLoading(true);
    fetchActivityLogs({ limit: 200, userId: currentUser.id })
      .then(setLiveActivityLogs)
      .catch(() => setLiveActivityLogs([]))
      .finally(() => setActivityLoading(false));
  }, [tabFromUrl, currentUser.id]);

  // Fetch client visibility setting when tab is active
  useEffect(() => {
    if (!canSeeClientVisibilityTab) return;
    if (tabFromUrl !== 'client-visibility') return;
    setClientVisibilityLoading(true);
    fetchClientVisibilitySetting()
      .then((r) => {
        const fallbackDays = parseInt(
          localStorage.getItem(clientVisibilityDaysStorageKey) ?? '',
          10,
        ) || 7;
        setClientVisibilityImmediate(r.days === 0);
        if (r.days > 0) {
          setClientVisibilityDays(r.days);
          localStorage.setItem(clientVisibilityDaysStorageKey, String(r.days));
        } else {
          setClientVisibilityDays(fallbackDays);
        }
      })
      .catch(() => toast.error('Failed to load client visibility setting'))
      .finally(() => setClientVisibilityLoading(false));
  }, [canSeeClientVisibilityTab, clientVisibilityDaysStorageKey, tabFromUrl]);

  // Fetch daily report settings when tab is active
  useEffect(() => {
    if (!canSeeClientVisibilityTab) return; // same director/super_admin check
    if (tabFromUrl !== 'daily-reports') return;
    setDailyReportLoading(true);
    fetchDailyReportSettings()
      .then(setDailyReportSettings)
      .catch(() => toast.error('Failed to load daily report settings'))
      .finally(() => setDailyReportLoading(false));
  }, [canSeeClientVisibilityTab, tabFromUrl]);

  // Fetch idle time threshold when tab is active
  useEffect(() => {
    if (!canSeeClientVisibilityTab) return;
    if (tabFromUrl !== 'idle-time') return;
    setIdleTimeLoading(true);
    fetchIdleTimeSetting()
      .then((s) => setIdleThresholdMinutes(s.thresholdMinutes))
      .catch(() => toast.error('Failed to load idle time setting'))
      .finally(() => setIdleTimeLoading(false));
  }, [canSeeClientVisibilityTab, tabFromUrl]);

  useEffect(() => {
    if (!canSeeClientVisibilityTab) return;
    if (tabFromUrl !== 'email-cutoff') return;
    setEmailSendWindowLoading(true);
    fetchEmailSendWindowSettings()
      .then(setEmailSendWindowSettings)
      .catch(() => toast.error('Failed to load email send window settings'))
      .finally(() => setEmailSendWindowLoading(false));
  }, [canSeeClientVisibilityTab, tabFromUrl]);

  // Company / login branding (directors only)
  useEffect(() => {
    if (!canManageLoginBrandingTab) return;
    if (tabFromUrl !== 'company') return;
    fetchSubCompanies()
      .then((list) => {
        const mine = list.find((s) => s.id === currentSubCompany?.id);
        if (mine) {
          setCompanyProjectDraft(mine.appProjectName ?? '');
          setCompanyLogoDraft(mine.logoUrl ?? '');
        }
      })
      .catch(() => {});
  }, [canManageLoginBrandingTab, tabFromUrl, currentSubCompany?.id]);

  // Fetch proposal default files when the Edit Agency dialog opens that sub-tab.
  // Data is scoped to the agency being edited via ?subCompanyId= on the API calls.
  useEffect(() => {
    if (!canManageProposalDefaults) return;
    if (!isEditAgencyOpen || editAgencyTab !== 'proposal-defaults') return;
    if (!editingAgency?.id) return;
    const agencyId = editingAgency.id;
    setProposalDefaultFilesLoading(true);
    Promise.all([
      fetchProposalDefaultFiles(agencyId),
      fetchProposalDefaultSetting(agencyId),
      fetchProposalAwaitingClientDays(agencyId),
      fetchLeadDeadlineDays(agencyId),
    ])
      .then(([files, maxFiles, awaitingDays, leadDays]) => {
        setProposalDefaultFiles(files);
        setProposalMaxFiles(maxFiles);
        setProposalAwaitingClientDays(awaitingDays);
        setLeadDeadlineDays(leadDays);
      })
      .catch(() => toast.error('Failed to load proposal default settings'))
      .finally(() => setProposalDefaultFilesLoading(false));
  }, [canManageProposalDefaults, isEditAgencyOpen, editAgencyTab, editingAgency?.id]);

  // Fetch proposal type template mapping when the Edit Agency dialog opens that sub-tab
  useEffect(() => {
    if (!canManageProposalDefaults) return;
    if (!isEditAgencyOpen || editAgencyTab !== 'proposal-templates') return;
    if (!editingAgency?.id) return;
    const agencyId = editingAgency.id;
    setProposalTypeTemplatesLoading(true);
    Promise.all([fetchProposalTypeTemplates(agencyId), pandaDocGetTemplates({ catalog: true })])
      .then(([mapping, templates]) => {
        setProposalTypeTemplates(mapping);
        setPandaDocTemplatesList(templates);
      })
      .catch(() => toast.error('Failed to load proposal template settings'))
      .finally(() => setProposalTypeTemplatesLoading(false));
  }, [canManageProposalDefaults, isEditAgencyOpen, editAgencyTab, editingAgency?.id]);

  // Fetch review templates when the Edit Agency dialog opens that sub-tab
  useEffect(() => {
    if (!canManageReviewTemplates) return;
    if (!isEditAgencyOpen || editAgencyTab !== 'review-templates') return;
    if (!editingAgency?.id) return;
    const agencyId = editingAgency.id;
    setReviewTemplatesLoading(true);
    fetchReviewTemplates(agencyId)
      .then((templates) => {
        setReviewTemplates(templates);
        // both_agreement still exists in DB for legacy rows — not shown in UI
      })
      .catch(() => toast.error('Failed to load review templates'))
      .finally(() => setReviewTemplatesLoading(false));
  }, [canManageReviewTemplates, isEditAgencyOpen, editAgencyTab, editingAgency?.id]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    if (!isEditAgencyOpen || editAgencyTab !== 'signing-authority') return;
    if (!editingAgency?.id) return;
    setSigningAuthoritiesLoading(true);
    fetchSigningAuthorities(editingAgency.id)
      .then(data => setSigningAuthorities(Array.isArray(data) ? data : []))
      .catch(() => toast.error('Failed to load signing authorities'))
      .finally(() => setSigningAuthoritiesLoading(false));
  }, [isSuperAdmin, isEditAgencyOpen, editAgencyTab, editingAgency?.id]);

  // Fetch performance targets when performance-targets tab is active
  useEffect(() => {
    if (!canManageTargets) return;
    if (tabFromUrl !== 'performance-targets') return;
    setPerfTargetsLoading(true);
    fetchPerformanceTargets()
      .then((data) => {
        setPerfRoleTargets(data.roles);
        // Init draft for the currently selected role
        const row = data.roles.find((r) => r.role === selectedPerfRole);
        setPerfDraft(row?.target ?? { emailsTarget: 0, callsTarget: 0, meetingScheduleCountTarget: 0 });
      })
      .catch(() => toast.error('Failed to load performance targets'))
      .finally(() => setPerfTargetsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageTargets, tabFromUrl]);

  // Fetch call scripts when scripts tab is active
  const loadCallScripts = useCallback(async () => {
    setScriptsLoading(true);
    try {
      const data = await fetchCallScriptsApi();
      setDbCallScripts(data);
    } catch {
      toast.error('Failed to load call scripts');
    } finally {
      setScriptsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManageScripts) return;
    if (tabFromUrl !== 'scripts') return;
    loadCallScripts();
  }, [canManageScripts, tabFromUrl, loadCallScripts]);

  const handleClientVisibilityImmediateChange = async (checked: boolean) => {
    const nextImmediate = !!checked;
    const previousImmediate = clientVisibilityImmediate;
    const previousDays = clientVisibilityDays;
    const nextDays = nextImmediate ? 0 : Math.max(1, previousDays);

    setClientVisibilityImmediate(nextImmediate);
    setClientVisibilitySaving(true);
    try {
      const updated = await updateClientVisibilitySetting(nextDays);
      setClientVisibilityImmediate(updated.days === 0);
      if (updated.days > 0) {
        setClientVisibilityDays(updated.days);
        localStorage.setItem(clientVisibilityDaysStorageKey, String(updated.days));
      }
      toast.success(
        nextImmediate
          ? 'Immediate visibility enabled'
          : 'Immediate visibility disabled',
      );
    } catch {
      setClientVisibilityImmediate(previousImmediate);
      setClientVisibilityDays(previousDays);
      toast.error('Failed to update visibility setting');
    } finally {
      setClientVisibilitySaving(false);
    }
  };

  const canManageTagsIndustries =
    hasSettingsWrite && canAccessMultipleAgencies;

  const loadAgencies = useCallback(async () => {
    if (!permissions.includes('users:read')) return;
    setAgenciesLoading(true);
    try {
      const list = await fetchSubCompanies();
      setSubCompanies(
        list.map((s) => ({
          id: s.id,
          name: s.name,
          mainOrgId: s.mainOrgId,
          appProjectName: s.appProjectName ?? null,
          logoUrl: s.logoUrl ?? null,
          agencyLogoUrl: s.agencyLogoUrl ?? null,
          agencyEmail: s.agencyEmail ?? null,
          agencyPhone: s.agencyPhone ?? null,
          emailFooterText: s.emailFooterText ?? null,
          emailTagline: s.emailTagline ?? null,
          emailFromAddress: s.emailFromAddress ?? null,
          emailFromName: s.emailFromName ?? null,
          emailSendAsDomain: s.emailSendAsDomain ?? null,
          emailInboundDomain: s.emailInboundDomain ?? null,
          emailInboundLocalpart: s.emailInboundLocalpart ?? null,
          googleCalendarConnected: s.googleCalendarConnected ?? false,
          googleConnectedEmail: s.googleConnectedEmail ?? null,
        })),
      );
    } catch {
      toast.error('Failed to load agencies');
    } finally {
      setAgenciesLoading(false);
    }
  }, [permissions, setSubCompanies]);

  const loadBugReportRecipients = useCallback(async () => {
    if (!isSuperAdmin) return;
    try {
      const list = await fetchBugReportRecipients();
      setBugReportRecipients(list);
    } catch {
      toast.error('Failed to load bug report recipients');
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin || canManageProposalDefaults || canManageReviewTemplates) loadAgencies();
  }, [isSuperAdmin, canManageProposalDefaults, canManageReviewTemplates, loadAgencies]);

  // Legacy deep-link redirect: the old top-level tabs (proposal-defaults,
  // proposal-templates, review-templates) now live inside the Edit Agency dialog
  // as sub-tabs. If a stale bookmark or external link still points to them,
  // open the Agencies tab and pre-open the user's own agency on the matching
  // sub-tab. Waits for subCompanies to load so the agency row resolves.
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t !== 'proposal-defaults' && t !== 'proposal-templates' && t !== 'review-templates') return;
    if (!currentSubCompany?.id) return;
    if (subCompanies.length === 0) return;
    const target = subCompanies.find((s) => s.id === currentSubCompany.id);
    if (!target) return;
    const subTab = t;
    setEditingAgency(target);
    setAgencyName(target.name);
    setAgencyEmailFooter(target.emailFooterText ?? '');
    setAgencyEmailTagline(target.emailTagline ?? '');
    setEditAgencyAgencyLogoUrl(target.agencyLogoUrl ?? '');
    setLogoPreviewSrc(resolveLogoPreview(target.agencyLogoUrl ?? '', target.id));
    setEditAgencyEmail(target.agencyEmail ?? '');
    setEditAgencyPhone(target.agencyPhone ?? '');
    setEditEmailFromAddress(target.emailFromAddress ?? '');
    setEditEmailFromName(target.emailFromName ?? '');
    setEditEmailSendAsDomain(target.emailSendAsDomain ?? '');
    setEditEmailInboundDomain(target.emailInboundDomain ?? '');
    setEditEmailInboundLocalpart(target.emailInboundLocalpart ?? '');
    setEditAgencyTab(subTab);
    setIsEditAgencyOpen(true);
    setSearchParams((prev) => {
      prev.set('tab', 'agencies');
      return prev;
    }, { replace: true });
  }, [searchParams, currentSubCompany?.id, subCompanies, setSearchParams]);

  // Handle Google OAuth redirect back from /auth/google/callback.
  // Expected params: ?tab=agencies&google=connected|error&editAgency=<id>[&reason=...]
  useEffect(() => {
    const googleParam = searchParams.get('google');
    if (!googleParam) return;
    const editAgencyId = searchParams.get('editAgency');
    const reason = searchParams.get('reason');

    if (googleParam === 'connected') {
      toast.success('Google Calendar connected successfully');
    } else if (googleParam === 'error') {
      const msg =
        reason === 'expired' ? 'Connection timed out — please try again' :
        reason === 'unauthorized' ? 'You do not have access to manage this agency\'s integration' :
        reason === 'invalid_state' ? 'Invalid request — please try again' :
        reason === 'exchange_failed' ? 'Google authentication failed — please try again' :
        'Failed to connect Google Calendar. Please try again.';
      toast.error(msg);
    }

    // Clear params immediately so the effect doesn't re-fire.
    setSearchParams((prev) => {
      prev.delete('google');
      prev.delete('reason');
      prev.delete('editAgency');
      prev.delete('editTab');
      return prev;
    });

    // Reopen the modal with fresh data so the connected state reflects immediately.
    if (editAgencyId && googleParam === 'connected') {
      fetchSubCompanies().then((list) => {
        const mapped = list.map((s) => ({
          id: s.id,
          name: s.name,
          mainOrgId: s.mainOrgId,
          appProjectName: s.appProjectName ?? null,
          logoUrl: s.logoUrl ?? null,
          agencyLogoUrl: s.agencyLogoUrl ?? null,
          agencyEmail: s.agencyEmail ?? null,
          agencyPhone: s.agencyPhone ?? null,
          emailFooterText: s.emailFooterText ?? null,
          emailTagline: s.emailTagline ?? null,
          emailFromAddress: s.emailFromAddress ?? null,
          emailFromName: s.emailFromName ?? null,
          emailSendAsDomain: s.emailSendAsDomain ?? null,
          emailInboundDomain: s.emailInboundDomain ?? null,
          emailInboundLocalpart: s.emailInboundLocalpart ?? null,
          googleCalendarConnected: s.googleCalendarConnected ?? false,
          googleConnectedEmail: s.googleConnectedEmail ?? null,
        }));
        setSubCompanies(mapped);
        const target = mapped.find((s) => s.id === editAgencyId);
        if (target) {
          setEditingAgency(target);
          setAgencyName(target.name);
          setAgencyEmailFooter(target.emailFooterText ?? '');
          setAgencyEmailTagline(target.emailTagline ?? '');
          setEditAgencyAgencyLogoUrl(target.agencyLogoUrl ?? '');
          setLogoPreviewSrc(resolveLogoPreview(target.agencyLogoUrl ?? '', target.id));
          setEditAgencyEmail(target.agencyEmail ?? '');
          setEditAgencyPhone(target.agencyPhone ?? '');
          setEditEmailFromAddress(target.emailFromAddress ?? '');
          setEditEmailFromName(target.emailFromName ?? '');
          setEditEmailSendAsDomain(target.emailSendAsDomain ?? '');
          setEditEmailInboundDomain(target.emailInboundDomain ?? '');
          setEditEmailInboundLocalpart(target.emailInboundLocalpart ?? '');
          setEditAgencyTab('integrations');
          setIsEditAgencyOpen(true);
        }
      }).catch(() => {/* silent — modal just won't reopen */});
    } else if (editAgencyId && subCompanies.length > 0) {
      const target = subCompanies.find((s) => s.id === editAgencyId);
      if (target) {
        setEditingAgency(target);
        setAgencyName(target.name);
        setAgencyEmailFooter(target.emailFooterText ?? '');
        setAgencyEmailTagline(target.emailTagline ?? '');
        setEditAgencyAgencyLogoUrl(target.agencyLogoUrl ?? '');
        setLogoPreviewSrc(resolveLogoPreview(target.agencyLogoUrl ?? '', target.id));
        setEditAgencyEmail(target.agencyEmail ?? '');
        setEditAgencyPhone(target.agencyPhone ?? '');
        setEditEmailFromAddress(target.emailFromAddress ?? '');
        setEditEmailFromName(target.emailFromName ?? '');
        setEditEmailSendAsDomain(target.emailSendAsDomain ?? '');
        setEditEmailInboundDomain(target.emailInboundDomain ?? '');
        setEditEmailInboundLocalpart(target.emailInboundLocalpart ?? '');
        setEditAgencyTab('integrations');
        setIsEditAgencyOpen(true);
      }
    }
  }, [searchParams, subCompanies, setSearchParams]);

  useEffect(() => {
    if (isSuperAdmin) loadBugReportRecipients();
  }, [isSuperAdmin, loadBugReportRecipients]);

  const loadSettingsTags = useCallback(async () => {
    if (!canManageTagsIndustries) return;
    try {
      const { data, totalCount } = await fetchSettingsTags();
      setSettingsTags(data);
      setSettingsTagsTotalCount(totalCount);
    } catch {
      toast.error('Failed to load tags');
    }
  }, [canManageTagsIndustries]);

  const loadSettingsIndustries = useCallback(async () => {
    if (!canManageTagsIndustries) return;
    try {
      const { data, totalCount } = await fetchSettingsIndustries();
      setSettingsIndustries(data);
      setSettingsIndustriesTotalCount(totalCount);
    } catch {
      toast.error('Failed to load industries');
    }
  }, [canManageTagsIndustries]);

  const loadRequests = useCallback(async () => {
    try {
      const [ind, tag, jobTitle, pendingInd, pendingTag, pendingJobTitle] = await Promise.all([
        fetchIndustryRequests({ status: 'pending' }),
        fetchTagRequests({ status: 'pending' }),
        fetchJobTitleRequests({ status: 'pending' }),
        fetchIndustryRequestsPendingCount(),
        fetchTagRequestsPendingCount(),
        fetchJobTitleRequestsPendingCount(),
      ]);
      setIndustryRequests(ind);
      setTagRequests(tag);
      setJobTitleRequests(jobTitle);
      setRequestsPendingCount(pendingInd + pendingTag + pendingJobTitle);
    } catch {
      toast.error('Failed to load requests');
    }
  }, []);

  const loadSettingsJobTitles = useCallback(async () => {
    if (!canManageTagsIndustries) return;
    try {
      const { data, totalCount } = await fetchSettingsJobTitles();
      setSettingsJobTitles(data);
      setSettingsJobTitlesTotalCount(totalCount);
    } catch {
      toast.error('Failed to load job titles');
    }
  }, [canManageTagsIndustries]);

  useEffect(() => {
    if (canManageTagsIndustries) {
      Promise.all([loadSettingsTags(), loadSettingsIndustries(), loadSettingsJobTitles()]).finally(() => {
        setInitialSettingsListsLoaded(true);
      });
    }
  }, [canManageTagsIndustries, loadSettingsTags, loadSettingsIndustries, loadSettingsJobTitles]);

  // When tags, industries, and job titles are all empty, auto-populate from client data (once per session)
  useEffect(() => {
    if (
      !canManageTagsIndustries ||
      !initialSettingsListsLoaded ||
      hasAutoSyncedRef.current ||
      settingsTags.length > 0 ||
      settingsIndustries.length > 0 ||
      settingsJobTitles.length > 0
    ) {
      return;
    }
    hasAutoSyncedRef.current = true;
    syncSettingsFromClients()
      .then((result) => {
        return Promise.all([loadSettingsTags(), loadSettingsIndustries(), loadSettingsJobTitles()]).then(() => result);
      })
      .then((result) => {
        toast.success(
          `Populated ${result.industriesAdded} industries, ${result.tagsAdded} tags, ${result.jobTitlesAdded} job titles from current client data.`
        );
      })
      .catch(() => {
        hasAutoSyncedRef.current = false;
        toast.error('Failed to populate from client data');
      });
  }, [
    canManageTagsIndustries,
    initialSettingsListsLoaded,
    settingsTags.length,
    settingsIndustries.length,
    settingsJobTitles.length,
    loadSettingsTags,
    loadSettingsIndustries,
    loadSettingsJobTitles,
  ]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try {
      await createSettingsTag(newTagName.trim());
      toast.success('Tag added successfully');
      setNewTagName('');
      setIsAddTagOpen(false);
      loadSettingsTags();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add tag');
    }
  };

  const handleEditTag = async () => {
    if (!editingTag || !editedTagName.trim()) return;
    try {
      await updateSettingsTag(editingTag.id, editedTagName.trim());
      toast.success('Tag updated successfully');
      setEditingTag(null);
      setEditedTagName('');
      setIsEditTagOpen(false);
      loadSettingsTags();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update tag');
    }
  };

  const handleDeleteTag = async () => {
    if (!deletingTag) return;
    try {
      await deleteSettingsTag(deletingTag.id);
      toast.success('Tag deleted successfully');
      setDeletingTag(null);
      setIsDeleteTagOpen(false);
      loadSettingsTags();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete tag');
    }
  };

  const openEditTagDialog = (tag: SettingsTag) => {
    setEditingTag(tag);
    setEditedTagName(tag.tag);
    setIsEditTagOpen(true);
  };

  const openDeleteTagDialog = (tag: SettingsTag) => {
    setDeletingTag(tag);
    setIsDeleteTagOpen(true);
  };

  const handleAddIndustry = async () => {
    if (!newIndustryName.trim()) return;
    try {
      await createSettingsIndustry(newIndustryName.trim());
      toast.success('Industry added successfully');
      setNewIndustryName('');
      setIsAddIndustryOpen(false);
      loadSettingsIndustries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add industry');
    }
  };

  const handleEditIndustry = async () => {
    if (!editingIndustry || !editedIndustryName.trim()) return;
    try {
      await updateSettingsIndustry(editingIndustry.id, editedIndustryName.trim());
      toast.success('Industry updated successfully');
      setEditingIndustry(null);
      setEditedIndustryName('');
      setIsEditIndustryOpen(false);
      loadSettingsIndustries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update industry');
    }
  };

  const openEditIndustryDialog = (ind: SettingsIndustry) => {
    setEditingIndustry(ind);
    setEditedIndustryName(ind.name);
    setIsEditIndustryOpen(true);
  };

  const openDeleteIndustryDialog = (ind: SettingsIndustry) => {
    setDeletingIndustry(ind);
    setIsDeleteIndustryOpen(true);
  };

  const handleAddJobTitle = async () => {
    if (!newJobTitleName.trim()) return;
    try {
      await createSettingsJobTitle(newJobTitleName.trim());
      toast.success('Job title added successfully');
      setNewJobTitleName('');
      setIsAddJobTitleOpen(false);
      loadSettingsJobTitles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add job title');
    }
  };

  const handleEditJobTitle = async () => {
    if (!editingJobTitle || !editedJobTitleName.trim()) return;
    try {
      await updateSettingsJobTitle(editingJobTitle.id, editedJobTitleName.trim());
      toast.success('Job title updated successfully');
      setEditingJobTitle(null);
      setEditedJobTitleName('');
      setIsEditJobTitleOpen(false);
      loadSettingsJobTitles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update job title');
    }
  };

  const handleDeleteJobTitle = async () => {
    if (!deletingJobTitle) return;
    try {
      await deleteSettingsJobTitle(deletingJobTitle.id);
      toast.success('Job title deleted successfully');
      setDeletingJobTitle(null);
      setIsDeleteJobTitleOpen(false);
      loadSettingsJobTitles();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete job title');
    }
  };

  const openEditJobTitleDialog = (jt: SettingsJobTitle) => {
    setEditingJobTitle(jt);
    setEditedJobTitleName(jt.name);
    setIsEditJobTitleOpen(true);
  };

  const openDeleteJobTitleDialog = (jt: SettingsJobTitle) => {
    setDeletingJobTitle(jt);
    setIsDeleteJobTitleOpen(true);
  };

  const handleDeleteIndustry = async () => {
    if (!deletingIndustry) return;
    try {
      await deleteSettingsIndustry(deletingIndustry.id);
      toast.success('Industry deleted successfully');
      setDeletingIndustry(null);
      setIsDeleteIndustryOpen(false);
      loadSettingsIndustries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete industry');
    }
  };

  const handleAddStage = () => {
    if (newStageLabel.trim()) {
      addPipelineStage(newStageLabel, newStageColor);
      setNewStageLabel('');
      setNewStageColor('#3b82f6');
      setIsAddStageOpen(false);
      toast.success('Pipeline stage added successfully');
    }
  };

  const handleEditStage = () => {
    if (editingStage && editedStageLabel.trim()) {
      updatePipelineStage(editingStage, editedStageLabel, editedStageColor);
      setIsEditStageOpen(false);
      toast.success('Pipeline stage updated successfully');
    }
  };

  const handleDeleteStage = () => {
    deletePipelineStage(deletingStage);
    toast.success('Pipeline stage deleted successfully');
    setDeletingStage('');
    setIsDeleteStageOpen(false);
  };

  const openEditStageDialog = (stageId: string) => {
    const stage = pipelineStages.find(s => s.id === stageId);
    if (stage && !stage.isFixed) {
      setEditingStage(stageId);
      setEditedStageLabel(stage.label);
      setEditedStageColor(stage.color);
      setIsEditStageOpen(true);
    }
  };

  const openDeleteStageDialog = (stageId: string) => {
    setDeletingStage(stageId);
    setIsDeleteStageOpen(true);
  };

  const handleDragStart = (stageId: string) => {
    setDraggedStage(stageId);
  };

  const handleDragOver = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    if (!draggedStage || draggedStage === targetStageId) return;

    const draggedIndex = pipelineStages.findIndex(s => s.id === draggedStage);
    const targetIndex = pipelineStages.findIndex(s => s.id === targetStageId);
    
    const draggedStageObj = pipelineStages[draggedIndex];
    const targetStageObj = pipelineStages[targetIndex];
    
    // Don't allow reordering fixed stages
    if (draggedStageObj.isFixed || targetStageObj.isFixed) return;

    const newStages = [...pipelineStages];
    newStages.splice(draggedIndex, 1);
    newStages.splice(targetIndex, 0, draggedStageObj);
    
    reorderPipelineStages(newStages);
  };

  const handleDragEnd = () => {
    setDraggedStage(null);
  };
  
  // Activity log filtering — uses live API data, not mock store
  // Exclude raw API audit entries (type='audit') — those are for debugging only
  const filteredActivities = liveActivityLogs
    .filter(log => log.type !== 'audit')
    .filter(log => {
      if (activityTypeFilter === 'all') return true;
      return log.type === activityTypeFilter;
    })
    .filter(log => {
      if (!activitySearch) return true;
      const searchLower = activitySearch.toLowerCase();
      return (
        log.description.toLowerCase().includes(searchLower) ||
        log.userName.toLowerCase().includes(searchLower) ||
        log.metadata?.clientName?.toLowerCase().includes(searchLower)
      );
    })
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return <Phone className="h-4 w-4" />;
      case 'email_sent':
        return <Mail className="h-4 w-4" />;
      case 'break_detected':
        return <Coffee className="h-4 w-4" />;
      case 'idle_detected':
        return <Clock className="h-4 w-4" />;
      case 'pipeline_moved':
        return <ArrowRight className="h-4 w-4" />;
      case 'task_created':
      case 'task_status_changed':
        return <CheckSquare className="h-4 w-4" />;
      case 'task_completed':
        return <CheckCheck className="h-4 w-4" />;
      case 'meeting_scheduled':
        return <Calendar className="h-4 w-4" />;
      case 'follow_up_created':
        return <CalendarClock className="h-4 w-4" />;
      case 'follow_up_completed':
        return <CheckCheck className="h-4 w-4" />;
      case 'follow_up_reopened':
        return <RotateCcw className="h-4 w-4" />;
      case 'follow_up_rescheduled':
        return <RefreshCw className="h-4 w-4" />;
      case 'comment_added':
        return <MessageSquare className="h-4 w-4" />;
      case 'lead_request':
        return <UserPlus className="h-4 w-4" />;
      case 'lead_request_approved':
      case 'approval_granted':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'lead_request_rejected':
      case 'approval_rejected':
        return <XCircle className="h-4 w-4" />;
      case 'approval_requested':
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
      case 'meeting_scheduled':
        return 'text-blue-600 dark:text-blue-400';
      case 'email_sent':
        return 'text-purple-600 dark:text-purple-400';
      case 'task_completed':
      case 'lead_request_approved':
      case 'approval_granted':
        return 'text-green-600 dark:text-green-400';
      case 'lead_request_rejected':
      case 'approval_rejected':
        return 'text-red-600 dark:text-red-400';
      case 'break_detected':
      case 'idle_detected':
        return 'text-orange-600 dark:text-orange-400';
      case 'pipeline_moved':
        return 'text-cyan-600 dark:text-cyan-400';
      case 'follow_up_created':
        return 'text-violet-600 dark:text-violet-400';
      case 'follow_up_completed':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'follow_up_reopened':
        return 'text-amber-600 dark:text-amber-400';
      case 'follow_up_rescheduled':
        return 'text-cyan-600 dark:text-cyan-400';
      default:
        return 'text-gray-600 dark:text-gray-400';
    }
  };
  
  return (
    <div className="space-y-6">
      <div className="pt-6">
        <h1 className="text-3xl font-bold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage approvals, templates, and notifications
        </p>
      </div>

      <Tabs
        value={tabFromUrl}
        onValueChange={(v) => setSearchParams({ tab: v })}
        className="space-y-4"
      >
        <StickyHeader>
          <div className="overflow-x-auto pb-0.5 scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent">
            <TabsList className="inline-flex w-max">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="availability">
                <CalendarClock className="h-4 w-4 mr-1" />
                Availability
              </TabsTrigger>
              {canManageLoginBrandingTab && (
                <TabsTrigger value="company">
                  <LogIn className="h-4 w-4 mr-1" />
                  Company
                </TabsTrigger>
              )}
              {canManageTagsIndustries && (
                <TabsTrigger value="tags">
                  <TagIcon className="h-4 w-4 mr-1" />
                  Tags <span className="ml-1 text-xs">({settingsTagsTotalCount})</span>
                </TabsTrigger>
              )}
              {canManageTagsIndustries && (
                <TabsTrigger value="industries">
                  <Factory className="h-4 w-4 mr-1" />
                  Industries <span className="ml-1 text-xs">({settingsIndustriesTotalCount})</span>
                </TabsTrigger>
              )}
              {canManageTagsIndustries && (
                <TabsTrigger value="job-titles">
                  <Briefcase className="h-4 w-4 mr-1" />
                  Job Titles <span className="ml-1 text-xs">({settingsJobTitlesTotalCount})</span>
                </TabsTrigger>
              )}
              {canManageTagsIndustries && (
                <TabsTrigger value="requests">
                  <Inbox className="h-4 w-4 mr-1" />
                  Requests
                  {requestsPendingCount > 0 && (
                    <Badge variant="destructive" className="ml-1">
                      {requestsPendingCount}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
              {canManageAgencyPipeline && <TabsTrigger value="pipeline">Pipeline</TabsTrigger>}
              {canManageAgencyPipeline && <TabsTrigger value="jobs">Jobs</TabsTrigger>}
              {canManageScripts && <TabsTrigger value="scripts">Scripts</TabsTrigger>}
              {(isSuperAdmin || canManageProposalDefaults || canManageReviewTemplates) && (
                <TabsTrigger value="agencies">
                  <Building2 className="h-4 w-4 mr-1" />
                  Agencies
                </TabsTrigger>
              )}
              {canManageProposalDefaults && (
                <TabsTrigger value="recruitment-agreement">
                  <FileText className="h-4 w-4 mr-1" />
                  Recruitment
                </TabsTrigger>
              )}
              {canLinkAgencies && (
                <TabsTrigger value="linked-accounts">
                  <Link2 className="h-4 w-4 mr-1" />
                  Linked Accounts
                </TabsTrigger>
              )}
              {isSuperAdmin && (
                <TabsTrigger value="bug-report-emails">
                  <Bug className="h-4 w-4 mr-1" />
                  Bug Emails
                </TabsTrigger>
              )}
              {canSeeClientVisibilityTab && (
                <TabsTrigger value="approvals">
                  Approvals
                </TabsTrigger>
              )}
              {canSeeClientVisibilityTab && (
                <TabsTrigger value="client-visibility">
                  Visibility
                </TabsTrigger>
              )}
              {canSeeClientVisibilityTab && (
                <TabsTrigger value="daily-reports">
                  <Mail className="h-4 w-4 mr-1" />
                  Daily Reports
                </TabsTrigger>
              )}
              {canSeeClientVisibilityTab && (
                <TabsTrigger value="email-cutoff">
                  <Clock className="h-4 w-4 mr-1" />
                  Email Window
                </TabsTrigger>
              )}
              {canSeeClientVisibilityTab && (
                <TabsTrigger value="idle-time">
                  <Clock className="h-4 w-4 mr-1" />
                  Idle Time
                </TabsTrigger>
              )}
              {canManageTargets && (
                <TabsTrigger value="performance-targets">
                  <Target className="h-4 w-4 mr-1" />
                  Targets
                </TabsTrigger>
              )}
              <TabsTrigger value="templates">Templates</TabsTrigger>
              {canApprove && <TabsTrigger value="notifications">Notifications</TabsTrigger>}
              {canManageRoles && (
                <TabsTrigger value="roles">
                  <Shield className="h-4 w-4 mr-1" />
                  Roles
                </TabsTrigger>
              )}
              {canConfigureClientNotes && (
                <TabsTrigger value="client-notes">
                  <ClipboardList className="h-4 w-4 mr-1" />
                  Client Notes
                </TabsTrigger>
              )}
              <TabsTrigger value="phone-system">
                <Phone className="h-4 w-4 mr-1" />
                Phone System
              </TabsTrigger>
              {canManageHubstaff && (
                <TabsTrigger value="hubstaff">
                  <Timer className="h-4 w-4 mr-1" />
                  Hubstaff
                </TabsTrigger>
              )}
            </TabsList>
          </div>
        </StickyHeader>

        {/* Activity Tab */}
        <TabsContent value="activity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Activity Log</CardTitle>
              <CardDescription className="text-muted-foreground">
                Showing your own activity. Team and agency reports live under Reports.
              </CardDescription>
              <div className="flex flex-col sm:flex-row flex-wrap gap-3 mt-4">
                <Input
                  placeholder="Search activities..."
                  value={activitySearch}
                  onChange={(e) => setActivitySearch(e.target.value)}
                  className="sm:max-w-sm"
                />
                <Select
                  value={activityTypeFilter}
                  onValueChange={(value) => setActivityTypeFilter(value as ActivityType | 'all')}
                >
                  <SelectTrigger className="sm:w-48">
                    <SelectValue placeholder="Filter by type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Activities</SelectItem>
                    <SelectItem value="call_made">Calls</SelectItem>
                    <SelectItem value="email_sent">Emails</SelectItem>
                    <SelectItem value="meeting_scheduled">Meetings</SelectItem>
                    <SelectItem value="task_created">Tasks</SelectItem>
                    <SelectItem value="pipeline_moved">Pipeline</SelectItem>
                    <SelectItem value="lead_request">Lead Requests</SelectItem>
                    <SelectItem value="break_detected">Breaks</SelectItem>
                    <SelectItem value="idle_detected">Idle Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              {activityLoading ? (
                <div className="text-center py-12 text-muted-foreground">Loading activities…</div>
              ) : filteredActivities.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No activities found
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredActivities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                    >
                      <div className={`mt-0.5 ${getActivityColor(activity.type)}`}>
                        {getActivityIcon(activity.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className="text-sm font-medium">{activity.description}</p>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span>{activity.userName}</span>
                              <span>•</span>
                              <span>{format(new Date(activity.timestamp), 'MMM d, yyyy h:mm a')}</span>
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {activity.type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                          <div className="mt-2 text-xs text-muted-foreground space-y-1">
                            {activity.metadata.clientName && (
                              <div>Client: {activity.metadata.clientName}</div>
                            )}
                            {activity.metadata.duration !== undefined && (
                              <div>Duration: {activity.metadata.duration} minutes</div>
                            )}
                            {activity.metadata.recipientEmail && (
                              <div>To: {activity.metadata.recipientEmail}</div>
                            )}
                            {activity.metadata.fromStage && activity.metadata.toStage && (
                              <div>
                                {activity.metadata.fromStage.replace(/_/g, ' ')} → {activity.metadata.toStage.replace(/_/g, ' ')}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Tags Management Tab */}
        {canManageTagsIndustries && (
          <TabsContent value="tags">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <TagIcon className="h-5 w-5" />
                    Tags Management <span className="text-muted-foreground font-normal">({settingsTagsTotalCount} in use)</span>
                  </CardTitle>
                  <Dialog open={isAddTagOpen} onOpenChange={setIsAddTagOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Tag
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Add New Tag</DialogTitle>
                        <DialogDescription>
                          Create a new tag that can be used to categorize clients
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="new-tag">Tag Name</Label>
                          <Input
                            id="new-tag"
                            placeholder="e.g., High Priority"
                            value={newTagName}
                            onChange={(e) => setNewTagName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleAddTag();
                              }
                            }}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddTagOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddTag}>Add Tag</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {settingsTags.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No tags available. Add your first tag to get started.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {settingsTags.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <Badge variant="secondary" className="text-sm">
                          {t.tag} {t.count > 0 && <span className="ml-1 text-muted-foreground">({t.count})</span>}
                        </Badge>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditTagDialog(t)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openDeleteTagDialog(t)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={isEditTagOpen} onOpenChange={setIsEditTagOpen}>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Tag</DialogTitle>
                  <DialogDescription>
                    Update the tag name. This will update it for all clients using this tag.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-tag">Tag Name</Label>
                    <Input
                      id="edit-tag"
                      value={editedTagName}
                      onChange={(e) => setEditedTagName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEditTag()}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditTagOpen(false)}>Cancel</Button>
                  <Button onClick={handleEditTag}>Update Tag</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog open={isDeleteTagOpen} onOpenChange={setIsDeleteTagOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Tag</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the tag &quot;{deletingTag?.tag}&quot;? This will remove it from all clients.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteTag} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        )}

        {/* Industries Management Tab */}
        {canManageTagsIndustries && (
          <TabsContent value="industries">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Factory className="h-5 w-5" />
                    Industries <span className="text-muted-foreground font-normal">({settingsIndustriesTotalCount} in use)</span>
                  </CardTitle>
                  <Dialog open={isAddIndustryOpen} onOpenChange={setIsAddIndustryOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Industry
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Add Industry</DialogTitle>
                        <DialogDescription>Add an industry that can be selected when adding clients.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="new-industry">Industry Name</Label>
                          <Input
                            id="new-industry"
                            placeholder="e.g., Technology"
                            value={newIndustryName}
                            onChange={(e) => setNewIndustryName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddIndustry()}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddIndustryOpen(false)}>Cancel</Button>
                        <Button onClick={handleAddIndustry}>Add Industry</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {settingsIndustries.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No industries yet. Add your first industry.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {settingsIndustries.map((i) => (
                      <div
                        key={i.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-sm font-medium">
                          {i.name} {i.count > 0 && <span className="text-muted-foreground">({i.count})</span>}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditIndustryDialog(i)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openDeleteIndustryDialog(i)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={isEditIndustryOpen} onOpenChange={setIsEditIndustryOpen}>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Industry</DialogTitle>
                  <DialogDescription>Update the industry name.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-industry">Industry Name</Label>
                    <Input
                      id="edit-industry"
                      value={editedIndustryName}
                      onChange={(e) => setEditedIndustryName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEditIndustry()}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditIndustryOpen(false)}>Cancel</Button>
                  <Button onClick={handleEditIndustry}>Update Industry</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog open={isDeleteIndustryOpen} onOpenChange={setIsDeleteIndustryOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Industry</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to remove &quot;{deletingIndustry?.name}&quot; from the list?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteIndustry} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        )}

        {/* Job Titles Management Tab */}
        {canManageTagsIndustries && (
          <TabsContent value="job-titles">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Briefcase className="h-5 w-5" />
                    Job Titles <span className="text-muted-foreground font-normal">({settingsJobTitlesTotalCount} in use)</span>
                  </CardTitle>
                  <Dialog open={isAddJobTitleOpen} onOpenChange={setIsAddJobTitleOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Job Title
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Add Job Title</DialogTitle>
                        <DialogDescription>Add a job title that can be selected for contacts when adding clients.</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="new-job-title">Job Title</Label>
                          <Input
                            id="new-job-title"
                            placeholder="e.g., Chief of Staff"
                            value={newJobTitleName}
                            onChange={(e) => setNewJobTitleName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddJobTitle()}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddJobTitleOpen(false)}>Cancel</Button>
                        <Button onClick={handleAddJobTitle}>Add Job Title</Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {settingsJobTitles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No job titles yet. Add your first job title.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {settingsJobTitles.map((j) => (
                      <div
                        key={j.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <span className="text-sm font-medium">
                          {j.name} {j.count > 0 && <span className="text-muted-foreground">({j.count})</span>}
                        </span>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => openEditJobTitleDialog(j)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openDeleteJobTitleDialog(j)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Dialog open={isEditJobTitleOpen} onOpenChange={setIsEditJobTitleOpen}>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Edit Job Title</DialogTitle>
                  <DialogDescription>Update the job title name.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-job-title">Job Title</Label>
                    <Input
                      id="edit-job-title"
                      value={editedJobTitleName}
                      onChange={(e) => setEditedJobTitleName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleEditJobTitle()}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditJobTitleOpen(false)}>Cancel</Button>
                  <Button onClick={handleEditJobTitle}>Update Job Title</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog open={isDeleteJobTitleOpen} onOpenChange={setIsDeleteJobTitleOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Job Title</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to remove &quot;{deletingJobTitle?.name}&quot; from the list?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDeleteJobTitle} className="bg-destructive text-destructive-foreground">
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        )}

        {/* Requests Tab */}
        {canManageTagsIndustries && (
          <TabsContent value="requests">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Inbox className="h-5 w-5" />
                  Pending Requests
                  {requestsPendingCount > 0 && (
                    <Badge variant="destructive">{requestsPendingCount}</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  Approve or reject requests for new industries and tags. Requesters are notified by email and in-app notification.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {industryRequests.length === 0 && tagRequests.length === 0 && jobTitleRequests.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No pending requests.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {industryRequests.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Industry requests</h4>
                        <ul className="space-y-2">
                          {industryRequests.map((r) => (
                            <li key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                              <div>
                                <span className="font-medium">{r.name}</span>
                                <span className="text-muted-foreground text-sm ml-2">
                                  requested by {r.requestedBy.firstName} {r.requestedBy.lastName} · {r.subCompany.name}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="default" onClick={async () => { await approveIndustryRequest(r.id); loadRequests(); loadSettingsIndustries(); toast.success('Approved'); }}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={async () => { await rejectIndustryRequest(r.id); loadRequests(); toast.success('Rejected'); }}>
                                  Reject
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {tagRequests.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Tag requests</h4>
                        <ul className="space-y-2">
                          {tagRequests.map((r) => (
                            <li key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                              <div>
                                <span className="font-medium">{r.name}</span>
                                <span className="text-muted-foreground text-sm ml-2">
                                  requested by {r.requestedBy.firstName} {r.requestedBy.lastName} · {r.subCompany.name}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="default" onClick={async () => { await approveTagRequest(r.id); loadRequests(); loadSettingsTags(); toast.success('Approved'); }}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={async () => { await rejectTagRequest(r.id); loadRequests(); toast.success('Rejected'); }}>
                                  Reject
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {jobTitleRequests.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium mb-2">Job title requests</h4>
                        <ul className="space-y-2">
                          {jobTitleRequests.map((r) => (
                            <li key={r.id} className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                              <div>
                                <span className="font-medium">{r.name}</span>
                                <span className="text-muted-foreground text-sm ml-2">
                                  requested by {r.requestedBy.firstName} {r.requestedBy.lastName} · {r.subCompany.name}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                <Button size="sm" variant="default" onClick={async () => { await approveJobTitleRequest(r.id); loadRequests(); loadSettingsJobTitles(); toast.success('Approved'); }}>
                                  Approve
                                </Button>
                                <Button size="sm" variant="outline" onClick={async () => { await rejectJobTitleRequest(r.id); loadRequests(); toast.success('Rejected'); }}>
                                  Reject
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Pipeline Configuration Tab - Director Only */}
        {canManageAgencyPipeline && (
          <PipelineConfigTab
            pipelineStages={pipelineStages}
            isAddStageOpen={isAddStageOpen}
            setIsAddStageOpen={setIsAddStageOpen}
            newStageLabel={newStageLabel}
            setNewStageLabel={setNewStageLabel}
            newStageColor={newStageColor}
            setNewStageColor={setNewStageColor}
            handleAddStage={handleAddStage}
            isEditStageOpen={isEditStageOpen}
            setIsEditStageOpen={setIsEditStageOpen}
            editedStageLabel={editedStageLabel}
            setEditedStageLabel={setEditedStageLabel}
            editedStageColor={editedStageColor}
            setEditedStageColor={setEditedStageColor}
            handleEditStage={handleEditStage}
            isDeleteStageOpen={isDeleteStageOpen}
            setIsDeleteStageOpen={setIsDeleteStageOpen}
            deletingStage={deletingStage}
            handleDeleteStage={handleDeleteStage}
            openEditStageDialog={openEditStageDialog}
            openDeleteStageDialog={openDeleteStageDialog}
            handleDragStart={handleDragStart}
            handleDragOver={handleDragOver}
            handleDragEnd={handleDragEnd}
            draggedStage={draggedStage}
          />
        )}
        
        <TabsContent value="templates" className="space-y-6">
          <EmailTemplatesSection />
          <AutoSignatureCard />
        </TabsContent>
        
        {canApprove && (
          <TabsContent value="notifications">
            <NotificationsSection canManageRules={canApprove} />
          </TabsContent>
        )}

        {canManageRoles && (
          <TabsContent value="roles">
            <RolesPermissionsTab />
          </TabsContent>
        )}

        {canConfigureClientNotes && (
          <TabsContent value="client-notes" className="space-y-4 mt-6">
            <ClientNotesTab />
          </TabsContent>
        )}

        <PhoneSystemTab isActive={tabFromUrl === 'phone-system'} />

        {canManageHubstaff && <HubstaffTab />}

        {/* Agencies Tab - super_admin / director / operations_manager. "Add Agency" stays super-admin only. */}
        {(isSuperAdmin || canManageProposalDefaults || canManageReviewTemplates) && (
          <TabsContent value="agencies" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Building2 className="h-5 w-5" />
                    Agencies
                  </CardTitle>
                  {isSuperAdmin && (
                  <Dialog open={isAddAgencyOpen} onOpenChange={(open) => { setIsAddAgencyOpen(open); if (!open) setAgencyName(''); }}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Agency
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Create Agency</DialogTitle>
                        <DialogDescription>
                          Add a new agency (sub-company). Users are assigned to an agency when created. All agencies are under the main organization.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="agency-name">Name</Label>
                          <Input
                            id="agency-name"
                            placeholder="e.g. Wudox Toronto"
                            value={agencyName}
                            onChange={(e) => setAgencyName(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setIsAddAgencyOpen(false)}>Cancel</Button>
                        <Button
                          onClick={async () => {
                            if (!agencyName.trim()) {
                              toast.error('Name is required');
                              return;
                            }
                            try {
                              await createSubCompany({ name: agencyName.trim(), mainOrgId: 'main-org-001' });
                              toast.success('Agency created. Add a Company Director in Super Users, then create Sales Managers for that agency.');
                              setIsAddAgencyOpen(false);
                              setAgencyName('');
                              loadAgencies();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'Failed to create agency');
                            }
                          }}
                        >
                          Create
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Each user belongs to one agency. You are currently in: <strong>{currentSubCompany?.name}</strong>.
                  Edit an agency to change its <strong>organization name</strong> (internal record),{' '}
                  <strong>email footer</strong>, and <strong>agency</strong> logo URL (sidebar for all staff at that
                  agency). <strong>Company</strong> display name and <strong>company</strong> logo for the public
                  sign-in page are only under <strong>Company</strong> in Settings — directors and super admins (switch
                  agency in the header first).
                </p>
              </CardHeader>
              <CardContent>
                {agenciesLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Loading agencies...</div>
                ) : subCompanies.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No agencies yet. Create one to get started.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {subCompanies.map((agency) => (
                      <div
                        key={agency.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {resolveAgencyLogoSrc(agency.agencyLogoUrl, agency.id) ? (
                            <img
                              src={resolveAgencyLogoSrc(agency.agencyLogoUrl, agency.id)!}
                              alt=""
                              className="h-10 w-10 shrink-0 rounded-md object-contain border border-border bg-background"
                            />
                          ) : (
                            <div
                              className="h-10 w-10 shrink-0 rounded-md border border-dashed border-muted-foreground/30 bg-muted/40"
                              aria-hidden
                            />
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate">{agency.name}</p>
                            {agency.appProjectName?.trim() ? (
                              <p className="text-xs text-muted-foreground truncate">
                                Company display: {agency.appProjectName.trim()}
                              </p>
                            ) : null}
                            {agency.agencyEmail?.trim() || agency.agencyPhone?.trim() ? (
                              <p className="text-xs text-muted-foreground truncate">
                                {[agency.agencyEmail?.trim(), agency.agencyPhone?.trim()].filter(Boolean).join(' · ')}
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingAgency(agency);
                            setAgencyName(agency.name);
                            setAgencyEmailFooter(agency.emailFooterText ?? '');
                            setAgencyEmailTagline(agency.emailTagline ?? '');
                            setEditAgencyAgencyLogoUrl(agency.agencyLogoUrl ?? '');
                            setLogoPreviewSrc(resolveLogoPreview(agency.agencyLogoUrl ?? '', agency.id));
                            setEditAgencyEmail(agency.agencyEmail ?? '');
                            setEditAgencyPhone(agency.agencyPhone ?? '');
                            setEditEmailFromAddress(agency.emailFromAddress ?? '');
                            setEditEmailFromName(agency.emailFromName ?? '');
                            setEditEmailSendAsDomain(agency.emailSendAsDomain ?? '');
                            setEditEmailInboundDomain(agency.emailInboundDomain ?? '');
                            setEditEmailInboundLocalpart(agency.emailInboundLocalpart ?? '');
                            setIsEditAgencyOpen(true);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Dialog open={isEditAgencyOpen} onOpenChange={(open) => {
              if (!open) {
                setEditingAgency(null);
                setAgencyName('');
                setAgencyEmailFooter('');
                setAgencyEmailTagline('');
                setEditAgencyAgencyLogoUrl('');
                setLogoPreviewSrc(null);
                if (logoPreviewObjUrlRef.current) { URL.revokeObjectURL(logoPreviewObjUrlRef.current); logoPreviewObjUrlRef.current = null; }
                setEditAgencyEmail('');
                setEditAgencyPhone('');
                setEditEmailFromAddress('');
                setEditEmailFromName('');
                setEditEmailSendAsDomain('');
                setEditEmailInboundDomain('');
                setEditEmailInboundLocalpart('');
                setEditAgencyTab('settings');
                setSigningAuthorities([]);
                setSigningAuthorityForm(null);
              }
              setIsEditAgencyOpen(open);
            }}
            >
              <DialogContent className="sm:max-w-4xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden h-[92vh] max-h-[92vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center gap-3 px-6 pt-6 pb-4 border-b bg-muted/30 shrink-0">
                  <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0">
                    <Building2 className="w-4.5 h-4.5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="text-base font-semibold leading-tight">Edit Agency</DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{editingAgency?.name}</p>
                  </div>
                </div>

                {/* Tabs */}
                <Tabs value={editAgencyTab} onValueChange={setEditAgencyTab} className="flex flex-col flex-1 min-h-0">
                  <TabsList className="w-full rounded-none border-b bg-transparent h-auto p-0 justify-start gap-0 flex-nowrap overflow-x-auto shrink-0 scrollbar-thin">
                    <TabsTrigger
                      value="settings"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      Settings
                    </TabsTrigger>
                    <TabsTrigger
                      value="email"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email Config
                      {(editEmailFromAddress || editEmailFromName || editEmailSendAsDomain) && (
                        <span className="ml-1 inline-flex items-center justify-center w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </TabsTrigger>
                    {canManageProposalDefaults && (
                      <TabsTrigger
                        value="proposal-defaults"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Proposal Defaults
                      </TabsTrigger>
                    )}
                    {canManageProposalDefaults && (
                      <TabsTrigger
                        value="proposal-templates"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Proposal Templates
                      </TabsTrigger>
                    )}
                    {canManageReviewTemplates && (
                      <TabsTrigger
                        value="review-templates"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Review Templates
                      </TabsTrigger>
                    )}
                    {isSuperAdmin && (
                      <TabsTrigger
                        value="signing-authority"
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <PenLine className="w-3.5 h-3.5" />
                        Signing Authority
                      </TabsTrigger>
                    )}
                    <TabsTrigger
                      value="integrations"
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:text-foreground gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Plug className="w-3.5 h-3.5" />
                      Integrations
                      {editingAgency?.googleCalendarConnected && (
                        <span className="ml-1 inline-flex items-center justify-center w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      )}
                    </TabsTrigger>
                  </TabsList>

                  {/* Settings Tab */}
                  <TabsContent value="settings" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                    <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">

                      {/* Organization */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Organization</p>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-agency-name" className="text-sm">Name <span className="text-destructive">*</span></Label>
                            <Input
                              id="edit-agency-name"
                              value={agencyName}
                              onChange={(e) => setAgencyName(e.target.value)}
                              className="h-9"
                            />
                          </div>
                        </div>
                      </div>

                      {/* Contact */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Contact</p>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-agency-email" className="text-sm">Email</Label>
                            <div className="relative">
                              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                              <Input
                                id="edit-agency-email"
                                type="email"
                                value={editAgencyEmail}
                                onChange={(e) => setEditAgencyEmail(e.target.value)}
                                placeholder="contact@agency.com"
                                maxLength={254}
                                className="h-9 pl-8"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-agency-phone" className="text-sm">Phone</Label>
                            <div className="relative">
                              <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                              <Input
                                id="edit-agency-phone"
                                type="tel"
                                value={editAgencyPhone}
                                readOnly
                                disabled
                                placeholder="Set in Phone System"
                                className="h-9 pl-8 bg-muted/50"
                              />
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Managed in Settings → Phone System → Number
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Email Footer */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Email Footer</p>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-agency-footer" className="text-sm">Company display name</Label>
                            <Input
                              id="edit-agency-footer"
                              value={agencyEmailFooter}
                              onChange={(e) => setAgencyEmailFooter(e.target.value)}
                              placeholder="e.g. HR Global"
                              maxLength={200}
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-agency-tagline" className="text-sm">Tagline</Label>
                            <Input
                              id="edit-agency-tagline"
                              value={agencyEmailTagline}
                              onChange={(e) => setAgencyEmailTagline(e.target.value)}
                              placeholder="e.g. Talent Solutions · Confidential"
                              maxLength={300}
                              className="h-9"
                            />
                          </div>
                          {(agencyEmailFooter || agencyEmailTagline) && (
                            <div className="flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
                              <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <p className="text-xs text-muted-foreground">
                                Footer: <em className="not-italic font-medium text-foreground">
                                  {[agencyEmailFooter, agencyEmailTagline].filter(Boolean).join(' · ')}
                                </em>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Logo */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Branding</p>
                        <div className="space-y-1.5">
                          <Label className="text-sm">Agency logo</Label>
                          <div className="flex items-center gap-2">
                            {/* Clickable thumbnail */}
                            <div
                              className="h-9 w-16 shrink-0 rounded border bg-muted/40 flex items-center justify-center overflow-hidden cursor-pointer relative group"
                              onClick={() => !editAgencyLogoUploading && editAgencyLogoInputRef.current?.click()}
                              title="Click to upload"
                            >
                              {logoPreviewSrc ? (
                                <img
                                  src={logoPreviewSrc}
                                  alt="logo"
                                  className="h-full w-full object-contain p-0.5"
                                />
                              ) : (
                                <Upload className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
                              )}
                              {editAgencyLogoUploading && (
                                <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                </div>
                              )}
                              {!editAgencyLogoUploading && logoPreviewSrc && (
                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Upload className="h-3 w-3 text-white" />
                                </div>
                              )}
                            </div>
                            {/* URL input */}
                            <div className="relative flex-1">
                              <Input
                                id="edit-agency-agency-logo"
                                value={editAgencyAgencyLogoUrl}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEditAgencyAgencyLogoUrl(v);
                                  if (!v.trim()) {
                                    setLogoPreviewSrc(null);
                                  } else if (v.startsWith('http://') || v.startsWith('https://')) {
                                    setLogoPreviewSrc(v.trim());
                                  }
                                }}
                                placeholder="https://… or click thumbnail to upload"
                                maxLength={2048}
                                className="h-9 pr-7 text-sm"
                              />
                              {editAgencyAgencyLogoUrl && (
                                <button
                                  type="button"
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setEditAgencyAgencyLogoUrl('');
                                    setLogoPreviewSrc(null);
                                    if (logoPreviewObjUrlRef.current) { URL.revokeObjectURL(logoPreviewObjUrlRef.current); logoPreviewObjUrlRef.current = null; }
                                  }}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <input
                            ref={editAgencyLogoInputRef}
                            type="file"
                            accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !editingAgency) return;
                              // Show immediate local preview
                              if (logoPreviewObjUrlRef.current) URL.revokeObjectURL(logoPreviewObjUrlRef.current);
                              const objUrl = URL.createObjectURL(file);
                              logoPreviewObjUrlRef.current = objUrl;
                              setLogoPreviewSrc(objUrl);
                              setEditAgencyLogoUploading(true);
                              try {
                                const url = await uploadAgencyLogo(editingAgency.id, file);
                                setEditAgencyAgencyLogoUrl(url);
                              } catch (err) {
                                toast.error((err as Error).message ?? 'Upload failed');
                                setLogoPreviewSrc(null);
                                if (logoPreviewObjUrlRef.current) { URL.revokeObjectURL(logoPreviewObjUrlRef.current); logoPreviewObjUrlRef.current = null; }
                              } finally {
                                setEditAgencyLogoUploading(false);
                                if (editAgencyLogoInputRef.current) editAgencyLogoInputRef.current.value = '';
                              }
                            }}
                          />
                          <p className="text-xs text-muted-foreground">Shown in sidebar and outbound emails.</p>
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Email Config Tab */}
                  <TabsContent value="email" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                    <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">

                      {/* Info banner */}
                      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3.5">
                        <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                          These override the global environment defaults for this agency only. All sender addresses must be verified in SendGrid before use.
                        </p>
                      </div>

                      {/* Outbound sender */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Outbound Sender</p>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-email-from-address" className="text-sm">From address</Label>
                            <div className="relative">
                              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                              <Input
                                id="edit-email-from-address"
                                type="email"
                                value={editEmailFromAddress}
                                onChange={(e) => setEditEmailFromAddress(e.target.value)}
                                placeholder="noreply@youragency.com"
                                maxLength={254}
                                className="h-9 pl-8"
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">System emails (proposals, meetings, alerts) will send from this address.</p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-email-from-name" className="text-sm">From name</Label>
                            <Input
                              id="edit-email-from-name"
                              value={editEmailFromName}
                              onChange={(e) => setEditEmailFromName(e.target.value)}
                              placeholder="e.g. Acme Staffing"
                              maxLength={100}
                              className="h-9"
                            />
                            <p className="text-xs text-muted-foreground">Display name shown to email recipients.</p>
                          </div>
                        </div>
                      </div>

                      {/* Per-user Send-As */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Per-User Send-As</p>
                        <div className="space-y-1.5">
                          <Label htmlFor="edit-email-send-as-domain" className="text-sm">Allowed domain</Label>
                          <Input
                            id="edit-email-send-as-domain"
                            value={editEmailSendAsDomain}
                            onChange={(e) => setEditEmailSendAsDomain(e.target.value)}
                            placeholder="acme.com"
                            maxLength={253}
                            className="h-9"
                          />
                          <p className="text-xs text-muted-foreground">
                            Associates with a matching <em>Send-As email</em> in their profile can send client emails from their own address. Domain must be SendGrid-authenticated.
                          </p>
                        </div>
                      </div>

                      {/* Inbound Parse (reply threading) */}
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Inbound Reply Parsing</p>
                        <div className="space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-email-inbound-domain" className="text-sm">Inbound Parse domain</Label>
                            <Input
                              id="edit-email-inbound-domain"
                              value={editEmailInboundDomain}
                              onChange={(e) => setEditEmailInboundDomain(e.target.value)}
                              placeholder="nacrm-reply.acme.com"
                              maxLength={253}
                              className="h-9"
                            />
                            <p className="text-xs text-muted-foreground">
                              Domain configured in SendGrid Inbound Parse for reply threading. Must match exactly.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="edit-email-inbound-localpart" className="text-sm">Reply-to local-part</Label>
                            <Input
                              id="edit-email-inbound-localpart"
                              value={editEmailInboundLocalpart}
                              onChange={(e) => setEditEmailInboundLocalpart(e.target.value)}
                              placeholder="subscriptions"
                              maxLength={64}
                              className="h-9"
                            />
                            <p className="text-xs text-muted-foreground">
                              Local-part prefix of the reply-to address (e.g. <em>subscriptions</em>+crmreply-…@domain).
                            </p>
                          </div>
                        </div>
                      </div>

                      {(editEmailFromAddress || editEmailFromName || editEmailSendAsDomain || editEmailInboundDomain || editEmailInboundLocalpart) && (
                        <div className="rounded-lg border bg-muted/40 p-3.5 space-y-1.5">
                          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Preview</p>
                          {editEmailFromAddress && (
                            <p className="text-xs text-foreground">From: <span className="font-medium">{editEmailFromName || '—'}</span> &lt;{editEmailFromAddress}&gt;</p>
                          )}
                          {editEmailSendAsDomain && (
                            <p className="text-xs text-foreground">Send-As domain: <span className="font-medium">@{editEmailSendAsDomain}</span></p>
                          )}
                          {(editEmailInboundLocalpart || editEmailInboundDomain) && (
                            <p className="text-xs text-foreground">Reply-to: <span className="font-medium">{editEmailInboundLocalpart || 'reply'}+crmreply-…@{editEmailInboundDomain || '…'}</span></p>
                          )}
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Proposal Defaults Tab — scoped to the agency being edited */}
                  {canManageProposalDefaults && (
                    <TabsContent value="proposal-defaults" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                      <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3.5">
                          <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                            Default files attachable to any proposal, and per-agency proposal/lead timers. These belong to <strong>{editingAgency?.name}</strong> only.
                          </p>
                        </div>
                        {proposalDefaultFilesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <>
                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Timers & Limits</p>
                              <div className="flex items-end gap-3 flex-wrap">
                                <div className="space-y-1.5">
                                  <Label htmlFor="ea-proposal-max-files" className="text-sm">Max files</Label>
                                  <Input
                                    id="ea-proposal-max-files"
                                    type="number"
                                    min={1}
                                    max={20}
                                    className="w-24 h-9"
                                    value={proposalMaxFiles}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      if (!isNaN(v) && v >= 1 && v <= 20) setProposalMaxFiles(v);
                                    }}
                                    disabled={proposalMaxFilesSaving}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="ea-proposal-awaiting-days" className="text-sm">Awaiting Client (days)</Label>
                                  <Input
                                    id="ea-proposal-awaiting-days"
                                    type="number"
                                    min={0}
                                    max={365}
                                    className="w-28 h-9"
                                    value={proposalAwaitingClientDays}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      if (!isNaN(v) && v >= 0 && v <= 365) setProposalAwaitingClientDays(v);
                                    }}
                                    disabled={proposalAwaitingClientSaving}
                                  />
                                </div>
                                <div className="space-y-1.5">
                                  <Label htmlFor="ea-lead-deadline-days" className="text-sm">Lead Deadline (days)</Label>
                                  <Input
                                    id="ea-lead-deadline-days"
                                    type="number"
                                    min={0}
                                    max={365}
                                    className="w-24 h-9"
                                    value={leadDeadlineDays}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      if (!isNaN(v) && v >= 0 && v <= 365) setLeadDeadlineDays(v);
                                    }}
                                    disabled={leadDeadlineSaving}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  disabled={proposalMaxFilesSaving || proposalAwaitingClientSaving || leadDeadlineSaving || !editingAgency?.id}
                                  onClick={async () => {
                                    if (!editingAgency?.id) return;
                                    setProposalAwaitingClientSaving(true);
                                    setProposalMaxFilesSaving(true);
                                    setLeadDeadlineSaving(true);
                                    try {
                                      await Promise.all([
                                        updateProposalDefaultSetting(proposalMaxFiles, editingAgency.id),
                                        updateProposalAwaitingClientDays(proposalAwaitingClientDays, editingAgency.id),
                                        updateLeadDeadlineDays(leadDeadlineDays, editingAgency.id),
                                      ]);
                                      toast.success('Settings saved');
                                    } catch {
                                      toast.error('Failed to save settings');
                                    } finally {
                                      setProposalAwaitingClientSaving(false);
                                      setProposalMaxFilesSaving(false);
                                      setLeadDeadlineSaving(false);
                                    }
                                  }}
                                >
                                  {(proposalMaxFilesSaving || proposalAwaitingClientSaving || leadDeadlineSaving) && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                                  Save
                                </Button>
                              </div>
                            </div>

                            <div>
                              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Default Files</p>
                              <p className="text-xs text-muted-foreground mb-3">Accepted: PDF, Word, Excel, images (max 10 MB each).</p>
                              <div className="space-y-2">
                                {proposalDefaultFiles.length === 0 && (
                                  <p className="text-sm text-muted-foreground">No default files uploaded for this agency yet.</p>
                                )}
                                {proposalDefaultFiles.map((file) => (
                                  <div key={file.id} className="flex items-center justify-between gap-2 p-3 border rounded-lg">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                                      <span className="text-sm font-medium truncate">{file.name}</span>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="shrink-0 text-destructive hover:text-destructive"
                                      onClick={async () => {
                                        if (!editingAgency?.id) return;
                                        try {
                                          await deleteProposalDefaultFile(file.id, editingAgency.id);
                                          setProposalDefaultFiles((prev) => prev.filter((f) => f.id !== file.id));
                                          toast.success('File removed');
                                        } catch {
                                          toast.error('Failed to remove file');
                                        }
                                      }}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                              </div>

                              {proposalDefaultFiles.length < proposalMaxFiles && (
                                <div className="mt-3">
                                  <Label
                                    htmlFor="ea-proposal-default-upload"
                                    className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 border rounded-md text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
                                  >
                                    {proposalDefaultUploading ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Upload className="h-4 w-4" />
                                    )}
                                    {proposalDefaultUploading ? 'Uploading...' : 'Upload Files'}
                                  </Label>
                                  <input
                                    id="ea-proposal-default-upload"
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                                    disabled={proposalDefaultUploading || !editingAgency?.id}
                                    onChange={async (e) => {
                                      if (!editingAgency?.id) return;
                                      const agencyId = editingAgency.id;
                                      const selected = Array.from(e.target.files ?? []);
                                      if (!selected.length) return;
                                      e.target.value = '';
                                      const slotsLeft = proposalMaxFiles - proposalDefaultFiles.length;
                                      const toUpload = selected.slice(0, slotsLeft);
                                      if (selected.length > slotsLeft) {
                                        toast.warning(`Only ${slotsLeft} slot${slotsLeft !== 1 ? 's' : ''} remaining — uploading first ${slotsLeft}`);
                                      }
                                      setProposalDefaultUploading(true);
                                      const results: typeof proposalDefaultFiles = [];
                                      for (const f of toUpload) {
                                        try {
                                          const base64 = await new Promise<string>((resolve, reject) => {
                                            const reader = new FileReader();
                                            reader.onload = () => resolve((reader.result as string).split(',')[1]);
                                            reader.onerror = reject;
                                            reader.readAsDataURL(f);
                                          });
                                          const uploaded = await uploadProposalDefaultFile({
                                            name: f.name,
                                            fileBase64: base64,
                                            mimeType: f.type || undefined,
                                          }, agencyId);
                                          results.push(uploaded);
                                        } catch (err) {
                                          toast.error(`${f.name}: ${err instanceof Error ? err.message : 'Failed to upload'}`);
                                        }
                                      }
                                      if (results.length) {
                                        setProposalDefaultFiles((prev) => [...prev, ...results]);
                                        toast.success(`${results.length} file${results.length !== 1 ? 's' : ''} uploaded`);
                                      }
                                      setProposalDefaultUploading(false);
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground mt-2">
                                    {proposalMaxFiles - proposalDefaultFiles.length} slot{proposalMaxFiles - proposalDefaultFiles.length !== 1 ? 's' : ''} remaining
                                  </p>
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </TabsContent>
                  )}

                  {/* Proposal Templates Tab — scoped to the agency being edited */}
                  {canManageProposalDefaults && (
                    <TabsContent value="proposal-templates" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                      <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3.5">
                          <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                            Map PandaDoc templates to proposal types for <strong>{editingAgency?.name}</strong>. When an associate of this agency picks a type, the mapped template auto-loads.
                          </p>
                        </div>
                        {proposalTypeTemplatesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : pandaDocTemplatesList.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No PandaDoc templates found. Make sure your PandaDoc integration is configured.</p>
                        ) : (
                          <>
                            <div className="space-y-2">
                              <Label>Temp Agreement Template</Label>
                              <Select
                                value={proposalTypeTemplates.tempTemplateId ?? '__none__'}
                                onValueChange={(v) =>
                                  setProposalTypeTemplates((prev) => ({
                                    ...prev,
                                    tempTemplateId: v === '__none__' ? null : v,
                                    tempTemplateName: v === '__none__' ? null : (pandaDocTemplatesList.find((t) => t.id === v)?.name ?? null),
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a template..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— No template —</SelectItem>
                                  {pandaDocTemplatesList.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-2">
                              <Label>Direct Placement Template</Label>
                              <Select
                                value={proposalTypeTemplates.directTemplateId ?? '__none__'}
                                onValueChange={(v) =>
                                  setProposalTypeTemplates((prev) => ({
                                    ...prev,
                                    directTemplateId: v === '__none__' ? null : v,
                                    directTemplateName: v === '__none__' ? null : (pandaDocTemplatesList.find((t) => t.id === v)?.name ?? null),
                                  }))
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select a template..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— No template —</SelectItem>
                                  {pandaDocTemplatesList.map((t) => (
                                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Employee Onboarding moved to Settings → Recruitment Agreement tab. */}

                            {/* bothTemplateId kept in API for legacy — hidden from Settings UI.
                            New Both sends use Temp + Direct templates above. */}

                            <Button
                              disabled={proposalTypeTemplatesSaving || !editingAgency?.id}
                              onClick={async () => {
                                if (!editingAgency?.id) return;
                                setProposalTypeTemplatesSaving(true);
                                try {
                                  await updateProposalTypeTemplates(proposalTypeTemplates, editingAgency.id);
                                  toast.success('Template mappings saved');
                                } catch {
                                  toast.error('Failed to save');
                                } finally {
                                  setProposalTypeTemplatesSaving(false);
                                }
                              }}
                            >
                              {proposalTypeTemplatesSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                              Save
                            </Button>
                          </>
                        )}
                      </div>
                    </TabsContent>
                  )}

                  {/* Review Templates Tab — scoped to the agency being edited */}
                  {canManageReviewTemplates && (
                    <TabsContent value="review-templates" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                      <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                        <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3.5">
                          <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                            PDF references for each agreement type used by <strong>{editingAgency?.name}</strong>. When an associate sends a proposal for review, the matching renderer fills in real values.
                          </p>
                        </div>
                        {reviewTemplatesLoading ? (
                          <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {([
                              {
                                label: 'Temp Agreement',
                                typeTag: 'Temp / Temp-to-Perm',
                                docType: 'temp_agreement' as const,
                                desc: 'Used when associate selects Temp or Temp-to-Permanent agreement type',
                                file: rtTempFile, setFile: setRtTempFile,
                                uploading: rtTempUploading, setUploading: setRtTempUploading,
                                accent: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
                                dot: 'bg-blue-500',
                              },
                              {
                                label: 'Direct Placement',
                                typeTag: 'Direct Placement',
                                docType: 'direct_placement' as const,
                                desc: 'Used when associate selects Direct Placement agreement type',
                                file: rtDirectFile, setFile: setRtDirectFile,
                                uploading: rtDirectUploading, setUploading: setRtDirectUploading,
                                accent: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
                                dot: 'bg-purple-500',
                              },
                              // both_agreement slot kept in backend for legacy proposals — hidden from Settings UI
                            ]).map(({ label, typeTag, docType, desc, file, setFile, uploading, setUploading, accent, dot }) => {
                              const mapped = reviewTemplates.find((t) => t.documentType === docType);

                              const handleUpload = async (f: File) => {
                                if (!editingAgency?.id) return;
                                setUploading(true);
                                try {
                                  const t = await uploadReviewTemplate(docType, f, editingAgency.id);
                                  setReviewTemplates((prev) => [t, ...prev.filter((x) => x.documentType !== docType)]);
                                  setFile(null);
                                  toast.success('Template uploaded');
                                } catch (err: any) {
                                  toast.error(err.message ?? 'Upload failed');
                                } finally {
                                  setUploading(false);
                                }
                              };

                              return (
                                <div key={docType} className="rounded-xl border bg-card shadow-sm overflow-hidden">
                                  <div className="flex items-start gap-4 px-5 pt-5 pb-4">
                                    <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${accent}`}>
                                      <FileText className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-semibold text-sm">{label}</span>
                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${accent}`}>
                                          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                                          {typeTag}
                                        </span>
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
                                    </div>
                                  </div>

                                  <div className="border-t mx-0" />

                                  <div className="px-5 py-4">
                                    {mapped ? (
                                      <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3 min-w-0">
                                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                          </div>
                                          <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{mapped.originalFilename}</p>
                                            <p className="text-xs text-muted-foreground">
                                              Uploaded by {mapped.uploadedBy?.firstName} {mapped.uploadedBy?.lastName}
                                            </p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-3 text-xs gap-1.5"
                                            onClick={async () => {
                                              if (!editingAgency?.id) return;
                                              try {
                                                const blob = await previewReviewTemplate(mapped.id, editingAgency.id);
                                                const url = URL.createObjectURL(blob);
                                                window.open(url, '_blank');
                                                setTimeout(() => URL.revokeObjectURL(url), 30000);
                                              } catch { toast.error('Preview failed'); }
                                            }}
                                          >
                                            <Eye className="h-3.5 w-3.5" />Preview
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 px-3 text-xs gap-1.5"
                                            onClick={async () => {
                                              if (!editingAgency?.id) return;
                                              try {
                                                const blob = await downloadReviewTemplate(mapped.id, editingAgency.id);
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url; a.download = mapped.originalFilename; a.click();
                                                URL.revokeObjectURL(url);
                                              } catch { toast.error('Download failed'); }
                                            }}
                                          >
                                            <Download className="h-3.5 w-3.5" />Download
                                          </Button>
                                          <label className="cursor-pointer">
                                            <Button variant="outline" size="sm" className="h-8 px-3 text-xs gap-1.5" asChild>
                                              <span>
                                                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                                                Replace
                                              </span>
                                            </Button>
                                            <input
                                              type="file"
                                              accept=".pdf,application/pdf"
                                              className="hidden"
                                              disabled={uploading}
                                              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }}
                                            />
                                          </label>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                            onClick={async () => {
                                              if (!editingAgency?.id) return;
                                              try {
                                                await deleteReviewTemplate(mapped.id, editingAgency.id);
                                                setReviewTemplates((prev) => prev.filter((x) => x.id !== mapped.id));
                                                toast.success('Template removed');
                                              } catch { toast.error('Failed to remove'); }
                                            }}
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <label className="block cursor-pointer">
                                        <div className="rounded-lg border-2 border-dashed border-muted-foreground/25 px-6 py-8 text-center transition-colors hover:border-muted-foreground/50 hover:bg-muted/30">
                                          <Upload className="h-7 w-7 text-muted-foreground/40 mx-auto mb-2" />
                                          <p className="text-sm font-medium text-muted-foreground">Upload PDF reference</p>
                                          <p className="text-xs text-muted-foreground/70 mt-0.5">Click to browse or drag & drop</p>
                                          {file && (
                                            <div className="mt-3 flex items-center justify-center gap-2" onClick={(e) => e.preventDefault()}>
                                              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{file.name}</span>
                                              <Button
                                                size="sm"
                                                className="h-7 px-3 text-xs"
                                                disabled={uploading}
                                                onClick={(e) => { e.preventDefault(); handleUpload(file); }}
                                              >
                                                {uploading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                                Upload
                                              </Button>
                                            </div>
                                          )}
                                        </div>
                                        <input
                                          type="file"
                                          accept=".pdf,application/pdf"
                                          className="hidden"
                                          disabled={uploading}
                                          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                        />
                                      </label>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  )}

                  {/* Signing Authority Tab */}
                  <TabsContent value="signing-authority" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                    <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
                      {signingAuthoritiesLoading ? (
                        <div className="grid grid-cols-2 gap-3">
                          {[0, 1].map((i) => (
                            <div key={i} className="rounded-xl border bg-muted/30 animate-pulse h-36" />
                          ))}
                        </div>
                      ) : signingAuthorities.length === 0 && !signingAuthorityForm ? (
                        <div className="flex flex-col items-center justify-center py-12 gap-5 text-center">
                          {/* Icon stack */}
                          <div className="relative">
                            <div className="w-16 h-16 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center">
                              <PenLine className="w-7 h-7 text-primary/60" />
                            </div>
                            <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center">
                              <Plus className="w-3 h-3 text-muted-foreground" />
                            </div>
                          </div>
                          {/* Text */}
                          <div className="space-y-1.5">
                            <p className="text-sm font-semibold">No signing authorities yet</p>
                            <p className="text-xs text-muted-foreground max-w-[200px] leading-relaxed">
                              Add the people authorised to sign documents on behalf of this agency.
                            </p>
                          </div>
                          {/* CTA */}
                          <Button size="sm" className="gap-1.5 shadow-sm" onClick={() => setSigningAuthorityForm({ mode: 'create' })}>
                            <Plus className="w-3.5 h-3.5" />
                            Add Signing Authority
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {/* Card grid */}
                          <div className="grid grid-cols-2 gap-3">
                              {signingAuthorities.map((auth) => (
                                <div
                                  key={auth.id}
                                  className="rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow relative"
                                >
                                  {auth.isPrimary && (
                                    <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 bg-amber-500 text-white text-[10px] font-semibold uppercase tracking-wide rounded-full px-2.5 py-1 shadow-sm">
                                      <Star className="w-2.5 h-2.5 fill-white stroke-none" />
                                      Primary
                                    </span>
                                  )}
                                  {/* Signature area */}
                                  <div className="flex flex-col items-center justify-center bg-muted/20 rounded-t-xl px-4 pt-5 pb-3 gap-1 min-h-[88px]">
                                    {auth.fontFamily === 'drawn' ? (
                                      <img
                                        src={auth.signatureData}
                                        alt={auth.name}
                                        className="max-h-[56px] max-w-full object-contain"
                                      />
                                    ) : (
                                      <span
                                        style={{ fontFamily: auth.fontFamily, fontSize: 28, lineHeight: 1 }}
                                        className="text-foreground/80"
                                      >
                                        {auth.name}
                                      </span>
                                    )}
                                    <div className="w-3/5 border-b border-foreground/15 mt-0.5" />
                                  </div>
                                  {/* Footer strip */}
                                  <div className="flex items-center justify-between px-3.5 py-2.5">
                                    <span className="text-sm font-medium truncate">{auth.name}</span>
                                    <DropdownMenu modal={false}>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="w-7 h-7 shrink-0">
                                          <MoreVertical className="w-3.5 h-3.5" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-44">
                                        <DropdownMenuItem onClick={() => setSigningAuthorityForm({ mode: 'edit', record: auth })}>
                                          <Pencil className="w-3.5 h-3.5 mr-2" />
                                          Edit
                                        </DropdownMenuItem>
                                        {!auth.isPrimary && (
                                          <DropdownMenuItem
                                            onClick={async () => {
                                              try {
                                                await setPrimarySigningAuthority(auth.id, editingAgency?.id);
                                                setSigningAuthorities((prev) =>
                                                  prev.map((a) => ({ ...a, isPrimary: a.id === auth.id })),
                                                );
                                              } catch {
                                                toast.error('Failed to set primary');
                                              }
                                            }}
                                          >
                                            <Star className="w-3.5 h-3.5 mr-2" />
                                            Set as Primary
                                          </DropdownMenuItem>
                                        )}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive"
                                          disabled={signingAuthorityDeleting === auth.id}
                                          onClick={async () => {
                                            setSigningAuthorityDeleting(auth.id);
                                            try {
                                              await deleteSigningAuthority(auth.id, editingAgency?.id);
                                              setSigningAuthorities((prev) => {
                                                const remaining = prev.filter((a) => a.id !== auth.id);
                                                if (auth.isPrimary && remaining.length > 0) {
                                                  remaining[0] = { ...remaining[0], isPrimary: true };
                                                }
                                                return remaining;
                                              });
                                            } catch {
                                              toast.error('Failed to delete signing authority');
                                            } finally {
                                              setSigningAuthorityDeleting(null);
                                            }
                                          }}
                                        >
                                          <Trash2 className="w-3.5 h-3.5 mr-2" />
                                          Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              ))}

                              {/* Add card — lives in the grid alongside authority cards */}
                              {!signingAuthorityForm && (
                                <button
                                  onClick={() => setSigningAuthorityForm({ mode: 'create' })}
                                  className="rounded-xl border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-2 min-h-[130px] group"
                                >
                                  <div className="w-8 h-8 rounded-full border-2 border-muted-foreground/25 group-hover:border-primary/50 flex items-center justify-center transition-colors">
                                    <Plus className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                                  </div>
                                  <span className="text-xs text-muted-foreground/60 group-hover:text-primary transition-colors font-medium">Add Authority</span>
                                </button>
                              )}
                            </div>

                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Integrations Tab */}
                  <TabsContent value="integrations" className="mt-0 focus-visible:outline-none flex-1 min-h-0 flex flex-col data-[state=inactive]:hidden">
                    <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
                      <div className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-3.5">
                        <Info className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                          Each agency has its own integrations. Connecting Google Calendar here only affects this agency — other agencies are unaffected.
                        </p>
                      </div>
                      {editingAgency && (
                        <AgencyGoogleIntegrationCard
                          agencyId={editingAgency.id}
                          agencyName={editingAgency.name}
                          connected={editingAgency.googleCalendarConnected ?? false}
                          connectedEmail={editingAgency.googleConnectedEmail ?? null}
                          onChanged={async () => {
                            await loadAgencies();
                            // Pull fresh row from store and re-seed editingAgency so the card reflects the new state immediately.
                            const fresh = useStore.getState().subCompanies.find((s) => s.id === editingAgency.id);
                            if (fresh) {
                              setEditingAgency((prev) => prev ? {
                                ...prev,
                                googleCalendarConnected: fresh.googleCalendarConnected ?? false,
                                googleConnectedEmail: fresh.googleConnectedEmail ?? null,
                              } : prev);
                            }
                          }}
                        />
                      )}
                    </div>
                  </TabsContent>
                </Tabs>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-6 py-4 border-t bg-muted/20 shrink-0">
                  <Button variant="outline" size="sm" onClick={() => setIsEditAgencyOpen(false)}>Cancel</Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!editingAgency) return;
                      if (!agencyName.trim()) {
                        toast.error('Name is required');
                        setEditAgencyTab('settings');
                        return;
                      }
                      const agencyLogoTrim = editAgencyAgencyLogoUrl.trim();
                      // Allow raw R2 keys (from upload) as well as full https URLs
                      if (agencyLogoTrim && (agencyLogoTrim.startsWith('http://') || agencyLogoTrim.startsWith('https://')) && !isValidHttpOrHttpsUrl(agencyLogoTrim)) {
                        toast.error('Agency logo URL must be a valid http(s) address');
                        setEditAgencyTab('settings');
                        return;
                      }
                      const emailTrim = editAgencyEmail.trim();
                      if (emailTrim && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) {
                        toast.error('Agency email must be a valid address');
                        setEditAgencyTab('settings');
                        return;
                      }
                      try {
                        await updateSubCompany(editingAgency.id, {
                          name: agencyName.trim(),
                          mainOrgId: editingAgency.mainOrgId,
                          agencyEmail: emailTrim ? emailTrim : null,
                          emailFooterText: agencyEmailFooter.trim() || null,
                          emailTagline: agencyEmailTagline.trim() || null,
                          agencyLogoUrl: agencyLogoTrim ? agencyLogoTrim : null,
                          emailFromAddress: editEmailFromAddress.trim() || null,
                          emailFromName: editEmailFromName.trim() || null,
                          emailSendAsDomain: editEmailSendAsDomain.trim().toLowerCase() || null,
                          emailInboundDomain: editEmailInboundDomain.trim().toLowerCase() || null,
                          emailInboundLocalpart: editEmailInboundLocalpart.trim().toLowerCase() || null,
                        });
                        const editedId = editingAgency.id;
                        toast.success('Agency updated');
                        setIsEditAgencyOpen(false);
                        setEditingAgency(null);
                        await loadAgencies();
                        const store = useStore.getState();
                        const row = store.subCompanies.find((s) => s.id === editedId);
                        if (row && store.currentSubCompany?.id === editedId) {
                          store.setCurrentSubCompany({
                            ...store.currentSubCompany,
                            ...row,
                          });
                        }
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed to update agency');
                      }
                    }}
                  >
                    Save changes
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Signing Authority create / edit dialog */}
            <Dialog open={!!signingAuthorityForm} onOpenChange={(open) => { if (!open) setSigningAuthorityForm(null); }}>
              <DialogContent className="sm:max-w-xl w-[calc(100vw-2rem)] p-0 gap-0 overflow-hidden" hideClose>
                <DialogTitle className="sr-only">
                  {signingAuthorityForm?.mode === 'create' ? 'New Signing Authority' : 'Edit Signing Authority'}
                </DialogTitle>
                <SignatureCreatorWidget
                  title={signingAuthorityForm?.mode === 'create' ? 'New Signing Authority' : 'Edit Signing Authority'}
                  initialName={signingAuthorityForm?.record?.name ?? ''}
                  initialFontFamily={signingAuthorityForm?.record?.fontFamily}
                  onCancel={() => setSigningAuthorityForm(null)}
                  onSave={async (data) => {
                    const mode = signingAuthorityForm!.mode;
                    try {
                      if (mode === 'create') {
                        const created = await createSigningAuthority(data, editingAgency?.id);
                        setSigningAuthorities((prev) => [
                          ...prev.map((a) => (created.isPrimary ? { ...a, isPrimary: false } : a)),
                          created,
                        ]);
                      } else {
                        const updated = await updateSigningAuthority(signingAuthorityForm!.record!.id, data, editingAgency?.id);
                        setSigningAuthorities((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
                      }
                      setSigningAuthorityForm(null);
                      toast.success(mode === 'create' ? 'Signing authority added' : 'Signing authority updated');
                    } catch {
                      toast.error(mode === 'create' ? 'Failed to create signing authority' : 'Failed to update signing authority');
                    }
                  }}
                />
              </DialogContent>
            </Dialog>

          </TabsContent>
        )}

        {/* Bug report email recipients - Super Admin only */}
        {isSuperAdmin && (
          <TabsContent value="bug-report-emails" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bug className="h-5 w-5" />
                  Bug report email recipients
                </CardTitle>
                <CardDescription>
                  These email addresses receive a notification whenever a user submits a bug report. Add or remove recipients below.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    type="email"
                    placeholder="Add email (e.g. hassan@wudox.com)"
                    value={newBugReportEmail}
                    onChange={(e) => setNewBugReportEmail(e.target.value)}
                    className="max-w-xs"
                  />
                  <Button
                    disabled={!newBugReportEmail.trim() || addingBugRecipient}
                    onClick={async () => {
                      const email = newBugReportEmail.trim();
                      if (!email) return;
                      setAddingBugRecipient(true);
                      try {
                        await addBugReportRecipient(email);
                        toast.success('Recipient added');
                        setNewBugReportEmail('');
                        loadBugReportRecipients();
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed to add');
                      } finally {
                        setAddingBugRecipient(false);
                      }
                    }}
                  >
                    {addingBugRecipient ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add
                  </Button>
                </div>
                <ul className="space-y-2">
                  {bugReportRecipients.length === 0 ? (
                    <li className="text-sm text-muted-foreground">No recipients. Add emails to receive bug report notifications.</li>
                  ) : (
                    bugReportRecipients.map((r) => (
                      <li key={r.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                        <span className="text-sm">{r.email}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={async () => {
                            try {
                              await removeBugReportRecipient(r.id);
                              toast.success('Recipient removed');
                              loadBugReportRecipients();
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'Failed to remove');
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))
                  )}
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Jobs Settings Tab - Director Only */}
        {canManageAgencyPipeline && (
          <TabsContent value="jobs">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Briefcase className="h-5 w-5" />
                  Jobs Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="space-y-1">
                      <h4 className="font-medium">Default Backup Pool Percentage</h4>
                      <p className="text-sm text-muted-foreground">
                        When creating external jobs, this percentage of backup employees can be scheduled beyond the required positions.
                        For example, if a job needs 100 people and backup is 70%, up to 170 employees can be scheduled.
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number"
                        min="0"
                        max="200"
                        value={backupPercentage}
                        onChange={(e) => {
                          const value = Math.min(200, Math.max(0, parseInt(e.target.value) || 0));
                          setBackupPercentage(value);
                          setBackupPercentagePreference(value);
                          toast.success(`Default backup percentage updated to ${value}%`);
                        }}
                        className="w-24"
                      />
                      <span className="text-sm text-muted-foreground">%</span>
                    </div>
                  </div>
                  
                  <div className="p-4 bg-muted/50 rounded-lg">
                    <h4 className="font-medium mb-2">How Backup Pool Works</h4>
                    <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                      <li>External jobs can schedule more employees than required positions</li>
                      <li>Backup employees ensure coverage if someone doesn't show up</li>
                      <li>Only non-blacklisted employees matching the job type (internal/external) can be scheduled</li>
                      <li>Individual jobs can override this default percentage during creation</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Call Scripts Tab */}
        {canManageScripts && (
          <TabsContent value="scripts">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Call Scripts Management
                    {dbCallScripts.length > 0 && (
                      <Badge variant="secondary" className="ml-2">{dbCallScripts.length}</Badge>
                    )}
                  </CardTitle>
                  <Button size="sm" onClick={() => {
                    setScriptName('');
                    setScriptContent('');
                    setScriptClientStatus('__none__');
                    setScriptIsActive(true);
                    setIsAddScriptOpen(true);
                  }}>
                    <Plus className="h-4 w-4 mr-1" /> Add Script
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  Manage call scripts for different client types. Sales associates can select a script when making calls.
                </p>
              </CardHeader>
              <CardContent>
                {scriptsLoading && dbCallScripts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">Loading scripts...</div>
                ) : dbCallScripts.length > 0 ? (
                  <div className="space-y-4">
                    {dbCallScripts.map((script) => (
                      <div key={script.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="font-semibold">{script.name}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              {script.clientStatus && (
                                <Badge variant="secondary">
                                  {clientStatusOptions.find(o => o.value === script.clientStatus)?.label || script.clientStatus}
                                </Badge>
                              )}
                              <Badge variant={script.isActive ? "default" : "outline"}>
                                {script.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm" onClick={() => {
                              setEditingScript(script);
                              setScriptName(script.name);
                              setScriptContent(script.content);
                              setScriptClientStatus(script.clientStatus || '__none__');
                              setScriptIsActive(script.isActive);
                              setIsEditScriptOpen(true);
                            }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={async () => {
                              setScriptMutating(true);
                              try {
                                await updateCallScriptApi(script.id, { isActive: !script.isActive });
                                await loadCallScripts();
                                toast.success(script.isActive ? 'Script disabled' : 'Script enabled');
                              } catch (e: any) {
                                toast.error(e.message);
                              } finally {
                                setScriptMutating(false);
                              }
                            }} disabled={scriptMutating}>
                              {script.isActive ? "Disable" : "Enable"}
                            </Button>
                            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => {
                              setDeletingScript(script);
                              setIsDeleteScriptOpen(true);
                            }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <div className="bg-muted/50 rounded p-3 text-sm max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {script.content.length > 300 ? script.content.slice(0, 300) + '...' : script.content}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    No scripts configured yet. Click "Add Script" to create one.
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Add Script Dialog */}
            <Dialog open={isAddScriptOpen} onOpenChange={setIsAddScriptOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Add Call Script</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Script Name</Label>
                    <Input value={scriptName} onChange={(e) => setScriptName(e.target.value)} placeholder="e.g. Active Client Script" />
                  </div>
                  <div>
                    <Label>Client Status (optional)</Label>
                    <Select value={scriptClientStatus} onValueChange={setScriptClientStatus}>
                      <SelectTrigger><SelectValue placeholder="Any status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Any Status</SelectItem>
                        {clientStatusOptions.map(o => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Script Content</Label>
                    <Textarea
                      value={scriptContent}
                      onChange={(e) => setScriptContent(e.target.value)}
                      placeholder="Enter the call script content. Use **bold** for headers, • for bullet points, and [placeholders] for dynamic text."
                      rows={12}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={scriptIsActive} onCheckedChange={setScriptIsActive} />
                    <Label>Active</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddScriptOpen(false)}>Cancel</Button>
                  <Button disabled={!scriptName.trim() || !scriptContent.trim() || scriptMutating} onClick={async () => {
                    setScriptMutating(true);
                    try {
                      await createCallScriptApi({
                        name: scriptName.trim(),
                        content: scriptContent,
                        clientStatus: scriptClientStatus === '__none__' ? null : scriptClientStatus,
                        isActive: scriptIsActive,
                      });
                      toast.success('Script created');
                      setIsAddScriptOpen(false);
                      await loadCallScripts();
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setScriptMutating(false);
                    }
                  }}>Create Script</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Edit Script Dialog */}
            <Dialog open={isEditScriptOpen} onOpenChange={setIsEditScriptOpen}>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Edit Call Script</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Script Name</Label>
                    <Input value={scriptName} onChange={(e) => setScriptName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Client Status (optional)</Label>
                    <Select value={scriptClientStatus} onValueChange={setScriptClientStatus}>
                      <SelectTrigger><SelectValue placeholder="Any status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Any Status</SelectItem>
                        {clientStatusOptions.map(o => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Script Content</Label>
                    <Textarea
                      value={scriptContent}
                      onChange={(e) => setScriptContent(e.target.value)}
                      rows={12}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={scriptIsActive} onCheckedChange={setScriptIsActive} />
                    <Label>Active</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsEditScriptOpen(false)}>Cancel</Button>
                  <Button disabled={!scriptName.trim() || !scriptContent.trim() || scriptMutating} onClick={async () => {
                    if (!editingScript) return;
                    setScriptMutating(true);
                    try {
                      await updateCallScriptApi(editingScript.id, {
                        name: scriptName.trim(),
                        content: scriptContent,
                        clientStatus: scriptClientStatus === '__none__' ? null : scriptClientStatus,
                        isActive: scriptIsActive,
                      });
                      toast.success('Script updated');
                      setIsEditScriptOpen(false);
                      await loadCallScripts();
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setScriptMutating(false);
                    }
                  }}>Save Changes</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* Delete Script Confirmation */}
            <AlertDialog open={isDeleteScriptOpen} onOpenChange={setIsDeleteScriptOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Script</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{deletingScript?.name}"? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => {
                    if (!deletingScript) return;
                    setScriptMutating(true);
                    try {
                      await deleteCallScriptApi(deletingScript.id);
                      toast.success('Script deleted');
                      setIsDeleteScriptOpen(false);
                      await loadCallScripts();
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setScriptMutating(false);
                    }
                  }}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>
        )}

        {canSeeClientVisibilityTab && (
          <TabsContent value="approvals" className="space-y-4">
            <SettingsOrgApprovalsCard isActive={tabFromUrl === 'approvals'} />
            <SettingsApprovalsTab isActive={tabFromUrl === 'approvals'} />
          </TabsContent>
        )}

        {/* Client Visibility Tab - Director/Super Admin */}
        {canSeeClientVisibilityTab && (
          <TabsContent value="client-visibility" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Client Visibility</CardTitle>
                <CardDescription>
                  Control how long a client added by a non-director remains visible only to your agency before becoming visible to all agencies.
                  The same day count is used to auto-approve pending agency client create and edit requests when a director has not acted (immediate when set to 0).
                  Does not apply to Database Manager <strong>global database</strong> imports — those use Settings → Approvals → Global Database.
                  Agency-targeted imports by a Database Manager follow the day count below for the selected agency.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {clientVisibilityLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="client-visibility-immediate"
                        checked={clientVisibilityImmediate}
                        onCheckedChange={(checked) =>
                          void handleClientVisibilityImmediateChange(!!checked)
                        }
                        disabled={clientVisibilitySaving}
                      />
                      <Label
                        htmlFor="client-visibility-immediate"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        Make clients visible to all agencies immediately (no delay)
                      </Label>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="client-visibility-days">Days</Label>
                        <Input
                          id="client-visibility-days"
                          type="number"
                          min={1}
                          disabled={clientVisibilityImmediate || clientVisibilitySaving}
                          value={clientVisibilityImmediate ? 0 : clientVisibilityDays}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (!isNaN(v) && v >= 1) {
                              setClientVisibilityDays(v);
                              localStorage.setItem(clientVisibilityDaysStorageKey, String(v));
                            }
                          }}
                          className="w-24"
                        />
                        <p className="text-xs text-muted-foreground">
                          {clientVisibilityImmediate
                            ? 'Days are disabled while immediate visibility is enabled.'
                            : 'Days before a client becomes visible to all agencies.'}
                        </p>
                      </div>
                      <Button
                        disabled={clientVisibilitySaving}
                        onClick={async () => {
                          setClientVisibilitySaving(true);
                          try {
                            const updated = await updateClientVisibilitySetting(
                              clientVisibilityImmediate
                                ? 0
                                : Math.max(1, clientVisibilityDays),
                            );
                            setClientVisibilityImmediate(updated.days === 0);
                            if (updated.days > 0) {
                              setClientVisibilityDays(updated.days);
                              localStorage.setItem(
                                clientVisibilityDaysStorageKey,
                                String(updated.days),
                              );
                            }
                            toast.success('Client visibility setting saved');
                          } catch {
                            toast.error('Failed to save setting');
                          } finally {
                            setClientVisibilitySaving(false);
                          }
                        }}
                      >
                        {clientVisibilitySaving ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-1" />
                        ) : null}
                        Save
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Daily Reports Tab */}
        {canSeeClientVisibilityTab && (
          <TabsContent value="daily-reports" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Daily Report Email</CardTitle>
                <CardDescription>
                  Send automated daily performance reports to managers at end of business. Reports include calls, emails, meetings, tasks, pipeline, break time, and idle time for each team member.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {dailyReportLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="daily-report-enabled"
                        checked={dailyReportSettings.enabled}
                        onCheckedChange={(checked) =>
                          setDailyReportSettings((prev) => ({ ...prev, enabled: !!checked }))
                        }
                        disabled={dailyReportSaving}
                      />
                      <Label htmlFor="daily-report-enabled" className="text-sm font-medium">
                        Enable daily report emails
                      </Label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="daily-report-time">Send Time</Label>
                        <Select
                          value={`${dailyReportSettings.sendHour}:${String(dailyReportSettings.sendMinute).padStart(2, '0')}`}
                          onValueChange={(v) => {
                            const [h, m] = v.split(':').map(Number);
                            setDailyReportSettings((prev) => ({ ...prev, sendHour: h, sendMinute: m }));
                          }}
                          disabled={dailyReportSaving || !dailyReportSettings.enabled}
                        >
                          <SelectTrigger id="daily-report-time">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 48 }, (_, i) => {
                              const hour = Math.floor(i / 2);
                              const minute = (i % 2) * 30;
                              const value = `${hour}:${String(minute).padStart(2, '0')}`;
                              const ampm = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                              const suffix = hour < 12 ? 'AM' : 'PM';
                              const label = `${ampm}:${String(minute).padStart(2, '0')} ${suffix}`;
                              return <SelectItem key={value} value={value}>{label}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="daily-report-timezone">Timezone</Label>
                        <Select
                          value={dailyReportSettings.timezone}
                          onValueChange={(v) =>
                            setDailyReportSettings((prev) => ({ ...prev, timezone: v }))
                          }
                          disabled={dailyReportSaving || !dailyReportSettings.enabled}
                        >
                          <SelectTrigger id="daily-report-timezone">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="America/Toronto">Eastern Time (Toronto)</SelectItem>
                            <SelectItem value="America/New_York">Eastern Time (New York)</SelectItem>
                            <SelectItem value="America/Chicago">Central Time (Chicago)</SelectItem>
                            <SelectItem value="America/Denver">Mountain Time (Denver)</SelectItem>
                            <SelectItem value="America/Los_Angeles">Pacific Time (Los Angeles)</SelectItem>
                            <SelectItem value="America/Vancouver">Pacific Time (Vancouver)</SelectItem>
                            <SelectItem value="America/Edmonton">Mountain Time (Edmonton)</SelectItem>
                            <SelectItem value="America/Winnipeg">Central Time (Winnipeg)</SelectItem>
                            <SelectItem value="America/Halifax">Atlantic Time (Halifax)</SelectItem>
                            <SelectItem value="America/St_Johns">Newfoundland (St. John&apos;s)</SelectItem>
                            <SelectItem value="UTC">UTC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1.5 max-w-[200px]">
                      <Label htmlFor="daily-report-shift">Shift Duration (hours)</Label>
                      <Input
                        id="daily-report-shift"
                        type="number"
                        min={1}
                        max={24}
                        value={dailyReportSettings.shiftHours}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 1 && v <= 24) {
                            setDailyReportSettings((prev) => ({ ...prev, shiftHours: v }));
                          }
                        }}
                        disabled={dailyReportSaving || !dailyReportSettings.enabled}
                      />
                      <p className="text-xs text-muted-foreground">
                        Used to calculate productivity percentage in the report.
                      </p>
                    </div>

                    <Button
                      disabled={dailyReportSaving}
                      onClick={async () => {
                        setDailyReportSaving(true);
                        try {
                          const updated = await updateDailyReportSettings(dailyReportSettings);
                          if (updated) {
                            setDailyReportSettings(updated);
                            toast.success('Daily report settings saved');
                          } else {
                            toast.error('Failed to save settings');
                          }
                        } catch {
                          toast.error('Failed to save settings');
                        } finally {
                          setDailyReportSaving(false);
                        }
                      }}
                    >
                      {dailyReportSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                      Save Changes
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      Reports are sent to all managers who have direct reports assigned via Reporting Manager.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Idle Time Tab */}
        {canSeeClientVisibilityTab && (
          <TabsContent value="idle-time" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Idle Time Detection</CardTitle>
                <CardDescription>
                  Set how many minutes of inactivity before a user is considered idle. An &quot;I&apos;m Back&quot; popup will appear after this duration of inactivity.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {idleTimeLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <div className="space-y-1.5 max-w-[200px]">
                      <Label htmlFor="idle-threshold">Idle Threshold (minutes)</Label>
                      <Input
                        id="idle-threshold"
                        type="number"
                        min={1}
                        max={60}
                        value={idleThresholdMinutes}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!isNaN(v) && v >= 1 && v <= 60) {
                            setIdleThresholdMinutes(v);
                          }
                        }}
                        disabled={idleTimeSaving}
                      />
                      <p className="text-xs text-muted-foreground">
                        Min: 1 minute &bull; Max: 60 minutes &bull; Default: 5 minutes
                      </p>
                    </div>

                    <Button
                      disabled={idleTimeSaving}
                      onClick={async () => {
                        setIdleTimeSaving(true);
                        try {
                          await updateIdleTimeSetting(idleThresholdMinutes);
                          toast.success('Idle time threshold saved');
                        } catch {
                          toast.error('Failed to save idle time threshold');
                        } finally {
                          setIdleTimeSaving(false);
                        }
                      }}
                    >
                      {idleTimeSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                      Save Changes
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      Changes take effect on each user&apos;s next page load.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canSeeClientVisibilityTab && (
          <TabsContent value="email-cutoff" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Email Send Window</CardTitle>
                <CardDescription>
                  Configure when outbound emails can be sent. Emails outside this window are queued and sent at the next start time.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {emailSendWindowLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="email-window-enabled"
                        checked={emailSendWindowSettings.enabled}
                        onCheckedChange={(checked) =>
                          setEmailSendWindowSettings((prev) => ({
                            ...prev,
                            enabled: !!checked,
                            startMinuteOfDay: checked
                              ? (prev.startMinuteOfDay ?? 8 * 60)
                              : null,
                            cutoffMinuteOfDay: checked
                              ? (prev.cutoffMinuteOfDay ?? 17 * 60)
                              : null,
                          }))
                        }
                        disabled={emailSendWindowSaving}
                      />
                      <Label htmlFor="email-window-enabled" className="text-sm font-medium">
                        Enable cutoff/start time for outbound email sending
                      </Label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1.5">
                        <Label htmlFor="email-start-time">Start Time</Label>
                        <Input
                          id="email-start-time"
                          type="time"
                          value={minuteOfDayToTimeString(emailSendWindowSettings.startMinuteOfDay)}
                          disabled={emailSendWindowSaving || !emailSendWindowSettings.enabled}
                          onChange={(e) => {
                            const minute = timeStringToMinuteOfDay(e.target.value);
                            setEmailSendWindowSettings((prev) => ({
                              ...prev,
                              startMinuteOfDay: minute,
                            }));
                          }}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="email-cutoff-time">Cutoff Time</Label>
                        <Input
                          id="email-cutoff-time"
                          type="time"
                          value={minuteOfDayToTimeString(emailSendWindowSettings.cutoffMinuteOfDay)}
                          disabled={emailSendWindowSaving || !emailSendWindowSettings.enabled}
                          onChange={(e) => {
                            const minute = timeStringToMinuteOfDay(e.target.value);
                            setEmailSendWindowSettings((prev) => ({
                              ...prev,
                              cutoffMinuteOfDay: minute,
                            }));
                          }}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="email-window-timezone">Timezone</Label>
                        <Select
                          value={emailSendWindowSettings.timezone}
                          onValueChange={(v) =>
                            setEmailSendWindowSettings((prev) => ({ ...prev, timezone: v }))
                          }
                          disabled={emailSendWindowSaving}
                        >
                          <SelectTrigger id="email-window-timezone">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="America/Toronto">Eastern Time (Toronto)</SelectItem>
                            <SelectItem value="America/New_York">Eastern Time (New York)</SelectItem>
                            <SelectItem value="America/Chicago">Central Time (Chicago)</SelectItem>
                            <SelectItem value="America/Denver">Mountain Time (Denver)</SelectItem>
                            <SelectItem value="America/Los_Angeles">Pacific Time (Los Angeles)</SelectItem>
                            <SelectItem value="UTC">UTC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        disabled={emailSendWindowSaving}
                        onClick={async () => {
                          if (emailSendWindowSettings.enabled) {
                            if (
                              emailSendWindowSettings.startMinuteOfDay == null ||
                              emailSendWindowSettings.cutoffMinuteOfDay == null
                            ) {
                              toast.error('Start time and cutoff time are required when enabled');
                              return;
                            }
                            if (emailSendWindowSettings.startMinuteOfDay >= emailSendWindowSettings.cutoffMinuteOfDay) {
                              toast.error('Start time must be before cutoff time (overnight windows are not supported)');
                              return;
                            }
                          }

                          setEmailSendWindowSaving(true);
                          try {
                            const updated = await updateEmailSendWindowSettings(emailSendWindowSettings);
                            if (!updated) {
                              toast.error('Failed to save email window settings');
                              return;
                            }
                            setEmailSendWindowSettings(updated);
                            toast.success('Email send window settings saved');
                          } catch {
                            toast.error('Failed to save email window settings');
                          } finally {
                            setEmailSendWindowSaving(false);
                          }
                        }}
                      >
                        {emailSendWindowSaving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                        Save Changes
                      </Button>

                      <Button
                        variant="outline"
                        disabled={emailSendWindowSaving}
                        onClick={async () => {
                          setEmailSendWindowSaving(true);
                          try {
                            const updated = await disableEmailSendWindowSettings();
                            if (!updated) {
                              toast.error('Failed to disable email window');
                              return;
                            }
                            setEmailSendWindowSettings(updated);
                            toast.success('Email window disabled; queued emails will be released');
                          } catch {
                            toast.error('Failed to disable email window');
                          } finally {
                            setEmailSendWindowSaving(false);
                          }
                        }}
                      >
                        Disable
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}


        {/* Performance Targets Tab */}
        {canManageTargets && (
          <TabsContent value="performance-targets" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Performance Targets
                </CardTitle>
                <CardDescription>
                  Set daily targets for calls, emails, and meeting schedule count by role.
                  Tasks and follow-ups are tracked automatically (assigned vs completed each day).
                  Targets are saved as point-in-time snapshots for historical reporting.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {perfTargetsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {/* Role selector */}
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium">Select Role</Label>
                      <Select
                        value={selectedPerfRole}
                        onValueChange={(role) => {
                          setSelectedPerfRole(role);
                          const row = perfRoleTargets.find((r) => r.role === role);
                          setPerfDraft(row?.target ?? { emailsTarget: 0, callsTarget: 0, meetingScheduleCountTarget: 0 });
                        }}
                      >
                        <SelectTrigger className="w-56">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {perfTargetRoleOptions.map((opt) => (
                            <SelectItem key={opt.role} value={opt.role}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Target inputs for selected role */}
                    <div className="rounded-lg border border-border bg-muted/30 p-4">
                      <PerformanceTargetInputs
                        draft={perfDraft}
                        isSaving={perfSaving}
                        hasExisting={!!(perfRoleTargets.find((r) => r.role === selectedPerfRole)?.target)}
                        onDraftChange={setPerfDraft}
                        onSave={async () => {
                          setPerfSaving(true);
                          try {
                            await savePerformanceTarget({ role: selectedPerfRole, ...perfDraft });
                            toast.success('Targets saved');
                            const fresh = await fetchPerformanceTargets();
                            setPerfRoleTargets(fresh.roles);
                          } catch {
                            toast.error('Failed to save targets');
                          } finally {
                            setPerfSaving(false);
                          }
                        }}
                      />
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Availability Tab */}
        <TabsContent value="availability">
          <AvailabilitySettings />
        </TabsContent>

        {canManageLoginBrandingTab && (
          <TabsContent value="company" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LogIn className="h-5 w-5" />
                  Sign-in & app appearance
                </CardTitle>
                <CardDescription>
                  <strong>Directors and super admins.</strong> <strong>Company</strong> display name and company logo
                  are used on the public sign-in page and in the app for directors and super admins only. Staff sidebar
                  and emails use the <strong>organization name</strong> and <strong>agency logo</strong> from{' '}
                  <strong>Settings → Agencies → Edit</strong> (super admin).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 max-w-xl">
                <div className="space-y-2">
                  <Label htmlFor="company-app-project">Company display name</Label>
                  <Input
                    id="company-app-project"
                    value={companyProjectDraft}
                    onChange={(e) => setCompanyProjectDraft(e.target.value)}
                    placeholder="Optional — company name on sign-in and in director/super-admin chrome"
                    maxLength={120}
                    disabled={companyBrandingSaving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Shown on the public sign-in page and in the browser tab for directors and super admins. When empty,
                    the <strong>organization name</strong> from Agencies ({currentSubCompany?.name}) is used there
                    instead.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="company-logo-url">Company logo URL</Label>
                  <Input
                    id="company-logo-url"
                    value={companyLogoDraft}
                    onChange={(e) => setCompanyLogoDraft(e.target.value)}
                    placeholder="https://…"
                    maxLength={2048}
                    disabled={companyBrandingSaving}
                  />
                  <p className="text-xs text-muted-foreground">
                    Public sign-in page and sidebar for <strong>directors and super admins only</strong>. Clear to
                    remove.
                  </p>
                </div>
                <Button
                  disabled={companyBrandingSaving || !currentSubCompany?.id}
                  onClick={async () => {
                    if (!currentSubCompany?.id) return;
                    const nameTrim = companyProjectDraft.trim();
                    const logoTrim = companyLogoDraft.trim();
                    if (logoTrim && !isValidHttpOrHttpsUrl(logoTrim)) {
                      toast.error('Company logo URL must be a valid http(s) address');
                      return;
                    }
                    setCompanyBrandingSaving(true);
                    try {
                      await updateSubCompany(currentSubCompany.id, {
                        appProjectName: nameTrim ? nameTrim : null,
                        logoUrl: logoTrim ? logoTrim : null,
                      });
                      toast.success('Company branding saved');
                      const store = useStore.getState();
                      const next = {
                        ...currentSubCompany,
                        appProjectName: nameTrim || null,
                        logoUrl: logoTrim || null,
                      };
                      store.setCurrentSubCompany(next);
                      store.setSubCompanies(store.subCompanies.map((s) => (s.id === currentSubCompany.id ? { ...s, ...next } : s)));
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed to save');
                    } finally {
                      setCompanyBrandingSaving(false);
                    }
                  }}
                >
                  {companyBrandingSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Save company name &amp; logo
                </Button>
                <p className="text-xs text-muted-foreground border-t pt-3">
                  Public API (no login):{' '}
                  <code className="text-[11px] bg-muted px-1 rounded break-all">
                    GET /api/v1/public/branding
                  </code>{' '}
                  — returns company display name and company logo for the login page (not the agency-only sidebar logo).
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {canManageProposalDefaults && (
          <TabsContent value="recruitment-agreement" className="space-y-4">
            <SettingsRecruitmentAgreementTab isActive={tabFromUrl === 'recruitment-agreement'} />
          </TabsContent>
        )}

        {canLinkAgencies && (
          <TabsContent value="linked-accounts" className="space-y-4">
            <AgencyLinkTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
