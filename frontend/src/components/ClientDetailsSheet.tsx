import { format, formatDistanceToNowStrict } from 'date-fns';
import { Building2, Phone as PhoneIcon, Mail, MailX, MailCheck, MapPin, Users, Calendar, PhoneCall, PhoneOutgoing, CheckCircle, ArrowRight, MessageSquare, StickyNote, FileText, Plus, CalendarClock, Upload, Download, Trash2, File, Shield, Search, Send, ThumbsUp, ThumbsDown, Clock, Pin, Eye, Briefcase, DollarSign, UserPlus, Star, X, XCircle, RefreshCw, CheckCheck, RotateCcw, Loader2, ChevronDown, ChevronRight, ChevronsUpDown, Check, Pencil, Globe, UserCog, Info, Trophy } from 'lucide-react';
import { AddClientDialog } from '@/components/AddClientDialog';
import { Client, ActivityType, ActivityLog, Lead, ProposalData, AgreementType, PaymentTerms, PricingType, FollowUp } from '@/lib/types';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import { useState, ReactNode, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { fetchDocuments, uploadDocument, deleteDocument, downloadDocument, fetchDocumentBlob, downloadProposalAttachment, fetchProposalAttachmentBlob, fetchClient, addClientContact, updateClientContact, setClientContactPrimary, updateContactUnsubscribed, unsubscribeContact, deleteClientContact, addClientTag, removeClientTag, fetchSettingsTags, fetchSettingsJobTitles, addClientNote as addClientNoteApi, setClientNotePin, editClientNote, deleteClientNote, updateClientAgencyStatus, fetchFollowUps, mapApiFollowUpToFollowUp, fetchProposals, getProposalDocPreviewUrl, getProposalPandaDocPdfUrl, type ApiDocument, fetchClientActivityLogs, fetchLeadHistory, type ApiLeadHistoryEntry, fetchCalls, type ApiCall, fetchUsers, fetchOwnershipCandidates, updateClientRestriction, updateClientOwnership, fetchRemarks, createRemark, deleteRemark, setRemarkPin, type ApiRemark, fetchClientNoteFieldsForClient, type ClientNoteFieldDef, type ApiUser } from '@/lib/api';
import { onCallRefresh, onClientRefresh } from '@/lib/socket';
import { CallRecordingPlayer } from '@/components/CallRecordingPlayer';
import { VisibilityPicker, toRemarkPayload, type Visibility } from '@/components/VisibilityPicker';
import { toast } from 'sonner';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { inferMimeFromFilename } from '@/lib/fileAttachmentUtils';
import { ClientContact } from '@/lib/types';
import {
  useCanAccessMultipleAgencies,
  useCanViewGlobalScope,
  useCanViewTeamScope,
  useHasPermission,
} from '@/lib/access';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import { isTeamScopeRoleKey, getRoleLabel, getUserRoleTitle } from '@/lib/roleLabels';
import { useEffectiveUser } from '@/lib/effectiveUser';

/** Format the picked field + value into a note's content string for the feed.
 *  Returns null when the value is empty/invalid, so the Add button stays disabled. */
function formatNoteContent(def: ClientNoteFieldDef, raw: unknown): string | null {
  switch (def.fieldType) {
    case 'text':
    case 'textarea': {
      if (typeof raw !== 'string' || raw.trim().length === 0) return null;
      const value = raw.trim();
      return def.fieldType === 'textarea' && value.includes('\n')
        ? `${def.label}:\n${value}`
        : `${def.label}: ${value}`;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return null;
      return `${def.label}: ${n}`;
    }
    case 'boolean': {
      if (raw !== true && raw !== false) return null;
      return `${def.label}: ${raw ? 'Yes' : 'No'}`;
    }
    case 'select': {
      if (typeof raw !== 'string' || raw.length === 0) return null;
      if (!def.options || !def.options.includes(raw)) return null;
      return `${def.label}: ${raw}`;
    }
  }
}

function isAddNoteValid(fields: ClientNoteFieldDef[], pickedId: string, value: unknown): boolean {
  const def = fields.find((f) => f.id === pickedId);
  if (!def) return false;
  return formatNoteContent(def, value) !== null;
}

/** Reverse of formatNoteContent — recover the field def + value from a stored note string.
 *  Returns { defId: null, value: content } for legacy free-text notes that don't match any field. */
function parseNoteContent(
  content: string,
  fields: ClientNoteFieldDef[],
): { defId: string | null; value: unknown } {
  // Combined multi-field notes (joined with "\n\n" between fields) would otherwise
  // misparse as the first field with everything-after as its value. Detect them and
  // fall back to raw-textarea editing.
  const looksMultiField = fields.some(
    (f) => content.includes(`\n\n${f.label}: `) || content.includes(`\n\n${f.label}:\n`),
  );
  if (looksMultiField) return { defId: null, value: content };

  for (const field of fields) {
    const linePrefix = `${field.label}:\n`;
    const inlinePrefix = `${field.label}: `;
    let raw: string | null = null;
    if (content.startsWith(linePrefix)) raw = content.slice(linePrefix.length);
    else if (content.startsWith(inlinePrefix)) raw = content.slice(inlinePrefix.length);
    if (raw === null) continue;
    switch (field.fieldType) {
      case 'boolean':
        return { defId: field.id, value: raw === 'Yes' ? true : raw === 'No' ? false : null };
      case 'number': {
        const n = Number(raw);
        return { defId: field.id, value: Number.isFinite(n) ? n : '' };
      }
      default:
        return { defId: field.id, value: raw };
    }
  }
  return { defId: null, value: content };
}

type NoteVisibility = 'only_me' | 'public' | 'shared' | 'public_global';

function resolveNoteVisibility(note: { visibility?: NoteVisibility; isPublic?: boolean }): NoteVisibility {
  return note.visibility ?? (note.isPublic ? 'public' : 'only_me');
}

function noteVisibilityAccent(vis: NoteVisibility): string {
  if (vis === 'public_global') return 'border-l-blue-500/60';
  if (vis === 'public') return 'border-l-indigo-500/60';
  if (vis === 'shared') return 'border-l-purple-500/60';
  return 'border-l-rose-500/40';
}

function formatNoteTimestamp(date: Date): { label: string; full: string } {
  const recent = Date.now() - date.getTime() < 24 * 60 * 60 * 1000;
  return {
    label: recent ? `${formatDistanceToNowStrict(date)} ago` : format(date, 'MMM d, yyyy · h:mm a'),
    full: format(date, "EEE, MMM d, yyyy 'at' h:mm a"),
  };
}

interface ClientDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  showActions?: boolean;
  onCallClick?: () => void;
  onEmailClick?: () => void;
  onAddTaskClick?: () => void;
  onAddFollowUpClick?: () => void;
  /** Incremented when a follow-up is created/updated so the tab refreshes */
  followUpRefreshKey?: number;
  /** Called after contacts are updated so parent can refresh selected client */
  onClientUpdated?: (client: Client) => void;
  /** Called when a contact add/edit is queued for client_manual_edit approval */
  onPendingEditSubmitted?: () => void;
  defaultTab?: string;
  phoneDialerSlot?: ReactNode;
  /** Director/super_admin "All Agencies" clients view — load merged cross-agency client detail */
  allAgenciesView?: boolean;
  subCompanyId?: string;
}

export function ClientDetailsSheet({ 
  open, 
  onOpenChange, 
  client,
  showActions = false,
  onCallClick,
  onEmailClick,
  onAddTaskClick,
  onAddFollowUpClick,
  followUpRefreshKey,
  onClientUpdated,
  onPendingEditSubmitted,
  defaultTab = 'overview',
  phoneDialerSlot,
  allAgenciesView = false,
  subCompanyId,
}: ClientDetailsSheetProps) {
  const clientActionOpts = useMemo(
    () => (subCompanyId ? { subCompanyId } : undefined),
    [subCompanyId],
  );
  const clientDetailOpts = useMemo(
    () => (allAgenciesView ? { allAgencies: true as const } : undefined),
    [allAgenciesView],
  );
  const { leads, currentUser, users, addClientNote, toggleNotePin, clients, currentSubCompany, viewedSubCompanyId } = useStore();
  const effectiveUser = useEffectiveUser();
  const effectiveSelfId = effectiveUser.id;
  const effectiveAuthor = effectiveUser.isActingAs
    ? { id: effectiveUser.id, name: effectiveUser.fullName, role: effectiveUser.role }
    : undefined;
  const isManager = useCanViewTeamScope();
  const { assignableRoles } = useAssignableRoles();
  const isElevatedNoteRole = useCallback(
    (roleKey: string) => {
      const meta = assignableRoles.find((r) => r.key === roleKey);
      if (meta) return meta.scopeLevel !== 'own';
      return (
        isTeamScopeRoleKey(roleKey, assignableRoles)
        || ['director', 'company_director', 'operations_manager', 'super_admin'].includes(roleKey)
      );
    },
    [assignableRoles],
  );
  const isGlobalCreator = useCanViewGlobalScope();
  const isSuperUser = useCanAccessMultipleAgencies();
  const canManageOwnership = useHasPermission('clients:ownership');
  const canWriteClients = useHasPermission('clients:write');
  const canAddContacts = useHasPermission('clients:contacts:add');
  const canEditContacts = useHasPermission('clients:contacts:edit');
  const canWriteTasks = useHasPermission('tasks:write');
  const canViewCalls = useHasPermission('calls:read');
  const canWriteRemarks = useHasPermission('remarks:write');
  const canCreatePublicRemark = useHasPermission('remarks:public');
  const canCreateGlobalRemark = useHasPermission('agencies:global');
  const canViewNotes = useHasPermission('client_notes:fields:read');
  const canWriteNotes = useHasPermission('client_notes:fields:write');
  // "All agencies" visibility (cross-agency posting) — senior leadership only.
  // Used by VisibilityPicker in both Notes and Remarks.
  const hasCrossOrg = useHasPermission('agencies:cross_org');
  const canPostAcrossAgencies = canCreateGlobalRemark || hasCrossOrg;
  const [accessSearchTerm, setAccessSearchTerm] = useState('');
  const [accessUsers, setAccessUsers] = useState<Array<{ id: string; name: string; email: string; role: string }>>([]);
  const [accessUsersLoading, setAccessUsersLoading] = useState(false);
  const [restrictedUsers, setRestrictedUsers] = useState<string[]>([]);
  const [accessMutationUserId, setAccessMutationUserId] = useState<string | null>(null);
  const [newNote, setNewNote] = useState('');
  const [isNotePublic, setIsNotePublic] = useState(true);
  const [noteVisibility, setNoteVisibility] = useState<'only_me' | 'public' | 'shared' | 'public_global'>('only_me');
  const [noteSharedWith, setNoteSharedWith] = useState<string[]>([]);
  const [noteSharedPickerOpen, setNoteSharedPickerOpen] = useState(false);
  const [addingNote, setAddingNote] = useState(false);
  // Edit / delete state for the author's own notes
  const [editNoteId, setEditNoteId] = useState<string | null>(null);
  const [editNoteContent, setEditNoteContent] = useState(''); // legacy free-text fallback
  const [editNotePickedFieldId, setEditNotePickedFieldId] = useState<string>('');
  const [editNoteDraftValue, setEditNoteDraftValue] = useState<unknown>('');
  const [editNoteVisibility, setEditNoteVisibility] = useState<'only_me' | 'public' | 'shared' | 'public_global'>('only_me');
  const [editNoteSharedWith, setEditNoteSharedWith] = useState<string[]>([]);
  const [editNoteSharedPickerOpen, setEditNoteSharedPickerOpen] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [deleteNoteId, setDeleteNoteId] = useState<string | null>(null);
  const [deletingNote, setDeletingNote] = useState(false);
  const [noteFields, setNoteFields] = useState<ClientNoteFieldDef[]>([]);
  const [noteFieldsLoading, setNoteFieldsLoading] = useState(false);
  const [draftValues, setDraftValues] = useState<Record<string, unknown>>({});
  const [selectedProposal, setSelectedProposal] = useState<{ lead: Lead; proposalData: ProposalData } | null>(null);
  const [clientDocuments, setClientDocuments] = useState<ApiDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const attachmentsFileInputRef = useRef<HTMLInputElement>(null);

  const [editClientOpen, setEditClientOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [addContactName, setAddContactName] = useState('');
  const [addContactTitle, setAddContactTitle] = useState('');
  const [addContactTitleSelect, setAddContactTitleSelect] = useState<string>('__none__');
  const [addContactTitleOther, setAddContactTitleOther] = useState('');
  const [addContactEmail, setAddContactEmail] = useState('');
  const [addContactPhone, setAddContactPhone] = useState('');
  const [addContactPhoneExt, setAddContactPhoneExt] = useState('');
  const [addContactIsPrimary, setAddContactIsPrimary] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editContactName, setEditContactName] = useState('');
  const [editContactTitle, setEditContactTitle] = useState('');
  const [editContactTitleSelect, setEditContactTitleSelect] = useState<string>('__none__');
  const [editContactTitleOther, setEditContactTitleOther] = useState('');
  const [editContactEmail, setEditContactEmail] = useState('');
  const [editContactPhone, setEditContactPhone] = useState('');
  const [editContactPhoneExt, setEditContactPhoneExt] = useState('');
  const [editContactIsPrimary, setEditContactIsPrimary] = useState(false);
  const [contactMutationLoading, setContactMutationLoading] = useState(false);
  const [allowedTags, setAllowedTags] = useState<{ id: string; tag: string; count: number }[]>([]);
  const [allowedJobTitles, setAllowedJobTitles] = useState<{ id: string; name: string; count: number }[]>([]);
  const [tagMutationLoading, setTagMutationLoading] = useState(false);
  const [ownershipType, setOwnershipType] = useState<'management' | 'associate' | null>(null);
  const [ownershipUsers, setOwnershipUsers] = useState<ApiUser[]>([]);
  const [ownershipUsersLoading, setOwnershipUsersLoading] = useState(false);
  const [ownershipSearch, setOwnershipSearch] = useState('');
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(null);
  const [ownershipSaving, setOwnershipSaving] = useState(false);
  const [showOwnershipHistory, setShowOwnershipHistory] = useState(false);
  const [clientActivities, setClientActivities] = useState<ActivityLog[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);
  const [leadHistory, setLeadHistory] = useState<ApiLeadHistoryEntry[]>([]);
  const [leadHistoryLoading, setLeadHistoryLoading] = useState(false);
  const [clientFollowUps, setClientFollowUps] = useState<FollowUp[]>([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [fetchedProposals, setFetchedProposals] = useState<any[]>([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [expandedProposalDocs, setExpandedProposalDocs] = useState<Set<string>>(new Set());
  const [activeSheetTab, setActiveSheetTab] = useState(defaultTab);
  const [clientCalls, setClientCalls] = useState<ApiCall[]>([]);
  const [clientCallsLoading, setClientCallsLoading] = useState(false);
  const [activeRecordingCallId, setActiveRecordingCallId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<ApiRemark[]>([]);
  const [remarksLoading, setRemarksLoading] = useState(false);
  const [newRemarkContent, setNewRemarkContent] = useState('');
  const [newRemarkVisibility, setNewRemarkVisibility] = useState<'only_me' | 'public' | 'shared' | 'public_global'>('only_me');
  const [newRemarkScope, setNewRemarkScope] = useState<'agency' | 'global'>('agency');
  const [newRemarkSharedWith, setNewRemarkSharedWith] = useState<string[]>([]);
  const [remarkSubmitting, setRemarkSubmitting] = useState(false);
  const [addRemarkOpen, setAddRemarkOpen] = useState(false);
  const [shareableUsers, setShareableUsers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [shareableUsersLoaded, setShareableUsersLoaded] = useState(false);
  const [sharedPickerOpen, setSharedPickerOpen] = useState(false);
  const loadClientDocuments = useCallback(async (clientId: string) => {
    setDocumentsLoading(true);
    try {
      const list = await fetchDocuments({ clientId }, clientDetailOpts);
      setClientDocuments(list);
    } catch {
      setClientDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, [clientDetailOpts]);

  useEffect(() => {
    if (client?.id) loadClientDocuments(client.id);
  }, [client?.id, loadClientDocuments]);

  useEffect(() => {
    if (!open || !currentSubCompany?.id) return;
    fetchSettingsTags({ subCompanyId: currentSubCompany.id })
      .then((r) => setAllowedTags(r.data))
      .catch(() => setAllowedTags([]));
  }, [open, currentSubCompany?.id]);

  useEffect(() => {
    if ((addContactOpen || editContactOpen) && currentSubCompany?.id) {
      fetchSettingsJobTitles({ subCompanyId: currentSubCompany.id })
        .then((r) => setAllowedJobTitles(r.data))
        .catch(() => setAllowedJobTitles([]));
    }
  }, [addContactOpen, editContactOpen, currentSubCompany?.id]);

  // Once job titles load, remap a free-text "Other" title to a known select option if it matches.
  useEffect(() => {
    if (!editContactOpen || editContactTitleSelect !== '__other__' || !editContactTitleOther) return;
    const match = allowedJobTitles.find((j) => j.name === editContactTitleOther);
    if (!match) return;
    setEditContactTitleSelect(match.name);
    setEditContactTitle(match.name);
    setEditContactTitleOther('');
  }, [allowedJobTitles, editContactOpen, editContactTitleSelect, editContactTitleOther]);

  useEffect(() => {
    setClientActivities(null);
    setActivityRefreshKey(0);
    setShowOwnershipHistory(false);
  }, [client?.id]);

  useEffect(() => {
    if (!client?.id) return;
    if (activeSheetTab !== 'activity' && !(activeSheetTab === 'overview' && showOwnershipHistory)) return;
    setActivityLoading(true);
    fetchClientActivityLogs(client.id, { page: 1, limit: 100 }, clientDetailOpts)
      .then((logs) => setClientActivities(logs))
      .catch(() => setClientActivities([]))
      .finally(() => setActivityLoading(false));
  // activityRefreshKey increments on client:refresh to force re-fetch
  }, [client?.id, activeSheetTab, showOwnershipHistory, clientDetailOpts, activityRefreshKey]);

  useEffect(() => {
    if (!client?.id || activeSheetTab !== 'leadHistory') return;
    setLeadHistoryLoading(true);
    fetchLeadHistory(client.id, clientDetailOpts)
      .then((entries) => setLeadHistory(entries))
      .catch(() => setLeadHistory([]))
      .finally(() => setLeadHistoryLoading(false));
  }, [client?.id, activeSheetTab, clientDetailOpts]);

  const loadClientFollowUps = useCallback(async () => {
    if (!client?.id) return;
    setFollowUpsLoading(true);
    try {
      const res = await fetchFollowUps({
        clientId: client.id,
        limit: 100,
        allAgencies: clientDetailOpts?.allAgencies,
      });
      setClientFollowUps(res.data.map(mapApiFollowUpToFollowUp));
    } catch {
      setClientFollowUps([]);
    } finally {
      setFollowUpsLoading(false);
    }
  }, [client?.id, clientDetailOpts]);

  useEffect(() => {
    if (!client?.id) return;
    // Load when tab is active, or when refreshKey changes (follow-up created/updated)
    if (activeSheetTab === 'followups' || followUpRefreshKey) {
      loadClientFollowUps();
    }
  }, [client?.id, activeSheetTab, loadClientFollowUps, followUpRefreshKey]);

  const loadRemarks = useCallback(async () => {
    if (!client?.id) return;
    if (!canWriteRemarks) {
      setRemarks([]);
      return;
    }
    setRemarksLoading(true);
    try {
      const res = await fetchRemarks({ clientId: client.id, limit: 100 });
      setRemarks(res.data);
    } catch {
      setRemarks([]);
    } finally {
      setRemarksLoading(false);
    }
  }, [client?.id, canWriteRemarks, effectiveSelfId]);

  const loadShareableUsers = useCallback(async () => {
    if (shareableUsersLoaded) return;
    try {
      const all = await fetchUsers();
      setShareableUsers(
        all
          .filter((u) => u.id !== currentUser.id)
          .map((u) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim(), role: u.role })),
      );
      setShareableUsersLoaded(true);
    } catch {
      // silently ignore; user picker just shows empty
    }
  }, [shareableUsersLoaded, currentUser.id]);

  const loadNoteFields = useCallback(async (): Promise<ClientNoteFieldDef[]> => {
    if (!client?.id) return [];
    setNoteFieldsLoading(true);
    try {
      const res = await fetchClientNoteFieldsForClient(client.id);
      const active = res.fields.filter((f) => f.isActive);
      setNoteFields(active);
      return active;
    } catch {
      toast.error('Failed to load note fields');
      return [];
    } finally {
      setNoteFieldsLoading(false);
    }
  }, [client?.id]);

  const resetAddNoteForm = useCallback(() => {
    setDraftValues({});
    setNoteVisibility('only_me');
    setNoteSharedWith([]);
    setIsNotePublic(true);
  }, []);

  const loadClientCalls = useCallback(async () => {
    if (!client?.id) return;
    if (!canViewCalls) {
      setClientCalls([]);
      return;
    }
    setClientCallsLoading(true);
    try {
      const res = await fetchCalls({
        clientId: client.id,
        scope: 'all',
        limit: 100,
        allAgencies: clientDetailOpts?.allAgencies,
      });
      setClientCalls(res.data);
    } catch {
      setClientCalls([]);
    } finally {
      setClientCallsLoading(false);
    }
  }, [client?.id, clientDetailOpts, canViewCalls]);

  useEffect(() => {
    if (!client?.id) return;
    if (activeSheetTab === 'calls') {
      void loadClientCalls();
      void loadRemarks();
    } else {
      setActiveRecordingCallId(null);
    }
  }, [client?.id, activeSheetTab, loadClientCalls, loadRemarks]);

  // Auto-refresh calls when a call:refresh socket event fires
  useEffect(() => {
    if (!client?.id) return;
    const unsub = onCallRefresh(() => {
      loadClientCalls();
    });
    return unsub;
  }, [client?.id, loadClientCalls]);

  const loadClientProposals = useCallback(async () => {
    if (!client?.id) return;
    setProposalsLoading(true);
    try {
      const res = await fetchProposals({
        clientId: client.id,
        limit: 100,
        allAgencies: clientDetailOpts?.allAgencies,
      });
      setFetchedProposals(res.proposals);
    } catch {
      setFetchedProposals([]);
    } finally {
      setProposalsLoading(false);
    }
  }, [client?.id, clientDetailOpts]);

  useEffect(() => {
    if (!client?.id || activeSheetTab !== 'proposals') return;
    loadClientProposals();
  }, [client?.id, activeSheetTab, loadClientProposals, clientDetailOpts]);

  useEffect(() => {
    if (!client?.id || activeSheetTab !== 'notes') return;
    void loadNoteFields();
    let cancelled = false;
    fetchClient(client.id, clientDetailOpts)
      .then((raw) => {
        if (!cancelled && raw) onClientUpdatedRef.current?.(mapFetchedClientRef.current(raw));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client?.id, activeSheetTab, loadNoteFields, clientDetailOpts, effectiveSelfId]);

  const mapFetchedClientToClient = useCallback((raw: NonNullable<Awaited<ReturnType<typeof fetchClient>>>): Client => {
    const contactList = Array.isArray(raw.contacts) && raw.contacts.length > 0
      ? raw.contacts.map((ct): ClientContact => ({
          id: ct.id,
          clientId: ct.clientId,
          name: ct.name,
          title: ct.title ?? '',
          email: ct.email ?? '',
          phone: ct.phone ?? '',
          phoneExtension: ct.phoneExtension ?? undefined,
          linkedin: ct.linkedin ?? undefined,
          website: ct.website ?? undefined,
          isPrimary: ct.isPrimary,
          isUnsubscribed: ct.isUnsubscribed,
        }))
      : client?.contacts ?? [];

    return {
      ...(client ?? {
        id: raw.id,
        name: raw.name,
        industry: raw.industry ?? '',
        location: raw.location ?? '',
        address: raw.address ?? '',
        companySize: raw.companySize ?? '',
        tags: [],
        contacts: [],
        status: raw.status as Client['status'],
        createdAt: new Date(raw.createdAt),
        notes: [],
      }),
      ...raw,
      industry: raw.industry ?? '',
      location: raw.location ?? '',
      address: raw.address ?? '',
      companySize: raw.companySize ?? '',
      tags: raw.tags ?? client?.tags ?? [],
      contacts: contactList,
      notes: (raw.notes ?? client?.notes ?? []).map(n => ({
        ...n,
        createdAt: n.createdAt instanceof Date ? n.createdAt : new Date(n.createdAt as string),
      })),
      status: raw.status as Client['status'],
      createdAt: new Date(raw.createdAt),
      lastActivity: raw.lastActivity ? new Date(raw.lastActivity) : undefined,
      hasOpenLead: raw.hasOpenLead ?? client?.hasOpenLead,
      activeLeadId: raw.activeLeadId ?? client?.activeLeadId,
      activeLeadOwnerId: raw.activeLeadOwnerId ?? client?.activeLeadOwnerId,
      activeLeadOwnerName: raw.activeLeadOwnerName ?? client?.activeLeadOwnerName,
      assignedOwnerId: raw.assignedOwnerId ?? client?.assignedOwnerId,
      assignedOwnerName: raw.assignedOwnerName ?? client?.assignedOwnerName,
      latestLostLeadId: raw.latestLostLeadId ?? client?.latestLostLeadId,
      latestLostById: raw.latestLostById ?? client?.latestLostById,
      latestLostByName: raw.latestLostByName ?? client?.latestLostByName,
      latestLostAt: raw.latestLostAt ? new Date(raw.latestLostAt) : undefined,
      latestLossReason: raw.latestLossReason ?? client?.latestLossReason,
      unsubscribeRestricted: raw.unsubscribeRestricted ?? client?.unsubscribeRestricted,
      positionsClosed: raw.positionsClosed ?? client?.positionsClosed,
      isClosedWon: (raw as { isClosedWon?: boolean }).isClosedWon ?? client?.isClosedWon,
      ownershipType: (raw as { ownershipType?: 'management' | 'associate' | null }).ownershipType ?? client?.ownershipType,
      ownershipUserId: (raw as { ownershipUserId?: string | null }).ownershipUserId ?? client?.ownershipUserId,
      ownershipUserName: (raw as { ownershipUserName?: string | null }).ownershipUserName ?? client?.ownershipUserName,
    };
  }, [client]);

  // Stable refs so the open-refresh effect below doesn't re-run when client changes.
  const mapFetchedClientRef = useRef(mapFetchedClientToClient);
  useEffect(() => { mapFetchedClientRef.current = mapFetchedClientToClient; });
  const onClientUpdatedRef = useRef(onClientUpdated);
  useEffect(() => { onClientUpdatedRef.current = onClientUpdated; });

  // Refresh client detail when sheet opens (merged view or cross-agency director content).
  // Also re-fetch when act-as user changes so notes/calls/tags reflect the new agency scope.
  useEffect(() => {
    if (!open || !client?.id || !onClientUpdatedRef.current) return;
    let cancelled = false;
    fetchClient(client.id, clientDetailOpts)
      .then((raw) => {
        if (!cancelled && raw) onClientUpdatedRef.current?.(mapFetchedClientRef.current(raw));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id, clientDetailOpts, effectiveSelfId]);

  // Live update: when a backend event (e.g. close-won auto-assignment) emits
  // client:refresh while the sheet is open, re-fetch this client so the
  // ownership badge / editor / activity timeline stay current without a reload.
  useEffect(() => {
    if (!open || !client?.id) return;
    const clientId = client.id;
    return onClientRefresh(() => {
      setActivityRefreshKey((k) => k + 1);
      fetchClient(clientId, clientDetailOpts)
        .then((raw) => {
          if (raw) onClientUpdatedRef.current?.(mapFetchedClientRef.current(raw));
        })
        .catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, client?.id, clientDetailOpts]);

  const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !client) return;
    setUploadingDoc(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const b64 = result.includes(',') ? result.split(',')[1] : result;
            resolve(b64 ?? '');
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await uploadDocument({
          clientId: client.id,
          name: file.name,
          fileBase64: base64,
          mimeType: file.type || undefined,
        });
      }
      toast.success(files.length === 1 ? 'Document uploaded' : `${files.length} documents uploaded`);
      loadClientDocuments(client.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingDoc(false);
      e.target.value = '';
    }
  };

  const refreshClientAfterContactChange = useCallback(async () => {
    if (!client?.id || !onClientUpdated) return;
    const raw = await fetchClient(client.id, clientDetailOpts);
    if (!raw) return;
    onClientUpdated(mapFetchedClientToClient(raw));
  }, [client, mapFetchedClientToClient, onClientUpdated]);

  const openEditContact = useCallback((contact: ClientContact) => {
    setEditingContactId(contact.id);
    setEditContactName(contact.name || '');
    const title = contact.title?.trim() || '';
    const knownTitle = allowedJobTitles.some((j) => j.name === title);
    if (!title) {
      setEditContactTitleSelect('__none__');
      setEditContactTitle('');
      setEditContactTitleOther('');
    } else if (knownTitle) {
      setEditContactTitleSelect(title);
      setEditContactTitle(title);
      setEditContactTitleOther('');
    } else {
      setEditContactTitleSelect('__other__');
      setEditContactTitle(title);
      setEditContactTitleOther(title);
    }
    setEditContactEmail(contact.email || '');
    setEditContactPhone(contact.phone || '');
    setEditContactPhoneExt(contact.phoneExtension || '');
    setEditContactIsPrimary(!!contact.isPrimary);
    setEditContactOpen(true);
  }, [allowedJobTitles]);

  const handleDeleteDocument = async (docId: string) => {
    if (!client) return;
    try {
      await deleteDocument(docId);
      toast.success('Document removed');
      loadClientDocuments(client.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const handleDownloadDocument = async (doc: ApiDocument) => {
    const url = (doc.fileUrl ?? '').trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      setDownloadingDocId(doc.id);
      await downloadDocument(doc.id, doc.name);
      toast.success('Download started');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingDocId(null);
    }
  };

  useEffect(() => {
    setRestrictedUsers(client?.restrictedUsers ?? []);
  }, [client?.id, client?.restrictedUsers]);

  useEffect(() => {
    if (!open || !client?.id || !isSuperUser) return;
    let cancelled = false;
    fetchClient(client.id, clientDetailOpts)
      .then((fresh) => {
        if (cancelled || !fresh) return;
        setRestrictedUsers(fresh.restrictedUsers ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, client?.id, isSuperUser]);

  const accessAgencyId = subCompanyId ?? viewedSubCompanyId ?? currentSubCompany?.id;

  useEffect(() => {
    if (!open || !isSuperUser || !accessAgencyId) return;
    let cancelled = false;
    setAccessUsersLoading(true);
    fetchUsers({ subCompanyId: accessAgencyId })
      .then((list) => {
        if (cancelled) return;
        setAccessUsers(
          list
            .filter((u) => u.isActive)
            .map((u) => ({
              id: u.id,
              name: [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
              email: u.email,
              role: u.role,
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {
        if (!cancelled) setAccessUsers([]);
      })
      .finally(() => {
        if (!cancelled) setAccessUsersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isSuperUser, accessAgencyId]);

  useEffect(() => {
    if (!open || !canManageOwnership) return;
    setOwnershipType(client?.ownershipType ?? null);
    setSelectedOwnerUserId(client?.ownershipUserId ?? null);
    setOwnershipSearch('');
    // Re-sync when the client prop's ownership fields change (live update via
    // socket / parent refresh / auto-assignment) so the editor never shows stale
    // selection after the badge has moved on.
  }, [open, canManageOwnership, client?.id, client?.ownershipType, client?.ownershipUserId]);

  useEffect(() => {
    if (!open || !canManageOwnership) return;
    let cancelled = false;
    setOwnershipUsersLoading(true);
    fetchOwnershipCandidates()
      .then((list) => {
        if (cancelled) return;
        setOwnershipUsers(list);
      })
      .catch(() => { if (!cancelled) setOwnershipUsers([]); })
      .finally(() => { if (!cancelled) setOwnershipUsersLoading(false); });
    return () => { cancelled = true; };
  }, [open, canManageOwnership]);

  const handleAccessToggle = useCallback(
    async (userId: string, enabled: boolean) => {
      if (!client?.id) return;
      setAccessMutationUserId(userId);
      try {
        const updated = await updateClientRestriction(client.id, userId, !enabled);
        setRestrictedUsers(updated);
        onClientUpdated?.({ ...client, restrictedUsers: updated });
        toast.success(enabled ? 'Access granted' : 'Access removed');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update access');
      } finally {
        setAccessMutationUserId(null);
      }
    },
    [client, onClientUpdated],
  );

  if (!client) return null;

  const unsubscribeBlocked =
    client.unsubscribeRestricted ?? client.status === 'active';
  const closedWonUnsubscribeHint =
    'Active Closed Won clients cannot be unsubscribed.';

  // Get all proposals for this client
  const clientProposals = leads.filter(lead => 
    (lead.clientId === client.id || lead.proposalData?.selectedClients?.includes(client.id)) && 
    lead.proposalData
  );

  // Helper functions for proposal display
  const getAgreementTypeLabel = (type: AgreementType) => {
    switch (type) {
      case 'temp': return 'Temporary Staffing';
      case 'direct_placement': return 'Direct Placement';
      default: return type;
    }
  };

  const getPaymentTermsLabel = (terms: PaymentTerms) => {
    switch (terms) {
      case 'net_7': return 'Net 7';
      case 'net_15': return 'Net 15';
      case 'net_30': return 'Net 30';
      case 'net_45': return 'Net 45';
      case 'net_60': return 'Net 60';
      default: return terms;
    }
  };

  const getPricingLabel = (pricingType: PricingType, value: number) => {
    return pricingType === 'markup' ? `${value}% Markup` : `$${value}/hr Bill Rate`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    if (type.includes('sheet') || type.includes('excel')) return <FileText className="h-4 w-4 text-green-500" />;
    if (type.includes('doc')) return <FileText className="h-4 w-4 text-blue-500" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  const getStageLabel = (stage: string) => {
    switch (stage) {
      case 'proposal_sent': return 'Proposal Sent';
      case 'closed_won': return 'Closed Won';
      case 'closed_lost': return 'Closed Lost';
      default: return stage.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  const getStageColor = (stage: string) => {
    switch (stage) {
      case 'proposal_sent': return 'bg-blue-100 text-blue-800';
      case 'closed_won': return 'bg-green-100 text-green-800';
      case 'closed_lost': return 'bg-red-100 text-red-800';
      default: return 'bg-muted text-muted-foreground';
    }
  };
  
  const filteredAccessUsers = accessUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(accessSearchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(accessSearchTerm.toLowerCase()),
  );

  const getClientLead = (clientId: string) => {
    const agencyId = subCompanyId ?? viewedSubCompanyId ?? currentSubCompany?.id;
    return leads.find(
      (lead) =>
        lead.clientId === clientId && (!agencyId || lead.subCompanyId === agencyId),
    );
  };

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return <PhoneCall className="h-4 w-4" />;
      case 'meeting_scheduled':
        return <Calendar className="h-4 w-4" />;
      case 'task_created':
      case 'task_completed':
      case 'task_status_changed':
        return <CheckCircle className="h-4 w-4" />;
      case 'pipeline_moved':
        return <ArrowRight className="h-4 w-4" />;
      case 'follow_up_created':
        return <CalendarClock className="h-4 w-4" />;
      case 'follow_up_completed':
        return <CheckCheck className="h-4 w-4" />;
      case 'follow_up_reopened':
        return <RotateCcw className="h-4 w-4" />;
      case 'follow_up_rescheduled':
        return <RefreshCw className="h-4 w-4" />;
      case 'comment_added':
        return <StickyNote className="h-4 w-4" />;
      case 'email_sent':
        return <Mail className="h-4 w-4" />;
      case 'proposal_approved':
      case 'lead_won':
        return <CheckCircle className="h-4 w-4" />;
      case 'proposal_rejected':
      case 'lead_lost':
        return <X className="h-4 w-4" />;
      case 'client_contacted':
        return <PhoneIcon className="h-4 w-4" />;
      case 'client_unsubscribed':
        return <MailX className="h-4 w-4" />;
      case 'client_resubscribed':
        return <MailCheck className="h-4 w-4" />;
      case 'client_permanently_closed':
        return <XCircle className="h-4 w-4" />;
      case 'client_reopened':
        return <RefreshCw className="h-4 w-4" />;
      case 'client_marked_ex':
        return <XCircle className="h-4 w-4" />;
      case 'client_unmarked_ex':
        return <RefreshCw className="h-4 w-4" />;
      case 'contact_unsubscribed':
        return <MailX className="h-4 w-4" />;
      case 'ownership_changed':
        return <UserCog className="h-4 w-4" />;
      case 'ownership_auto_skipped':
        return <Info className="h-4 w-4" />;
      case 'call':
        return <PhoneOutgoing className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return 'text-blue-500';
      case 'meeting_scheduled':
        return 'text-purple-500';
      case 'task_completed':
        return 'text-green-500';
      case 'task_created':
      case 'task_status_changed':
        return 'text-orange-500';
      case 'pipeline_moved':
        return 'text-indigo-500';
      case 'email_sent':
        return 'text-pink-500';
      case 'follow_up_created':
        return 'text-violet-500';
      case 'follow_up_completed':
        return 'text-emerald-500';
      case 'follow_up_reopened':
        return 'text-amber-500';
      case 'follow_up_rescheduled':
        return 'text-cyan-500';
      case 'proposal_approved':
      case 'lead_won':
        return 'text-green-500';
      case 'proposal_rejected':
      case 'lead_lost':
        return 'text-red-500';
      case 'client_contacted':
        return 'text-teal-500';
      case 'client_unsubscribed':
        return 'text-orange-500';
      case 'client_resubscribed':
        return 'text-emerald-500';
      case 'client_permanently_closed':
        return 'text-red-500';
      case 'client_reopened':
        return 'text-blue-500';
      case 'client_marked_ex':
        return 'text-amber-500';
      case 'client_unmarked_ex':
        return 'text-blue-500';
      case 'contact_unsubscribed':
        return 'text-orange-500';
      case 'ownership_changed':
        return 'text-violet-500';
      case 'ownership_auto_skipped':
        return 'text-muted-foreground';
      case 'call':
        return 'text-blue-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={`p-0 overflow-hidden flex h-full min-h-0 ${phoneDialerSlot ? 'w-full sm:max-w-[1400px] [&>button]:z-50' : 'w-full sm:max-w-[1000px]'}`}>
        {/* Phone Dialer Slot - renders on left side when provided */}
        {phoneDialerSlot}
        
        {/* Client Details Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <SheetHeader className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex gap-3 items-start">
                {/* Avatar with Initials */}
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-lg font-semibold text-primary">
                    {client.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-1">
                    <SheetTitle className="text-xl font-semibold">{client.name}</SheetTitle>
                    {canWriteClients && !allAgenciesView && (
                      <button
                        onClick={() => setEditClientOpen(true)}
                        title="Edit client"
                        className="ml-1 inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 active:scale-95 transition-all duration-150"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                <p className="text-sm text-muted-foreground">
                  {client.name.toLowerCase().replace(/\s+/g, '') + '.com'}
                </p>
              </div>
            </div>
          </div>
        </SheetHeader>

        {/* Tags — always visible regardless of active tab */}
        {(Array.from(new Set(client.tags ?? [])).length > 0 || allowedTags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-3">
            {Array.from(new Set(client.tags ?? [])).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
              >
                {tag}
                <button
                  type="button"
                  onClick={async () => {
                    if (!client?.id || tagMutationLoading) return;
                    setTagMutationLoading(true);
                    try {
                      await removeClientTag(client.id, tag, clientActionOpts);
                      const updated = await fetchClient(client.id, clientDetailOpts);
                      if (updated) onClientUpdated?.(mapFetchedClientToClient(updated));
                      toast.success('Tag removed');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to remove tag');
                    } finally {
                      setTagMutationLoading(false);
                    }
                  }}
                  className="rounded-full hover:text-destructive transition-colors ml-0.5"
                  aria-label={`Remove ${tag}`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {allowedTags.length > 0 && (
              <div className="relative">
                <select
                  value=""
                  onChange={async (e) => {
                    const tag = e.target.value;
                    if (!tag || !client?.id || tagMutationLoading) return;
                    e.target.value = '';
                    setTagMutationLoading(true);
                    try {
                      await addClientTag(client.id, tag, clientActionOpts);
                      const updated = await fetchClient(client.id, clientDetailOpts);
                      if (updated) onClientUpdated?.(mapFetchedClientToClient(updated));
                      toast.success('Tag added');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Failed to add tag');
                    } finally {
                      setTagMutationLoading(false);
                    }
                  }}
                  disabled={tagMutationLoading}
                  className="absolute inset-0 opacity-0 w-full cursor-pointer"
                >
                  <option value="">Add tag...</option>
                  {allowedTags
                    .filter((t) => !(client.tags ?? []).includes(t.tag))
                    .map((t) => (
                      <option key={t.id} value={t.tag}>{t.tag}</option>
                    ))}
                </select>
                <span className="inline-flex items-center gap-1 px-2 h-6 rounded-full border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer text-xs">
                  <Plus className="h-3 w-3" /> Add tag
                </span>
              </div>
            )}
          </div>
        )}

        {/* Ownership badge — visible to users with clients:ownership permission */}
        {canManageOwnership && (
          <div className="flex items-center gap-1.5 mt-2">
            <span className="text-xs text-muted-foreground">Ownership:</span>
            {client.ownershipType === 'management' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-600 border border-blue-500/20">
                <Building2 className="h-3 w-3" /> Management
              </span>
            ) : client.ownershipType === 'associate' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600 border border-violet-500/20">
                <Users className="h-3 w-3" />
                {(() => {
                  if (client.ownershipUserName) return client.ownershipUserName;
                  const candidate = ownershipUsers.find(u => u.id === client.ownershipUserId);
                  if (candidate) return [candidate.firstName, candidate.lastName].filter(Boolean).join(' ') || candidate.email || 'Associate';
                  return 'Associate';
                })()}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground border border-border">
                Not set
              </span>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {((canWriteClients) || (canWriteTasks && onAddTaskClick)) && (
        <div className="flex gap-2 mt-6 mb-4 flex-wrap">
          {canWriteClients && onAddFollowUpClick && (
          <Button
            variant="outline"
            className="gap-2 flex-1"
            onClick={onAddFollowUpClick}
          >
            <CalendarClock className="h-4 w-4" />
            Create Follow-up
          </Button>
          )}
          {canWriteTasks && onAddTaskClick && (
            <Button
              variant="outline"
              className="gap-2 flex-1"
              onClick={onAddTaskClick}
            >
              <Plus className="h-4 w-4" />
              Create Task
            </Button>
          )}
        </div>
        )}

        <div className="border-t pt-6">
          <Tabs value={activeSheetTab} onValueChange={setActiveSheetTab} className="w-full">
            {(() => {
              const showCallsTab = canViewCalls || canWriteRemarks;
              const showNotesTab = canViewNotes || canWriteNotes;
              return (
                <TabsList className="flex w-full h-auto p-1 gap-0.5 overflow-x-auto scrollbar-none">
                  <TabsTrigger value="overview" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Overview</TabsTrigger>
                  <TabsTrigger value="activity" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Activity</TabsTrigger>
                  <TabsTrigger value="contacts" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Contacts</TabsTrigger>
                  {showCallsTab && (
                    <TabsTrigger value="calls" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Calls &amp; Remarks</TabsTrigger>
                  )}
                  <TabsTrigger value="followups" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Follow-ups</TabsTrigger>
                  <TabsTrigger value="proposals" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Proposals</TabsTrigger>
                  <TabsTrigger value="leadHistory" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Lead History</TabsTrigger>
                  {showNotesTab && (
                    <TabsTrigger value="notes" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Client Notes</TabsTrigger>
                  )}
                  <TabsTrigger value="attachments" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Attachments</TabsTrigger>
                  {isSuperUser && <TabsTrigger value="access" className="px-3 py-1.5 text-xs whitespace-nowrap flex-shrink-0">Access</TabsTrigger>}
                </TabsList>
              );
            })()}

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6 mt-6">

              {/* Ownership — users with clients:ownership permission */}
              {canManageOwnership && (
                <div className="rounded-xl border bg-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Ownership</p>
                    <button
                      type="button"
                      onClick={() => setShowOwnershipHistory((v) => !v)}
                      className="flex items-center gap-1 rounded-md border border-primary/40 bg-primary/8 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/15"
                    >
                      {showOwnershipHistory ? 'Hide History' : 'History'}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setOwnershipType('management'); setSelectedOwnerUserId(null); setOwnershipSearch(''); }}
                      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors text-left ${
                        ownershipType === 'management'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      <Building2 className="h-4 w-4 shrink-0" />
                      Owned by Management
                    </button>
                    <button
                      type="button"
                      onClick={() => setOwnershipType('associate')}
                      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-colors text-left ${
                        ownershipType === 'associate'
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
                      }`}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      Owned by Associate
                    </button>
                  </div>

                  {ownershipType === 'associate' && (
                    selectedOwnerUserId ? (() => {
                      const u = ownershipUsers.find((x) => x.id === selectedOwnerUserId);
                      if (!u) return null;
                      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                      return (
                        <div className="flex items-center justify-between rounded-xl border border-primary/20 bg-primary/10 px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="h-7 w-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-primary">{name}</p>
                              <p className="text-xs text-muted-foreground">{getUserRoleTitle(u)}</p>
                            </div>
                          </div>
                          <button type="button" onClick={() => { setSelectedOwnerUserId(null); setOwnershipSearch(''); }} className="text-muted-foreground hover:text-destructive transition-colors">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    })() : (
                      <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                        <input
                          type="text"
                          placeholder="Search associate..."
                          value={ownershipSearch}
                          onChange={(e) => setOwnershipSearch(e.target.value)}
                          className="w-full h-8 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        {ownershipUsersLoading ? (
                          <p className="text-xs text-muted-foreground py-2 text-center">Loading...</p>
                        ) : (
                          <div className="max-h-40 overflow-y-auto space-y-0.5">
                            {ownershipUsers
                              .filter((u) => {
                                const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
                                return !ownershipSearch || name.includes(ownershipSearch.toLowerCase()) || u.email.toLowerCase().includes(ownershipSearch.toLowerCase());
                              })
                              .map((u) => {
                                const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                                return (
                                  <button key={u.id} type="button" onClick={() => setSelectedOwnerUserId(u.id)}
                                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors text-left hover:bg-muted/60"
                                  >
                                    <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">{name.charAt(0).toUpperCase()}</div>
                                    <div className="min-w-0">
                                      <p className="truncate leading-tight">{name}</p>
                                      <p className="text-xs text-muted-foreground truncate">{getUserRoleTitle(u)}</p>
                                    </div>
                                  </button>
                                );
                              })}
                            {ownershipUsers.filter((u) => {
                              const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
                              return !ownershipSearch || name.includes(ownershipSearch.toLowerCase()) || u.email.toLowerCase().includes(ownershipSearch.toLowerCase());
                            }).length === 0 && (
                              <p className="text-xs text-muted-foreground py-2 text-center">No users found</p>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  )}

                  {ownershipType && (
                    <Button
                      size="sm"
                      className="w-full"
                      disabled={ownershipSaving || (ownershipType === 'associate' && !selectedOwnerUserId)}
                      onClick={async () => {
                        if (!client?.id || !ownershipType) return;
                        setOwnershipSaving(true);
                        try {
                          await updateClientOwnership(client.id, ownershipType, selectedOwnerUserId ?? null);
                          const [updated, logs] = await Promise.all([
                            fetchClient(client.id, clientDetailOpts),
                            fetchClientActivityLogs(client.id, { page: 1, limit: 100 }, clientDetailOpts),
                          ]);
                          if (updated) onClientUpdated?.(mapFetchedClientToClient(updated));
                          setClientActivities(logs);
                          toast.success('Ownership saved');
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Failed to save ownership');
                        } finally {
                          setOwnershipSaving(false);
                        }
                      }}
                    >
                      {ownershipSaving ? 'Saving...' : 'Save Ownership'}
                    </Button>
                  )}

                  {showOwnershipHistory && (() => {
                    const ownershipEvents = (clientActivities ?? []).filter(
                      (a) => a.type === 'ownership_changed' || a.type === 'ownership_auto_skipped'
                    );
                    return (
                      <div className="mt-1 border-t pt-4">
                        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">Ownership History</p>
                        {clientActivities === null ? (
                          <div className="flex items-center justify-center py-8 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            <span className="text-xs">Loading history...</span>
                          </div>
                        ) : ownershipEvents.length === 0 ? (
                          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                            <Users className="h-7 w-7 opacity-30" />
                            <p className="text-xs">No ownership changes recorded yet.</p>
                          </div>
                        ) : (
                          <div className="relative pl-5 max-h-80 overflow-y-auto pr-1">
                            {/* vertical connector */}
                            <div className="absolute left-[7px] top-1.5 bottom-1.5 w-px bg-border" />
                            <div className="flex flex-col gap-3">
                              {ownershipEvents.map((a, idx) => {
                                const m = a.metadata ?? {};
                                const isAuto = m.source === 'auto_closed_won';
                                const isSkipped = a.type === 'ownership_auto_skipped';
                                const prevLabel = m.previousType == null ? 'Unset' : m.previousType === 'management' ? 'Management' : (m.previousName ?? 'Associate');
                                const nextLabel = isSkipped ? null : (m.newType === 'management' ? 'Management' : (m.newName ?? 'Associate'));
                                const date = new Date(a.timestamp);
                                return (
                                  <div key={a.id ?? idx} className="relative">
                                    {/* dot */}
                                    <span className={`absolute -left-5 top-3.5 h-3.5 w-3.5 rounded-full border-2 border-background ring-1 ${isAuto || isSkipped ? 'bg-muted-foreground/50 ring-muted-foreground/20' : 'bg-blue-500 ring-blue-200'}`} />
                                    <div className="rounded-xl border bg-card shadow-sm px-3.5 py-3 space-y-2">
                                      {/* top row */}
                                      <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-muted-foreground">
                                          {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                          <span className="mx-1 opacity-40">·</span>
                                          {date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${
                                          isSkipped
                                            ? 'border-orange-300 bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:border-orange-500/30 dark:text-orange-400'
                                            : isAuto
                                              ? 'border-violet-300 bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:border-violet-500/30 dark:text-violet-400'
                                              : 'border-blue-300 bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:border-blue-500/30 dark:text-blue-400'
                                        }`}>
                                          {isSkipped ? 'Skipped' : isAuto ? 'Auto' : 'Manual'}
                                        </span>
                                      </div>
                                      {/* transition row */}
                                      {!isSkipped && nextLabel && (
                                        <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                                          <span className="rounded-md bg-muted px-2 py-0.5">{prevLabel}</span>
                                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                          <span className="rounded-md bg-primary/10 text-primary px-2 py-0.5">{nextLabel}</span>
                                        </div>
                                      )}
                                      {isSkipped && m.reason && (
                                        <p className="text-xs text-muted-foreground">
                                          Skipped: <span className="text-foreground font-medium">{
                                            m.reason === 'no_winning_proposal' ? 'No approved proposal found'
                                            : m.reason === 'creator_missing' ? 'Proposal creator not found'
                                            : m.reason === 'creator_inactive' ? 'Proposal creator is inactive'
                                            : m.reason
                                          }</span>
                                        </p>
                                      )}
                                      {/* changed by */}
                                      <p className="text-[11px] text-muted-foreground">
                                        {isAuto || isSkipped ? 'Triggered by' : 'Changed by'}:{' '}
                                        <span className="font-medium text-foreground">{a.userName}</span>
                                      </p>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Contact Information */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Contact Information
                </h3>
                <div className="space-y-4">
                  {client.contacts.length > 0 ? (
                    [...client.contacts]
                      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name))
                      .map((contact) => (
                        <div key={contact.id} className="space-y-2 rounded-md border border-border/60 p-3">
                          <div className="flex items-start gap-3">
                            <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    {contact.name}
                                    {contact.isPrimary && (
                                      <Badge variant="secondary" className="ml-2 text-[10px] align-middle">Primary</Badge>
                                    )}
                                  </p>
                                  {contact.title ? (
                                    <p className="text-xs text-muted-foreground">{contact.title}</p>
                                  ) : null}
                                </div>
                                {canEditContacts && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 shrink-0 text-xs"
                                    disabled={contactMutationLoading}
                                    title="Edit contact"
                                    onClick={() => openEditContact(contact)}
                                  >
                                    <Pencil className="h-3 w-3 mr-1" />
                                    Edit
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                          {contact.email ? (
                            <div className="flex items-start gap-3">
                              <Mail className="h-4 w-4 text-muted-foreground mt-0.5" />
                              <a
                                href={`mailto:${contact.email}`}
                                className="text-sm text-primary hover:underline"
                              >
                                {contact.email}
                              </a>
                            </div>
                          ) : null}
                          {contact.phone ? (
                            <div className="flex items-start gap-3">
                              <PhoneIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                              <div className="text-sm">
                                <a href={`tel:${contact.phone}`} className="hover:underline">
                                  {contact.phone}
                                </a>
                                {contact.phoneExtension?.trim() && (
                                  <span className="text-muted-foreground ml-1">ext. {contact.phoneExtension.trim()}</span>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))
                  ) : (
                    <p className="text-sm text-muted-foreground">No contacts assigned</p>
                  )}
                  {client.address ? (
                    <div className="flex items-start gap-3">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm">{client.address}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Company Details */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Company Details
                </h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{client.industry}</p>
                      <p className="text-xs text-muted-foreground">Industry</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Users className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{client.companySize}</p>
                      <p className="text-xs text-muted-foreground">Company Size</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{client.location}</p>
                      <p className="text-xs text-muted-foreground">Location</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Positions Secured — only shown for Closed Won clients */}
              {client.unsubscribeRestricted && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                    Deal Outcome
                  </h3>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-green-700">{client.positionsClosed ?? 0}</span>
                      <div>
                        <p className="text-sm font-medium text-green-700">Positions Secured</p>
                        <p className="text-xs text-muted-foreground">From closed won proposal</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Lead Status */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Lead Status
                </h3>
                {(() => {
                  if (client.status === 'lost') {
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="destructive">
                          Lost
                        </Badge>
                        <Badge variant="secondary">
                          Lost by {client.latestLostByName || 'Unknown'}
                        </Badge>
                      </div>
                    );
                  }
                  const lead = getClientLead(client.id);
                  return client.activeLeadOwnerName || lead ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        Assigned to {client.activeLeadOwnerName || lead?.ownerName || 'Unknown'}
                      </Badge>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No active lead</p>
                  );
                })()}
              </div>

              {/* Client Status Toggles */}
              <div className="pt-6 border-t">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
                  Client Status
                </h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="permanently-closed" className="text-sm font-normal">
                      Permanently Closed
                    </Label>
                    <Switch
                      id="permanently-closed"
                      checked={client.status === 'permanently_closed'}
                      disabled={!isManager}
                      onCheckedChange={async (checked) => {
                        if (!isManager || !client?.id) return;
                        try {
                          const newStatus = checked ? 'permanently_closed' : 'contacted';
                          await updateClientAgencyStatus(client.id, newStatus, clientActionOpts);
                          const raw = await fetchClient(client.id, clientDetailOpts);
                          if (raw) onClientUpdated?.(mapFetchedClientToClient(raw));
                          toast.success(checked ? 'Client marked as permanently closed' : 'Client status restored');
                        } catch (e: unknown) {
                          toast.error(e instanceof Error ? e.message : 'Failed to update status');
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label
                      htmlFor="unsubscribed"
                      className="text-sm font-normal"
                      title={unsubscribeBlocked ? closedWonUnsubscribeHint : undefined}
                    >
                      Unsubscribed
                    </Label>
                    <Switch
                      id="unsubscribed"
                      checked={client.status === 'unsubscribed'}
                      disabled={!isManager || unsubscribeBlocked}
                      title={unsubscribeBlocked ? closedWonUnsubscribeHint : undefined}
                      onCheckedChange={async (checked) => {
                        if (!isManager || !client?.id || unsubscribeBlocked) return;
                        try {
                          const newStatus = checked ? 'unsubscribed' : 'contacted';
                          await updateClientAgencyStatus(client.id, newStatus, clientActionOpts);
                          const raw = await fetchClient(client.id, clientDetailOpts);
                          if (raw) onClientUpdated?.(mapFetchedClientToClient(raw));
                          toast.success(checked ? 'Client marked as unsubscribed' : 'Client status restored');
                        } catch (e: unknown) {
                          toast.error(e instanceof Error ? e.message : 'Failed to update status');
                        }
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ex-client" className="text-sm font-normal">
                      Ex Client
                    </Label>
                    <Switch
                      id="ex-client"
                      checked={client.status === 'ex'}
                      disabled={!isManager}
                      onCheckedChange={async (checked) => {
                        if (!isManager || !client?.id) return;
                        try {
                          const newStatus = checked ? 'ex' : 'contacted';
                          await updateClientAgencyStatus(client.id, newStatus, clientActionOpts);
                          const raw = await fetchClient(client.id, clientDetailOpts);
                          if (raw) onClientUpdated?.(mapFetchedClientToClient(raw));
                          toast.success(checked ? 'Client marked as Ex Client' : 'Client status restored');
                        } catch (e: unknown) {
                          toast.error(e instanceof Error ? e.message : 'Failed to update status');
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Activity Log Tab */}
            <TabsContent value="activity" className="space-y-4 mt-6">
              {(() => {
                if (!client) return null;

                if (activityLoading && (!clientActivities || clientActivities.length === 0)) {
                  return (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Loading activity...
                    </p>
                  );
                }

                const logs = (clientActivities ?? []).slice().sort(
                  (a, b) => a.timestamp.getTime() < b.timestamp.getTime() ? 1 : -1
                );

                if (logs.length === 0) {
                  return (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No activity recorded yet
                    </p>
                  );
                }

                return (
                  <div className="space-y-4">
                    {logs.map((activity, index) => (
                      <div key={activity.id} className="relative">
                        {index !== logs.length - 1 && (
                          <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-border" />
                        )}
                        <div className="flex gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background ${getActivityColor(activity.type)}`}>
                            {getActivityIcon(activity.type)}
                          </div>
                          <div className="flex-1 space-y-1">
                            <p className="text-sm font-medium">{activity.description}</p>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{activity.userName}</span>
                              <span>•</span>
                              <span>{format(activity.timestamp, 'MMM d, yyyy h:mm a')}</span>
                            </div>
                            {activity.metadata?.duration !== undefined && activity.metadata.duration > 0 && (
                              <Badge variant="outline" className="text-xs">
                                {activity.metadata.duration} min
                              </Badge>
                            )}
                            {activity.type === 'ownership_changed' && (() => {
                              const m = activity.metadata ?? {};
                              const isAuto = m.source === 'auto_closed_won';
                              const prevLabel =
                                m.previousType == null ? 'Unset'
                                : m.previousType === 'management' ? 'Management'
                                : (m.previousName ?? 'Associate');
                              const nextLabel =
                                m.newType === 'management' ? 'Management'
                                : (m.newName ?? 'Associate');
                              return (
                                <div className="mt-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2 space-y-1.5">
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-muted-foreground">From:</span>
                                    <span className="font-medium">{prevLabel}</span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="text-muted-foreground">To:</span>
                                    <span className="font-medium">{nextLabel}</span>
                                  </div>
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-muted-foreground">{isAuto ? 'Triggered by:' : 'Set by:'}</span>
                                    <span className="font-medium">{activity.userName}</span>
                                  </div>
                                  <Badge
                                    variant="outline"
                                    className={
                                      isAuto
                                        ? 'text-xs border-violet-500/30 text-violet-600 bg-violet-500/5'
                                        : 'text-xs border-blue-500/30 text-blue-600 bg-blue-500/5'
                                    }
                                  >
                                    {isAuto ? 'Auto · Closed Won' : 'Manual'}
                                  </Badge>
                                </div>
                              );
                            })()}
                            {activity.type === 'ownership_auto_skipped' && activity.metadata?.reason && (
                              <div className="mt-1.5 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
                                Reason: {
                                  activity.metadata.reason === 'no_winning_proposal' ? 'No approved proposal found'
                                  : activity.metadata.reason === 'creator_missing' ? 'Proposal creator not found'
                                  : activity.metadata.reason === 'creator_inactive' ? 'Proposal creator is inactive'
                                  : activity.metadata.reason
                                }
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">At least one contact is required.</p>
                {onClientUpdated && canAddContacts && (
                  <Button size="sm" onClick={() => { setAddContactOpen(true); setAddContactName(''); setAddContactTitle(''); setAddContactEmail(''); setAddContactPhone(''); setAddContactPhoneExt(''); setAddContactIsPrimary(false); }}>
                    <UserPlus className="h-4 w-4 mr-1" />
                    Add contact
                  </Button>
                )}
              </div>
              {client.contacts.map((contact) => (
                <Card key={contact.id} className="border-none shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-sm text-muted-foreground">{contact.title || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {contact.isPrimary && (
                          <Badge variant="secondary" className="text-xs">Primary</Badge>
                        )}
                        {contact.isUnsubscribed && (
                          <Badge variant="destructive" className="text-xs">Unsubscribed</Badge>
                        )}
                        {canEditContacts && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={contactMutationLoading}
                            title="Edit contact"
                            onClick={() => openEditContact(contact)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        )}
                        {onClientUpdated && (
                          <>
                            {contact.isUnsubscribed ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-green-600 hover:text-green-700"
                                disabled={contactMutationLoading}
                                onClick={async () => {
                                  if (!client?.id) return;
                                  setContactMutationLoading(true);
                                  try {
                                    await updateContactUnsubscribed(client.id, contact.id, false, clientActionOpts);
                                    toast.success('Contact resubscribed');
                                    await refreshClientAfterContactChange();
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Failed to resubscribe');
                                  } finally {
                                    setContactMutationLoading(false);
                                  }
                                }}
                              >
                                <MailCheck className="h-3 w-3 mr-1" />
                                Resubscribe
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-orange-600 hover:text-orange-700"
                                disabled={contactMutationLoading || !contact.email || unsubscribeBlocked}
                                title={
                                  unsubscribeBlocked
                                    ? closedWonUnsubscribeHint
                                    : !contact.email
                                      ? 'Contact has no email address'
                                      : 'Send unsubscribe email and mark as unsubscribed'
                                }
                                onClick={async () => {
                                  if (!client?.id || unsubscribeBlocked) return;
                                  setContactMutationLoading(true);
                                  try {
                                    const result = await unsubscribeContact(client.id, contact.id, clientActionOpts);
                                    toast.success(result.message || 'Unsubscribe email sent');
                                    await refreshClientAfterContactChange();
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Failed to unsubscribe');
                                  } finally {
                                    setContactMutationLoading(false);
                                  }
                                }}
                              >
                                <MailX className="h-3 w-3 mr-1" />
                                Unsubscribe
                              </Button>
                            )}
                            {!contact.isPrimary && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                disabled={contactMutationLoading}
                                onClick={async () => {
                                  if (!client?.id) return;
                                  setContactMutationLoading(true);
                                  try {
                                    await setClientContactPrimary(client.id, contact.id, clientActionOpts);
                                    toast.success('Primary contact updated');
                                    await refreshClientAfterContactChange();
                                  } catch (e) {
                                    toast.error(e instanceof Error ? e.message : 'Failed to set primary');
                                  } finally {
                                    setContactMutationLoading(false);
                                  }
                                }}
                              >
                                <Star className="h-3 w-3 mr-1" />
                                Set as primary
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs text-destructive hover:text-destructive"
                              disabled={client.contacts.length <= 1 || contactMutationLoading}
                              title={client.contacts.length <= 1 ? 'At least one contact is required' : 'Remove contact'}
                              onClick={async () => {
                                if (!client?.id || client.contacts.length <= 1) return;
                                setContactMutationLoading(true);
                                try {
                                  await deleteClientContact(client.id, contact.id, clientActionOpts);
                                  toast.success('Contact removed');
                                  await refreshClientAfterContactChange();
                                } catch (e) {
                                  toast.error(e instanceof Error ? e.message : 'Failed to remove contact');
                                } finally {
                                  setContactMutationLoading(false);
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-2 mt-3">
                      {contact.email && (
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                          <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                            {contact.email}
                          </a>
                        </div>
                      )}
                      {(contact.phone || contact.phoneExtension) && (
                        <div className="flex items-center gap-2 text-sm">
                          <PhoneIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            {contact.phone ? (
                              <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                                {contact.phone}
                              </a>
                            ) : null}
                            {contact.phoneExtension?.trim() && (
                              <span className="text-muted-foreground ml-1">ext. {contact.phoneExtension.trim()}</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}

              {/* Add Contact Dialog */}
              <Dialog open={addContactOpen} onOpenChange={(open) => {
                setAddContactOpen(open);
                if (!open) { setAddContactTitleSelect('__none__'); setAddContactTitleOther(''); setAddContactTitle(''); setAddContactName(''); setAddContactEmail(''); setAddContactPhone(''); setAddContactPhoneExt(''); setAddContactIsPrimary(false); }
              }}>
                <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Add contact</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="add-contact-name">Name *</Label>
                      <Input
                        id="add-contact-name"
                        placeholder="e.g. John Doe"
                        value={addContactName}
                        onChange={(e) => setAddContactName(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="add-contact-title">Title</Label>
                      <Select
                        value={addContactTitleSelect}
                        onValueChange={(value) => {
                          setAddContactTitleSelect(value);
                          if (value === '__other__') {
                            setAddContactTitle(addContactTitleOther);
                          } else {
                            setAddContactTitle(value === '__none__' ? '' : value);
                          }
                        }}
                      >
                        <SelectTrigger id="add-contact-title">
                          <SelectValue placeholder="Select job title" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Select job title</SelectItem>
                          {allowedJobTitles.map((j) => (
                            <SelectItem key={j.id} value={j.name}>{j.name}</SelectItem>
                          ))}
                          <SelectItem value="__other__">Other (enter below)</SelectItem>
                        </SelectContent>
                      </Select>
                      {addContactTitleSelect === '__other__' && (
                        <Input
                          placeholder="e.g. VP Sales"
                          value={addContactTitleOther}
                          onChange={(e) => setAddContactTitleOther(e.target.value)}
                        />
                      )}
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="add-contact-email">Email</Label>
                      <Input
                        id="add-contact-email"
                        type="email"
                        placeholder="john@company.com"
                        value={addContactEmail}
                        onChange={(e) => setAddContactEmail(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="grid gap-2">
                        <Label htmlFor="add-contact-phone">Phone</Label>
                        <Input
                          id="add-contact-phone"
                          placeholder="+1 234 567 8900"
                          value={addContactPhone}
                          onChange={(e) => setAddContactPhone(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="add-contact-ext">Ext.</Label>
                        <Input
                          id="add-contact-ext"
                          placeholder="123"
                          value={addContactPhoneExt}
                          onChange={(e) => setAddContactPhoneExt(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="add-contact-primary"
                        checked={addContactIsPrimary}
                        onCheckedChange={(checked) => setAddContactIsPrimary(checked === true)}
                      />
                      <Label htmlFor="add-contact-primary" className="font-normal cursor-pointer">Set as primary contact</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setAddContactOpen(false)}>Cancel</Button>
                    <Button
                      disabled={!addContactName.trim() || contactMutationLoading}
                      onClick={async () => {
                        if (!client?.id || !addContactName.trim()) return;
                        setContactMutationLoading(true);
                        try {
                          const titleToSend = (addContactTitleSelect === '__other__' ? addContactTitleOther : addContactTitleSelect === '__none__' ? addContactTitle : addContactTitleSelect).trim() || undefined;
                          const result = await addClientContact(client.id, {
                            name: addContactName.trim(),
                            title: titleToSend,
                            email: addContactEmail.trim() || undefined,
                            phone: addContactPhone.trim() || undefined,
                            phoneExtension: addContactPhoneExt.trim() || undefined,
                            isPrimary: addContactIsPrimary,
                          }, clientActionOpts);
                          setAddContactOpen(false);
                          if (result.pendingEdit) {
                            toast.success(result.message ?? 'Contact add submitted for approval.');
                            onPendingEditSubmitted?.();
                          } else {
                            toast.success(result.message ?? 'Contact added');
                            await refreshClientAfterContactChange();
                          }
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Failed to add contact');
                        } finally {
                          setContactMutationLoading(false);
                        }
                      }}
                    >
                      {contactMutationLoading ? 'Adding...' : 'Add contact'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>

            {/* Calls & Remarks Tab — merged timeline (calls + remarks) */}
            <TabsContent value="calls" className="space-y-5 mt-6">
              {/* Header */}
              <div className="flex justify-between items-center pb-3 border-b">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Calls & Remarks
                </h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { void loadClientCalls(); void loadRemarks(); }}
                    disabled={clientCallsLoading || remarksLoading}
                  >
                    <RefreshCw className={`h-4 w-4 ${(clientCallsLoading || remarksLoading) ? 'animate-spin' : ''}`} />
                  </Button>
                  {!addRemarkOpen && canWriteRemarks && (
                    <Button size="sm" onClick={() => setAddRemarkOpen(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Remark
                    </Button>
                  )}
                </div>
              </div>

              {/* Add remark form — at the TOP, only when open */}
              {addRemarkOpen && canWriteRemarks && (
                <Card className="border-none shadow-sm">
                  <CardContent className="p-4 space-y-3">
                    <Textarea
                      placeholder="Add a remark..."
                      value={newRemarkContent}
                      onChange={(e) => setNewRemarkContent(e.target.value)}
                      className="min-h-[80px]"
                      autoFocus
                    />

                    {canCreatePublicRemark && (
                      <VisibilityPicker
                        idPrefix="remark-add"
                        visibility={newRemarkVisibility}
                        sharedWith={newRemarkSharedWith}
                        onVisibilityChange={setNewRemarkVisibility}
                        onSharedWithChange={setNewRemarkSharedWith}
                        canPostPublic
                        canPostGlobal={canPostAcrossAgencies}
                        shareableUsers={shareableUsers}
                        onRequestShareableUsers={loadShareableUsers}
                        compact
                      />
                    )}

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={remarkSubmitting}
                        onClick={() => {
                          setNewRemarkContent('');
                          setNewRemarkVisibility('only_me');
                          setNewRemarkScope('agency');
                          setNewRemarkSharedWith([]);
                          setAddRemarkOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={
                          !newRemarkContent.trim() ||
                          remarkSubmitting ||
                          (newRemarkVisibility === 'shared' && newRemarkSharedWith.length === 0)
                        }
                        onClick={async () => {
                          const content = newRemarkContent.trim();
                          if (!content || !client?.id) return;
                          setRemarkSubmitting(true);
                          try {
                            const visibilityPayload = toRemarkPayload(newRemarkVisibility, newRemarkSharedWith);
                            await createRemark({
                              clientId: client.id,
                              content,
                              ...visibilityPayload,
                            });
                            setNewRemarkContent('');
                            setNewRemarkVisibility('only_me');
                            setNewRemarkScope('agency');
                            setNewRemarkSharedWith([]);
                            setAddRemarkOpen(false);
                            await loadRemarks();
                            toast.success('Remark added');
                          } catch {
                            toast.error('Failed to add remark');
                          } finally {
                            setRemarkSubmitting(false);
                          }
                        }}
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Add Remark
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Merged timeline — calls + remarks sorted by date desc */}
              {(() => {
                type TimelineItem =
                  | { kind: 'call'; id: string; ts: string; call: ApiCall }
                  | { kind: 'remark'; id: string; ts: string; remark: ApiRemark };
                const items: TimelineItem[] = [
                  ...clientCalls.map<TimelineItem>((c) => ({ kind: 'call', id: c.id, ts: c.timestamp, call: c })),
                  ...remarks.map<TimelineItem>((r) => ({ kind: 'remark', id: r.id, ts: r.createdAt, remark: r })),
                ].sort((a, b) => {
                  const aPinned = a.kind === 'remark' && a.remark.isPinned ? 1 : 0;
                  const bPinned = b.kind === 'remark' && b.remark.isPinned ? 1 : 0;
                  if (aPinned !== bPinned) return bPinned - aPinned;
                  return new Date(b.ts).getTime() - new Date(a.ts).getTime();
                });

                const loading = (clientCallsLoading || remarksLoading) && items.length === 0;

                if (loading) {
                  return <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>;
                }
                if (items.length === 0) {
                  return (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No calls or remarks yet</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-3">
                    {items.map((item) => {
                      const ts = new Date(item.kind === 'call' ? item.call.timestamp : item.remark.createdAt);
                      const now = Date.now();
                      const recent = now - ts.getTime() < 24 * 60 * 60 * 1000;
                      const timeLabel = recent
                        ? `${formatDistanceToNowStrict(ts)} ago`
                        : format(ts, 'MMM d, yyyy h:mm a');
                      const fullTime = format(ts, "EEE, MMM d, yyyy 'at' h:mm a");

                      const accentColor =
                        item.kind === 'remark'
                          ? 'border-l-purple-500/60'
                          : item.call.outcome === 'answered'
                            ? 'border-l-emerald-500/60'
                            : item.call.outcome === 'no_answer'
                              ? 'border-l-orange-500/60'
                              : item.call.outcome === 'voicemail'
                                ? 'border-l-blue-500/60'
                                : 'border-l-muted-foreground/30';

                      return item.kind === 'call' ? (
                        <div
                          key={`call-${item.id}`}
                          className={`group rounded-lg border bg-card border-l-[3px] ${accentColor} px-5 py-4 transition-all hover:shadow-md hover:border-foreground/10`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <div
                                className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center ${
                                  item.call.outcome === 'answered'
                                    ? 'bg-emerald-500/10 text-emerald-600'
                                    : item.call.outcome === 'no_answer'
                                      ? 'bg-orange-500/10 text-orange-600'
                                      : item.call.outcome === 'voicemail'
                                        ? 'bg-blue-500/10 text-blue-600'
                                        : 'bg-muted text-muted-foreground'
                                }`}
                              >
                                {item.call.outcome === 'answered' ? (
                                  <ThumbsUp className="h-4 w-4" />
                                ) : item.call.outcome === 'no_answer' ? (
                                  <ThumbsDown className="h-4 w-4" />
                                ) : (
                                  <PhoneCall className="h-4 w-4" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold truncate">{item.call.ownerName}</p>
                                  <span className="text-xs text-muted-foreground/70">·</span>
                                  <p className="text-xs text-muted-foreground" title={fullTime}>{timeLabel}</p>
                                </div>
                                {item.call.notes && (
                                  <p className="text-sm text-foreground/80 mt-1.5 whitespace-pre-wrap leading-relaxed">
                                    {item.call.notes}
                                  </p>
                                )}
                                {item.call.recordingUrl && (
                                  <div className="mt-2">
                                    <CallRecordingPlayer
                                      callId={item.call.id}
                                      fallbackDuration={item.call.duration ?? undefined}
                                      isActive={activeRecordingCallId === item.call.id}
                                      onPlay={setActiveRecordingCallId}
                                    />
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-start gap-2 shrink-0">
                              <div className="flex flex-col items-end gap-1 w-[140px]">
                                <Badge
                                  variant="secondary"
                                  className={`w-full justify-center text-xs gap-1 font-medium border-transparent ${
                                    item.call.outcome === 'answered'
                                      ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15'
                                      : item.call.outcome === 'no_answer'
                                        ? 'bg-orange-500/10 text-orange-700 hover:bg-orange-500/15'
                                        : item.call.outcome === 'voicemail'
                                          ? 'bg-sky-500/10 text-sky-700 hover:bg-sky-500/15'
                                          : 'bg-zinc-500/10 text-zinc-700 hover:bg-zinc-500/15'
                                  }`}
                                >
                                  {item.call.outcome === 'answered'
                                    ? 'Answered'
                                    : item.call.outcome === 'no_answer'
                                      ? 'No Answer'
                                      : item.call.outcome === 'voicemail'
                                        ? 'Voicemail'
                                        : item.call.outcome === 'busy'
                                          ? 'Busy'
                                          : item.call.outcome === 'callback_requested'
                                            ? 'Callback'
                                            : item.call.outcome}
                                </Badge>
                                {item.call.duration != null && item.call.duration > 0 && (
                                  <span className="inline-flex w-full justify-center items-center text-xs text-muted-foreground tabular-nums">
                                    <Clock className="h-3 w-3 mr-1" />
                                    {Math.floor(item.call.duration / 60)}:
                                    {(item.call.duration % 60).toString().padStart(2, '0')}
                                  </span>
                                )}
                              </div>
                              {/* Reserved slot — matches remark card's actions column so badges align */}
                              <div className="w-24 shrink-0" aria-hidden="true" />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div
                          key={`remark-${item.id}`}
                          className={`group rounded-lg border bg-card border-l-[3px] ${accentColor} px-5 py-4 transition-all hover:shadow-md hover:border-foreground/10 ${item.remark.isPinned ? 'ring-1 ring-primary/30 bg-primary/[0.03]' : ''}`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 min-w-0 flex-1">
                              <div className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center bg-purple-500/10 text-purple-600">
                                <MessageSquare className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold truncate">{item.remark.authorName}</p>
                                  <span className="text-xs text-muted-foreground/70">·</span>
                                  <p className="text-xs text-muted-foreground" title={fullTime}>{timeLabel}</p>
                                  {item.remark.isPinned && (
                                    <Badge variant="secondary" className="text-xs gap-1">
                                      <Pin className="h-3 w-3" />
                                      Pinned
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-foreground/80 mt-1.5 whitespace-pre-wrap leading-relaxed">
                                  {item.remark.content}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-start gap-2 shrink-0">
                              <div className="flex flex-col items-end gap-1 w-[140px]">
                                {item.remark.visibility === 'only_me' ? (
                                  <Badge variant="secondary" className="w-full justify-center text-xs gap-1 font-medium border-transparent bg-red-500/10 text-red-700 hover:bg-red-500/15">
                                    <Eye className="h-3 w-3" />
                                    Private
                                  </Badge>
                                ) : item.remark.visibility === 'shared' ? (
                                  <Badge variant="secondary" className="w-full justify-center text-xs gap-1 font-medium border-transparent bg-purple-500/10 text-purple-700 hover:bg-purple-500/15">
                                    <Users className="h-3 w-3" />
                                    Shared · {item.remark.sharedWith.length}
                                  </Badge>
                                ) : item.remark.scope === 'global' ? (
                                  <Badge variant="secondary" className="w-full justify-center text-xs gap-1 font-medium border-transparent bg-blue-500/10 text-blue-700 hover:bg-blue-500/15">
                                    <Globe className="h-3 w-3" />
                                    Public · Global
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="w-full justify-center text-xs gap-1 font-medium border-transparent bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/15">
                                    <Building2 className="h-3 w-3" />
                                    Public · Agency
                                  </Badge>
                                )}
                              </div>
                              {/* Actions slot — pin (visible to author or same-agency managers) + delete (author-only) */}
                              <div className="w-24 shrink-0 flex items-start justify-end gap-1">
                                {(item.remark.authorId === effectiveSelfId || isManager) && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`h-7 px-2 ${item.remark.isPinned ? 'text-primary' : 'text-muted-foreground'}`}
                                    onClick={async () => {
                                      const remarkId = item.remark.id;
                                      const next = !item.remark.isPinned;
                                      setRemarks((prev) => prev.map((r) => (r.id === remarkId ? { ...r, isPinned: next } : r)));
                                      try {
                                        await setRemarkPin(remarkId, next);
                                      } catch {
                                        setRemarks((prev) => prev.map((r) => (r.id === remarkId ? { ...r, isPinned: !next } : r)));
                                        toast.error('Failed to update pin');
                                      }
                                    }}
                                  >
                                    <Pin className="h-3 w-3 mr-1" />
                                    {item.remark.isPinned ? 'Unpin' : 'Pin'}
                                  </Button>
                                )}
                                {item.remark.authorId === effectiveSelfId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Delete"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={async () => {
                                      try {
                                        await deleteRemark(item.remark.id);
                                        setRemarks((prev) => prev.filter((r) => r.id !== item.remark.id));
                                      } catch {
                                        toast.error('Failed to delete remark');
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </TabsContent>

            {/* Follow-ups Tab */}
            <TabsContent value="followups" className="space-y-4 mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Follow-up History
                </h3>
              </div>

              {followUpsLoading && clientFollowUps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Loading follow-ups...</p>
              ) : (() => {
                const sorted = clientFollowUps
                  .slice()
                  .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());

                return sorted.length > 0 ? (
                  <div className="space-y-3">
                    {sorted.map((followUp) => {
                      const contact = client.contacts.find(c => c.id === followUp.contactId);
                      const isOverdue = !followUp.completed && new Date(followUp.dueDate) < new Date();

                      return (
                        <Card key={followUp.id} className="border-none shadow-sm">
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                                  followUp.completed ? 'bg-green-500/10 text-green-600' :
                                  isOverdue ? 'bg-red-500/10 text-red-600' :
                                  'bg-blue-500/10 text-blue-600'
                                }`}>
                                  {followUp.completed ? <CheckCircle className="h-4 w-4" /> :
                                   isOverdue ? <Calendar className="h-4 w-4" /> :
                                   <CalendarClock className="h-4 w-4" />}
                                </div>
                                <div>
                                  <p className="text-sm font-medium">{followUp.ownerName}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(followUp.dueDate), 'MMM d, yyyy h:mm a')}
                                  </p>
                                </div>
                              </div>
                              <Badge
                                variant="secondary"
                                className={`text-xs ${
                                  followUp.completed ? 'bg-green-500/10 text-green-600' :
                                  isOverdue ? 'bg-red-500/10 text-red-600' :
                                  'bg-blue-500/10 text-blue-600'
                                }`}
                              >
                                {followUp.completed ? 'Completed' :
                                 isOverdue ? 'Overdue' : 'Pending'}
                              </Badge>
                            </div>
                            {contact && (
                              <p className="text-xs text-muted-foreground mb-2 pl-10">
                                Contact: {contact.name}
                              </p>
                            )}
                            {followUp.notes && (
                              <p className="text-sm text-muted-foreground pl-10">
                                {followUp.notes}
                              </p>
                            )}
                            {followUp.comments && followUp.comments.length > 0 && (
                              <div className="mt-3 pl-10 space-y-2">
                                <p className="text-xs font-medium text-muted-foreground uppercase">Comments</p>
                                {followUp.comments.slice(0, 3).map((comment) => (
                                  <div key={comment.id} className="text-xs bg-muted/50 rounded p-2">
                                    <span className="font-medium">{comment.userName}: </span>
                                    <span className="text-muted-foreground">{comment.content}</span>
                                    <span className="text-muted-foreground ml-2 text-[10px]">
                                      {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                                    </span>
                                  </div>
                                ))}
                                {followUp.comments.length > 3 && (
                                  <p className="text-xs text-muted-foreground">
                                    +{followUp.comments.length - 3} more comments
                                  </p>
                                )}
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-12 border-2 border-dashed rounded-lg">
                    <CalendarClock className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No follow-ups recorded yet</p>
                  </div>
                );
              })()}
            </TabsContent>

            {/* Proposals Tab */}
            <TabsContent value="proposals" className="space-y-4 mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Proposal History
                </h3>
              </div>

              {proposalsLoading && fetchedProposals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Loading proposals...</p>
              ) : fetchedProposals.length > 0 ? (
                <div className="space-y-3">
                  {fetchedProposals.map((p) => {
                    const ownerName = p.lead?.owner ? `${p.lead.owner.firstName} ${p.lead.owner.lastName}`.trim() : 'Unknown';
                    const createdByName = p.createdBy
                      ? `${p.createdBy.firstName ?? ''} ${p.createdBy.lastName ?? ''}`.trim()
                      : '';
                    const wasCreatedOnBehalf =
                      !!p.createdBy && p.createdBy.id !== p.lead?.owner?.id && createdByName.length > 0;
                    const submittedLabel = wasCreatedOnBehalf
                      ? `Submitted by ${createdByName} on behalf of ${ownerName}`
                      : `Submitted by ${ownerName}`;
                    const statusColor = p.status === 'approved' ? 'bg-green-100 text-green-800' :
                      p.status === 'rejected' ? 'bg-red-100 text-red-800' :
                      p.status === 'closed_won' || p.activatedAt ? 'bg-blue-100 text-blue-800' :
                      'bg-yellow-100 text-yellow-800';
                    const statusLabel = p.status === 'approved' ? 'Approved' :
                      p.status === 'rejected' ? 'Rejected' :
                      p.activatedAt ? 'Activated' : 'Pending';

                    const sentDocs = (p.proposalDocuments || []).filter((d: any) => d.category === 'sent_to_client');
                    const receivedDocs = (p.proposalDocuments || []).filter((d: any) => d.category === 'received_from_client');

                    // PandaDoc integration: detect if this proposal uses PandaDoc
                    const hasPandaDoc = !!p.pandaDocId;
                    const pandaDocSigned = p.pandaDocStatus === 'document.completed';
                    const pandaDocSent = hasPandaDoc && p.pandaDocStatus && p.pandaDocStatus !== 'document.draft';
                    const pandaDocStatusLabel = p.pandaDocStatus === 'document.completed' ? 'Signed'
                      : p.pandaDocStatus === 'document.sent' ? 'Sent'
                      : p.pandaDocStatus === 'document.viewed' ? 'Viewed'
                      : p.pandaDocStatus === 'document.draft' ? 'Draft'
                      : p.pandaDocStatus?.replace('document.', '') ?? '';

                    // Total docs = manual docs + pandadoc entries
                    const totalDocs = sentDocs.length + receivedDocs.length
                      + (pandaDocSent ? 1 : 0)
                      + (pandaDocSigned ? 1 : 0);
                    const docsExpanded = expandedProposalDocs.has(p.id);

                    // Build timeline events
                    const timelineEvents: { date: string; label: string; color: string }[] = [];
                    timelineEvents.push({ date: p.createdAt, label: submittedLabel, color: 'bg-blue-500' });
                    if (p.reviewedAt && p.reviewedBy) {
                      const reviewerName = `${p.reviewedBy.firstName} ${p.reviewedBy.lastName}`.trim();
                      if (p.status === 'approved' || p.status === 'closed_won' || p.activatedAt) {
                        timelineEvents.push({ date: p.reviewedAt, label: `Approved by ${reviewerName}`, color: 'bg-green-500' });
                      } else if (p.status === 'rejected') {
                        timelineEvents.push({ date: p.reviewedAt, label: `Rejected by ${reviewerName}`, color: 'bg-red-500' });
                      }
                    }
                    // PandaDoc sent event (from pandaDocUpdatedAt when status = sent)
                    if (pandaDocSent && p.pandaDocUpdatedAt) {
                      const toContact = p.selectedContact?.name ? ` to ${p.selectedContact.name}` : '';
                      timelineEvents.push({ date: p.pandaDocUpdatedAt, label: `Agreement sent via PandaDoc${toContact}`, color: 'bg-purple-500' });
                    }
                    if (sentDocs.length > 0) {
                      const firstSent = sentDocs[sentDocs.length - 1];
                      const toContact = firstSent.contactName ? ` to ${firstSent.contactName}` : '';
                      timelineEvents.push({ date: firstSent.createdAt, label: `Agreement sent to client${toContact}`, color: 'bg-purple-500' });
                    }
                    if (pandaDocSigned && p.pandaDocUpdatedAt) {
                      timelineEvents.push({ date: p.pandaDocUpdatedAt, label: 'Agreement signed by client (PandaDoc)', color: 'bg-teal-500' });
                    }
                    if (receivedDocs.length > 0) {
                      const firstReceived = receivedDocs[receivedDocs.length - 1];
                      timelineEvents.push({ date: firstReceived.createdAt, label: 'Signed document received from client', color: 'bg-teal-500' });
                    }
                    if (p.reviewRequestedAt && p.reviewRequestedBy) {
                      const requesterName = `${p.reviewRequestedBy.firstName} ${p.reviewRequestedBy.lastName}`.trim();
                      timelineEvents.push({ date: p.reviewRequestedAt, label: `Review submitted by ${requesterName}`, color: 'bg-orange-500' });
                    }
                    if (p.reviewRejectedAt && p.reviewRejectedBy) {
                      const rejectorName = `${p.reviewRejectedBy.firstName} ${p.reviewRejectedBy.lastName}`.trim();
                      timelineEvents.push({ date: p.reviewRejectedAt, label: `Review rejected by ${rejectorName}`, color: 'bg-red-400' });
                    }
                    if (p.activatedAt && p.activatedBy) {
                      const activatorName = `${p.activatedBy.firstName} ${p.activatedBy.lastName}`.trim();
                      timelineEvents.push({ date: p.activatedAt, label: `Lead activated by ${activatorName}`, color: 'bg-blue-600' });
                    }
                    timelineEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                    const formatFileSize = (bytes: number) => {
                      if (bytes < 1024) return `${bytes} B`;
                      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
                      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                    };

                    return (
                      <Card key={p.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                <Briefcase className="h-5 w-5 text-primary" />
                              </div>
                              <div>
                                <p className="font-medium">
                                  {(p.agreementTypes || []).map((t: string) => getAgreementTypeLabel(t as AgreementType)).join(' + ')}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {wasCreatedOnBehalf ? (
                                    <>Submitted by <span className="font-medium">{createdByName}</span> on behalf of {ownerName}</>
                                  ) : (
                                    <>Submitted by {ownerName}</>
                                  )} • {format(new Date(p.createdAt), "MMM d, yyyy 'at' h:mm a")}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {p.isForReview && (
                                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                                  For Review
                                </Badge>
                              )}
                              <Badge className={statusColor}>
                                {statusLabel}
                              </Badge>
                            </div>
                          </div>

                          {/* Pricing & Payment */}
                          <div className="grid grid-cols-2 gap-4 mb-3">
                            {p.tempPricingType && p.tempPricingValue != null && (
                              <div className="flex items-center gap-2 text-sm">
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                                <span>Temp: {getPricingLabel(p.tempPricingType as PricingType, Number(p.tempPricingValue))}</span>
                              </div>
                            )}
                            {p.directPricingType && p.directPricingValue != null && (
                              <div className="flex items-center gap-2 text-sm">
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                                <span>Direct: {getPricingLabel(p.directPricingType as PricingType, Number(p.directPricingValue))}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-2 text-sm">
                              <Clock className="h-4 w-4 text-muted-foreground" />
                              <span>{getPaymentTermsLabel(p.paymentTerms as PaymentTerms)}</span>
                            </div>
                            {p.attachments?.length > 0 && (
                              <div className="flex items-center gap-2 text-sm">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                <span>{p.attachments.length} attachment{p.attachments.length > 1 ? 's' : ''}</span>
                              </div>
                            )}
                          </div>

                          {p.comment && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                              {p.comment}
                            </p>
                          )}

                          {p.status === 'rejected' && p.rejectionComment && (
                            <div className="bg-red-50 border border-red-200 rounded p-2 mb-3">
                              <p className="text-xs font-medium text-red-700">Rejection reason:</p>
                              <p className="text-sm text-red-600">{p.rejectionComment}</p>
                            </div>
                          )}

                          {/* Timeline */}
                          {timelineEvents.length > 1 && (
                            <div className="mt-3 pt-3 border-t">
                              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Timeline</p>
                              <div className="space-y-1.5">
                                {timelineEvents.map((ev, i) => (
                                  <div key={i} className="flex items-start gap-2">
                                    <div className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${ev.color}`} />
                                    <div className="flex-1 flex items-baseline justify-between gap-2">
                                      <span className="text-xs text-foreground">{ev.label}</span>
                                      <span className="text-xs text-muted-foreground whitespace-nowrap">{format(new Date(ev.date), "MMM d, yyyy 'at' h:mm a")}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Documents toggle */}
                          {totalDocs > 0 && (
                            <div className="mt-3 pt-3 border-t">
                              <button
                                onClick={() => setExpandedProposalDocs(prev => {
                                  const next = new Set(prev);
                                  if (next.has(p.id)) next.delete(p.id); else next.add(p.id);
                                  return next;
                                })}
                                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                              >
                                {docsExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                Documents ({totalDocs})
                              </button>

                              {docsExpanded && (
                                <div className="mt-2 space-y-3">
                                  {/* Sent to Client — PandaDoc agreement */}
                                  {(pandaDocSent || sentDocs.length > 0) && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                                        <Send className="h-3 w-3" /> Sent to Client
                                      </p>
                                      <div className="space-y-1.5 pl-4">
                                        {/* PandaDoc agreement row */}
                                        {pandaDocSent && (
                                          <div className="flex items-center justify-between gap-2 bg-blue-50 border border-blue-100 rounded px-2 py-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <FileText className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />
                                              <div className="min-w-0">
                                                <p className="text-xs font-medium truncate">
                                                  Agreement (PandaDoc)
                                                  <span className="ml-1.5 text-[10px] font-normal text-blue-600 bg-blue-100 px-1 rounded">
                                                    {pandaDocStatusLabel}
                                                  </span>
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                  {p.selectedContact?.name && `To ${p.selectedContact.name}`}
                                                  {p.pandaDocUpdatedAt && ` · ${format(new Date(p.pandaDocUpdatedAt), 'MMM d, yyyy')}`}
                                                </p>
                                              </div>
                                            </div>
                                            <a
                                              href={getProposalPandaDocPdfUrl(p.id)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex-shrink-0 text-xs text-primary hover:underline flex items-center gap-1"
                                            >
                                              <Eye className="h-3 w-3" /> View
                                            </a>
                                          </div>
                                        )}
                                        {/* Manual sent docs */}
                                        {sentDocs.map((doc: any) => (
                                          <div key={doc.id} className="flex items-center justify-between gap-2 bg-muted/40 rounded px-2 py-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                              <div className="min-w-0">
                                                <p className="text-xs font-medium truncate">{doc.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                  {formatFileSize(Number(doc.size))}
                                                  {doc.contactName && ` · To ${doc.contactName}`}
                                                  {doc.sentAt && ` · ${format(new Date(doc.sentAt), 'MMM d, yyyy')}`}
                                                </p>
                                              </div>
                                            </div>
                                            <a
                                              href={getProposalDocPreviewUrl(doc.id)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex-shrink-0 text-xs text-primary hover:underline flex items-center gap-1"
                                            >
                                              <Eye className="h-3 w-3" /> View
                                            </a>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {/* Received from Client (Signed) */}
                                  {(pandaDocSigned || receivedDocs.length > 0) && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1">
                                        <Download className="h-3 w-3" /> Received from Client (Signed)
                                      </p>
                                      <div className="space-y-1.5 pl-4">
                                        {/* PandaDoc signed row */}
                                        {pandaDocSigned && (
                                          <div className="flex items-center justify-between gap-2 bg-green-50 border border-green-100 rounded px-2 py-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <CheckCircle className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                                              <div className="min-w-0">
                                                <p className="text-xs font-medium truncate">
                                                  Signed Agreement (PandaDoc)
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                  {p.selectedContact?.name && `Signed by ${p.selectedContact.name}`}
                                                  {p.pandaDocUpdatedAt && ` · ${format(new Date(p.pandaDocUpdatedAt), 'MMM d, yyyy')}`}
                                                </p>
                                              </div>
                                            </div>
                                            <a
                                              href={getProposalPandaDocPdfUrl(p.id)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex-shrink-0 text-xs text-primary hover:underline flex items-center gap-1"
                                            >
                                              <Eye className="h-3 w-3" /> View
                                            </a>
                                          </div>
                                        )}
                                        {/* Manual received docs */}
                                        {receivedDocs.map((doc: any) => (
                                          <div key={doc.id} className="flex items-center justify-between gap-2 bg-green-50 border border-green-100 rounded px-2 py-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <CheckCircle className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                                              <div className="min-w-0">
                                                <p className="text-xs font-medium truncate">{doc.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                  {formatFileSize(Number(doc.size))}
                                                  {doc.uploadedBy && ` · By ${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`.trim()}
                                                  {` · ${format(new Date(doc.createdAt), 'MMM d, yyyy')}`}
                                                </p>
                                              </div>
                                            </div>
                                            <a
                                              href={getProposalDocPreviewUrl(doc.id)}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex-shrink-0 text-xs text-primary hover:underline flex items-center gap-1"
                                            >
                                              <Eye className="h-3 w-3" /> View
                                            </a>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                  <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No proposals submitted yet</p>
                </div>
              )}
            </TabsContent>

            {/* Lead History Tab */}
            <TabsContent value="leadHistory" className="space-y-4 mt-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Lead Attempt History
              </h3>
              {leadHistoryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : leadHistory.length > 0 ? (
                <div className="space-y-3">
                  {leadHistory.map((entry, index) => {
                    const ownerName = entry.owner
                      ? `${entry.owner.firstName ?? ''} ${entry.owner.lastName ?? ''}`.trim() || entry.owner.email
                      : 'Unknown';
                    const closedByName = entry.closedBy
                      ? `${entry.closedBy.firstName ?? ''} ${entry.closedBy.lastName ?? ''}`.trim() || entry.closedBy.email
                      : null;
                    const attemptNumber = leadHistory.length - index;
                    const isOpen = entry.status === 'open';
                    const isClosedLost = entry.status === 'closed_lost';
                    const isClosedWon = entry.status === 'closed_won';
                    const isClosedWonPending = entry.status === 'closed_won_pending';
                    const isReassigned = !!entry.reassignedFromLeadId;

                    return (
                      <Card key={entry.id} className={`border-l-4 ${isOpen ? 'border-l-green-400' : (isClosedWon || isClosedWonPending) ? 'border-l-blue-400' : isClosedLost ? 'border-l-red-400' : 'border-l-gray-300'}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">Attempt {attemptNumber}</span>
                              <Badge
                                variant="outline"
                                className={
                                  isOpen
                                    ? 'border-green-400 bg-green-50 text-green-700'
                                    : isClosedWon
                                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                                      : isClosedLost
                                        ? 'border-red-400 bg-red-50 text-red-700'
                                        : ''
                                }
                              >
                                {isOpen ? 'Open' : isClosedWon ? 'Won' : isClosedLost ? 'Lost' : entry.status}
                              </Badge>
                              {isReassigned && (
                                <Badge variant="secondary" className="text-xs">
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Reassigned
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(entry.createdAt), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <div className="space-y-1 text-sm">
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <UserPlus className="h-3 w-3" />
                              <span>Assigned to: <span className="text-foreground font-medium">{ownerName}</span></span>
                            </div>
                            {isClosedLost && closedByName && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <X className="h-3 w-3" />
                                <span>Lost by: <span className="text-foreground font-medium">{closedByName}</span></span>
                              </div>
                            )}
                            {isClosedLost && entry.closedAt && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                <span>Closed: {format(new Date(entry.closedAt), 'MMM d, yyyy')}</span>
                              </div>
                            )}
                            {isClosedWon && entry.closedAt && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <CheckCircle className="h-3 w-3" />
                                <span>Won: {format(new Date(entry.closedAt), 'MMM d, yyyy')}</span>
                              </div>
                            )}
                            {isClosedWon && entry.wonBy && (() => {
                              const wonByName = `${entry.wonBy.firstName ?? ''} ${entry.wonBy.lastName ?? ''}`.trim() || entry.wonBy.email;
                              return (
                                <div className="flex items-center gap-1 text-muted-foreground">
                                  <Trophy className="h-3 w-3" />
                                  <span>Won by: <span className="text-foreground font-medium">{wonByName}</span></span>
                                </div>
                              );
                            })()}
                            {entry.lossReason && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <MessageSquare className="h-3 w-3" />
                                <span>Reason: {entry.lossReason}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-1 text-muted-foreground">
                              <ArrowRight className="h-3 w-3" />
                              <span>Stage: {entry.stage.replace(/_/g, ' ')}</span>
                            </div>
                            {isReassigned && entry.numberOfPositions != null && (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <Briefcase className="h-3 w-3" />
                                <span>Employees: <span className="text-foreground font-medium">{entry.numberOfPositions}</span></span>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
                  <p className="text-sm text-muted-foreground">No lead history for this client</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="notes" className="space-y-5 mt-6">
              <div className="flex justify-between items-center pb-3 border-b">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Client Notes
                </h3>
              </div>

              {isGlobalCreator && (
                <p className="text-xs text-muted-foreground -mt-2">
                  {allAgenciesView
                    ? 'Showing merged activity from all agencies you can access.'
                    : 'Your notes and activity are visible in every agency for this client.'}
                </p>
              )}

              {canWriteNotes && (
                <Card className="overflow-hidden border shadow-sm bg-gradient-to-b from-muted/30 to-card">
                  <CardContent className="p-5 space-y-5">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
                        <StickyNote className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="text-base font-semibold tracking-tight">New note</h4>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Fill any field below. Each value saves as its own entry; empty fields are skipped.
                        </p>
                      </div>
                      {noteFields.length > 0 && !noteFieldsLoading && (
                        <Badge variant="secondary" className="shrink-0 font-normal">
                          {noteFields.length} {noteFields.length === 1 ? 'field' : 'fields'}
                        </Badge>
                      )}
                    </div>
                    {noteFieldsLoading ? (
                      <div className="flex justify-center py-10">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : noteFields.length === 0 ? (
                      <div className="text-center py-10 border border-dashed rounded-xl bg-background/60">
                        <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-muted mb-3">
                          <StickyNote className="h-5 w-5 text-muted-foreground/60" />
                        </div>
                        <p className="text-sm font-medium">No fields configured yet</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ask an admin to add fields in Settings → Client Notes.
                        </p>
                      </div>
                    ) : (
                      <section className="grid gap-3 sm:grid-cols-2">
                        {noteFields.map((def) => {
                          const value = draftValues[def.id];
                          const setValue = (v: unknown) =>
                            setDraftValues((prev) => ({ ...prev, [def.id]: v }));
                          const inputId = `note-fld-${def.id}`;
                          const isFilled = formatNoteContent(def, value) !== null;
                          return (
                            <div
                              key={def.id}
                              className={cn(
                                'rounded-xl border bg-background/80 px-4 py-3.5 space-y-2.5 transition-all',
                                isFilled && 'border-primary/30 bg-primary/[0.03] ring-1 ring-primary/10',
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <Label htmlFor={inputId} className="text-sm font-medium">
                                  {def.label}
                                </Label>
                                {isFilled && (
                                  <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
                                )}
                              </div>
                              {def.fieldType === 'text' && (
                                <Input
                                  id={inputId}
                                  value={typeof value === 'string' ? value : ''}
                                  onChange={(e) => setValue(e.target.value)}
                                  placeholder={`Enter ${def.label.toLowerCase()}`}
                                  className="bg-background"
                                />
                              )}
                              {def.fieldType === 'textarea' && (
                                <Textarea
                                  id={inputId}
                                  value={typeof value === 'string' ? value : ''}
                                  onChange={(e) => setValue(e.target.value)}
                                  className="min-h-[72px] resize-y bg-background"
                                  placeholder={`Enter ${def.label.toLowerCase()}`}
                                />
                              )}
                              {def.fieldType === 'number' && (
                                <Input
                                  id={inputId}
                                  type="number"
                                  inputMode="numeric"
                                  value={value === null || value === undefined ? '' : String(value)}
                                  onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
                                  placeholder="0"
                                  className="bg-background"
                                />
                              )}
                              {def.fieldType === 'boolean' && (
                                <div
                                  className="inline-flex rounded-lg border bg-muted/40 p-1"
                                  role="group"
                                  aria-label={def.label}
                                >
                                  {([true, false] as const).map((boolVal) => {
                                    const selected = value === boolVal;
                                    return (
                                      <button
                                        key={String(boolVal)}
                                        type="button"
                                        onClick={() => setValue(selected ? undefined : boolVal)}
                                        className={cn(
                                          'px-4 py-1.5 text-sm font-medium rounded-md transition-all min-w-[4.5rem]',
                                          selected
                                            ? boolVal
                                              ? 'bg-emerald-500/15 text-emerald-700 shadow-sm'
                                              : 'bg-rose-500/10 text-rose-700 shadow-sm'
                                            : 'text-muted-foreground hover:text-foreground',
                                        )}
                                      >
                                        {boolVal ? 'Yes' : 'No'}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              {def.fieldType === 'select' && (
                                <Select
                                  value={typeof value === 'string' ? value : ''}
                                  onValueChange={(v) => setValue(v)}
                                >
                                  <SelectTrigger id={inputId} className="bg-background">
                                    <SelectValue placeholder="Choose…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(def.options ?? []).map((opt) => (
                                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })}
                      </section>
                    )}
                    {noteFields.length > 0 && noteFields.some((f) => formatNoteContent(f, draftValues[f.id]) !== null) && (
                      <section className="rounded-xl border bg-muted/20 p-4 space-y-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Who can see this
                        </p>
                        <VisibilityPicker
                          idPrefix="note-add"
                          visibility={noteVisibility}
                          sharedWith={noteSharedWith}
                          onVisibilityChange={setNoteVisibility}
                          onSharedWithChange={setNoteSharedWith}
                          canPostPublic={isManager || isGlobalCreator}
                          canPostGlobal={canPostAcrossAgencies}
                          shareableUsers={shareableUsers}
                          onRequestShareableUsers={loadShareableUsers}
                          compact
                          hideLabel
                        />
                      </section>
                    )}
                    {noteFields.length > 0 && (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-4 border-t">
                        {(() => {
                          const filledCount = noteFields.reduce(
                            (n, f) => n + (formatNoteContent(f, draftValues[f.id]) !== null ? 1 : 0),
                            0,
                          );
                          return (
                            <p className="text-xs text-muted-foreground">
                              {filledCount === 0
                                ? 'Fill at least one field to continue.'
                                : filledCount === 1
                                  ? '1 field ready · saves as 1 note'
                                  : `${filledCount} fields ready · combined into 1 note`}
                            </p>
                          );
                        })()}
                        <div className="flex items-center gap-2 sm:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={resetAddNoteForm}
                            disabled={addingNote}
                          >
                            Clear
                          </Button>
                          <Button
                            size="sm"
                            className="shadow-sm"
                            onClick={async () => {
                              if (!client?.id) return;
                              const formattedFields = noteFields
                                .map((def) => formatNoteContent(def, draftValues[def.id]))
                                .filter((f): f is string => f !== null);
                              if (formattedFields.length === 0) return;
                              if (noteVisibility === 'shared' && noteSharedWith.length === 0) {
                                toast.error('Select at least one user to share with');
                                return;
                              }
                              const combined = formattedFields.join('\n\n');
                              setAddingNote(true);
                              try {
                                await addClientNoteApi(
                                  client.id,
                                  {
                                    content: combined,
                                    visibility: noteVisibility,
                                    ...(noteVisibility === 'shared' ? { sharedWith: noteSharedWith } : {}),
                                  },
                                  clientActionOpts,
                                );
                                addClientNote(client.id, combined, noteVisibility === 'public', effectiveAuthor);
                                resetAddNoteForm();
                                toast.success('Note added');
                              } catch {
                                toast.error('Failed to add note');
                              } finally {
                                try {
                                  const c = await fetchClient(client.id, clientDetailOpts);
                                  if (c) onClientUpdated?.(mapFetchedClientToClient(c));
                                } catch {
                                  /* silent — toast already covers user-facing state */
                                }
                                setAddingNote(false);
                              }
                            }}
                            disabled={
                              addingNote
                              || !noteFields.some((f) => formatNoteContent(f, draftValues[f.id]) !== null)
                              || (noteVisibility === 'shared' && noteSharedWith.length === 0)
                            }
                          >
                            {addingNote ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                            Add Note
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Edit Note Dialog — author-only */}
              <Dialog open={editNoteId !== null} onOpenChange={(open) => !editingNote && !open && setEditNoteId(null)}>
                <DialogContent className="max-w-xl sm:max-w-xl">
                  <DialogHeader className="space-y-2">
                    <DialogTitle className="text-xl font-semibold flex items-center gap-2">
                      <Pencil className="h-5 w-5 text-primary" />
                      Edit note
                    </DialogTitle>
                    <DialogDescription className="text-sm">
                      Update the note content or change who can see it.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-5 pt-2">
                    {noteFieldsLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : editNotePickedFieldId || noteFields.length > 0 ? (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="edit-note-field-picker">Field</Label>
                          <Select
                            value={editNotePickedFieldId}
                            onValueChange={(v) => {
                              setEditNotePickedFieldId(v);
                              const def = noteFields.find((f) => f.id === v);
                              setEditNoteDraftValue(def?.fieldType === 'boolean' ? null : '');
                            }}
                          >
                            <SelectTrigger id="edit-note-field-picker">
                              <SelectValue placeholder="Choose a field…" />
                            </SelectTrigger>
                            <SelectContent>
                              {noteFields.map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        {(() => {
                          const def = noteFields.find((f) => f.id === editNotePickedFieldId);
                          if (!def) return null;
                          return (
                            <div className="space-y-2">
                              <Label htmlFor="edit-note-field-value" className="text-sm font-medium">{def.label}</Label>
                              {def.fieldType === 'text' && (
                                <Input
                                  id="edit-note-field-value"
                                  value={typeof editNoteDraftValue === 'string' ? editNoteDraftValue : ''}
                                  onChange={(e) => setEditNoteDraftValue(e.target.value)}
                                />
                              )}
                              {def.fieldType === 'textarea' && (
                                <Textarea
                                  id="edit-note-field-value"
                                  value={typeof editNoteDraftValue === 'string' ? editNoteDraftValue : ''}
                                  onChange={(e) => setEditNoteDraftValue(e.target.value)}
                                  className="min-h-[120px]"
                                />
                              )}
                              {def.fieldType === 'number' && (
                                <Input
                                  id="edit-note-field-value"
                                  type="number"
                                  inputMode="numeric"
                                  value={editNoteDraftValue === null || editNoteDraftValue === undefined ? '' : String(editNoteDraftValue)}
                                  onChange={(e) => setEditNoteDraftValue(e.target.value === '' ? '' : Number(e.target.value))}
                                />
                              )}
                              {def.fieldType === 'boolean' && (
                                <RadioGroup
                                  value={editNoteDraftValue === true ? 'true' : editNoteDraftValue === false ? 'false' : ''}
                                  onValueChange={(v) => setEditNoteDraftValue(v === 'true')}
                                  className="flex gap-4"
                                  aria-label={def.label}
                                >
                                  <div className="flex items-center gap-2">
                                    <RadioGroupItem id="edit-note-fld-yes" value="true" />
                                    <Label htmlFor="edit-note-fld-yes" className="text-sm cursor-pointer">Yes</Label>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <RadioGroupItem id="edit-note-fld-no" value="false" />
                                    <Label htmlFor="edit-note-fld-no" className="text-sm cursor-pointer">No</Label>
                                  </div>
                                </RadioGroup>
                              )}
                              {def.fieldType === 'select' && (
                                <Select
                                  value={typeof editNoteDraftValue === 'string' ? editNoteDraftValue : ''}
                                  onValueChange={(v) => setEditNoteDraftValue(v)}
                                >
                                  <SelectTrigger id="edit-note-field-value">
                                    <SelectValue placeholder="Choose…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(def.options ?? []).map((opt) => (
                                      <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })()}

                        {/* Legacy fallback — if the note didn't match any field, let user edit raw content. */}
                        {!editNotePickedFieldId && (
                          <div className="space-y-2">
                            <Label htmlFor="edit-note-content">Content</Label>
                            <Textarea
                              id="edit-note-content"
                              value={editNoteContent}
                              onChange={(e) => setEditNoteContent(e.target.value)}
                              className="min-h-[120px]"
                            />
                            <p className="text-xs text-muted-foreground">
                              This note wasn&apos;t tied to a custom field. Pick a field above to reformat it, or edit the text directly.
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="edit-note-content">Content</Label>
                        <Textarea
                          id="edit-note-content"
                          value={editNoteContent}
                          onChange={(e) => setEditNoteContent(e.target.value)}
                          className="min-h-[140px]"
                          autoFocus
                        />
                      </div>
                    )}

                    <div className="border-t pt-3">
                      <VisibilityPicker
                        idPrefix="note-edit"
                        visibility={editNoteVisibility}
                        sharedWith={editNoteSharedWith}
                        onVisibilityChange={setEditNoteVisibility}
                        onSharedWithChange={setEditNoteSharedWith}
                        canPostPublic={isManager || isGlobalCreator}
                        canPostGlobal={canPostAcrossAgencies}
                        shareableUsers={shareableUsers}
                        onRequestShareableUsers={loadShareableUsers}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEditNoteId(null)} disabled={editingNote}>Cancel</Button>
                    <Button
                      onClick={async () => {
                        if (!editNoteId) return;
                        // Derive content: prefer the field-picker formatted value;
                        // fall back to raw textarea for legacy notes that don't match any field.
                        let content: string | null = null;
                        const def = noteFields.find((f) => f.id === editNotePickedFieldId);
                        if (def) {
                          content = formatNoteContent(def, editNoteDraftValue);
                          if (!content) {
                            toast.error('Please fill in a value');
                            return;
                          }
                        } else {
                          if (!editNoteContent.trim()) {
                            toast.error('Content cannot be empty');
                            return;
                          }
                          content = editNoteContent.trim();
                        }
                        if (editNoteVisibility === 'shared' && editNoteSharedWith.length === 0) {
                          toast.error('Select at least one user to share with');
                          return;
                        }
                        setEditingNote(true);
                        try {
                          await editClientNote(
                            client.id,
                            editNoteId,
                            {
                              content,
                              visibility: editNoteVisibility,
                              ...(editNoteVisibility === 'shared' ? { sharedWith: editNoteSharedWith } : {}),
                            },
                            clientActionOpts,
                          );
                          toast.success('Note updated');
                          setEditNoteId(null);
                          const c = await fetchClient(client.id, clientDetailOpts);
                          if (c) onClientUpdated?.(mapFetchedClientToClient(c));
                        } catch {
                          toast.error('Failed to update note');
                        } finally {
                          setEditingNote(false);
                        }
                      }}
                      disabled={
                        editingNote ||
                        (editNotePickedFieldId
                          ? !isAddNoteValid(noteFields, editNotePickedFieldId, editNoteDraftValue)
                          : !editNoteContent.trim())
                      }
                    >
                      {editingNote && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      Save changes
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Delete Note confirm — author-only */}
              <AlertDialog open={deleteNoteId !== null} onOpenChange={(open) => !deletingNote && !open && setDeleteNoteId(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. The note will be removed from this client&apos;s feed.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={deletingNote}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={async () => {
                        if (!deleteNoteId) return;
                        setDeletingNote(true);
                        try {
                          await deleteClientNote(client.id, deleteNoteId, clientActionOpts);
                          toast.success('Note deleted');
                          setDeleteNoteId(null);
                          const c = await fetchClient(client.id, clientDetailOpts);
                          if (c) onClientUpdated?.(mapFetchedClientToClient(c));
                        } catch {
                          toast.error('Failed to delete note');
                        } finally {
                          setDeletingNote(false);
                        }
                      }}
                    >
                      {deletingNote && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {/* Notes List */}
              <div className="space-y-4">
                {(() => {
                  const storeClient = clients.find(c => c.id === client?.id);
                  // Prefer detail-loaded notes on the client prop (full data from fetchClient,
                  // survives list-query refetches that reset store notes to []).
                  // Fall back to store notes only when the prop has none — covers the brief
                  // window after addClientNote (store updated) before fetchClient completes.
                  const notesForDisplay: typeof client.notes = client?.notes?.length
                    ? client.notes
                    : (storeClient?.notes ?? client?.notes ?? []);
                  const clientLead = getClientLead(client.id);
                  const isAssignedToCurrentUser = clientLead?.ownerId === currentUser.id;

                  // Filter notes based on visibility + role.
                  // Backend already enforces the visibility rules; this is a defense-in-depth
                  // filter so the UI matches what the user can act on.
                  const visibleNotes = (notesForDisplay).filter(note => {
                    if (note.userId === effectiveSelfId) return true; // mine
                    const vis = resolveNoteVisibility(note);
                    if (vis === 'public_global') return true; // visible to everyone, every agency
                    if (vis === 'shared') {
                      return (note.sharedWith ?? []).includes(effectiveSelfId);
                    }
                    if (vis === 'public') {
                      // Managers see all public notes; associates only when assigned to them
                      if (isManager) return true;
                      return isAssignedToCurrentUser;
                    }
                    // only_me notes from others — hide (even managers)
                    return false;
                  });

                  // Sort notes: pinned manager notes first, then pinned associate notes, then by date
                  const sortedNotes = [...visibleNotes].sort((a, b) => {
                    const aIsManager = isElevatedNoteRole(a.userRole);
                    const bIsManager = isElevatedNoteRole(b.userRole);
                    
                    // Both pinned - manager pins come first
                    if (a.isPinned && b.isPinned) {
                      if (aIsManager && !bIsManager) return -1;
                      if (!aIsManager && bIsManager) return 1;
                      return b.createdAt.getTime() - a.createdAt.getTime();
                    }
                    
                    // Only one is pinned
                    if (a.isPinned && !b.isPinned) return -1;
                    if (!a.isPinned && b.isPinned) return 1;
                    
                    // Neither pinned - sort by date
                    return b.createdAt.getTime() - a.createdAt.getTime();
                  });

                  if (sortedNotes.length === 0) {
                    return (
                      <div className="text-center py-14 border border-dashed rounded-xl bg-muted/10">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted mb-3">
                          <StickyNote className="h-6 w-6 text-muted-foreground/60" />
                        </div>
                        <p className="text-sm font-medium">No notes yet</p>
                        <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                          {canWriteNotes
                            ? 'Add your first note using the form above.'
                            : 'Notes from your team will appear here.'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Recent notes
                        </h4>
                        <span className="text-xs text-muted-foreground">
                          {sortedNotes.length} {sortedNotes.length === 1 ? 'note' : 'notes'}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {sortedNotes.map((note) => {
                      const isManagerNote = isElevatedNoteRole(note.userRole);
                      const canPin = isManager || note.userId === effectiveSelfId;
                      const vis = resolveNoteVisibility(note);
                      const { label: timeLabel, full: fullTime } = formatNoteTimestamp(note.createdAt);
                      
                      const visibilityBadge = (() => {
                        if (vis === 'public_global') {
                          return (
                            <Badge variant="secondary" className="text-xs gap-1 font-medium border-transparent bg-blue-500/10 text-blue-700 hover:bg-blue-500/15">
                              <Globe className="h-3 w-3" />
                              All agencies
                            </Badge>
                          );
                        }
                        if (vis === 'public') {
                          return (
                            <Badge variant="secondary" className="text-xs gap-1 font-medium border-transparent bg-indigo-500/10 text-indigo-700 hover:bg-indigo-500/15">
                              <Building2 className="h-3 w-3" />
                              Public · Agency
                            </Badge>
                          );
                        }
                        if (vis === 'shared') {
                          const count = note.sharedWith?.length ?? 0;
                          return (
                            <Badge variant="secondary" className="text-xs gap-1 font-medium border-transparent bg-purple-500/10 text-purple-700 hover:bg-purple-500/15">
                              <Users className="h-3 w-3" />
                              Shared · {count}
                            </Badge>
                          );
                        }
                        return (
                          <Badge variant="secondary" className="text-xs gap-1 font-medium border-transparent bg-red-500/10 text-red-700 hover:bg-red-500/15">
                            <Eye className="h-3 w-3" />
                            Private
                          </Badge>
                        );
                      })();

                      // Split combined notes (joined by "\n\n") into separate lines for cleaner spacing.
                      const contentLines = note.content.split(/\n{2,}/).filter((s) => s.length > 0);

                      return (
                        <div
                          key={note.id}
                          className={cn(
                            'group rounded-xl border bg-card border-l-[3px] px-4 py-4 transition-all hover:shadow-md hover:border-foreground/10',
                            noteVisibilityAccent(vis),
                            note.isPinned && 'ring-1 ring-amber-500/25 bg-amber-500/[0.03]',
                          )}
                        >
                            <div className="flex items-start justify-between gap-3 mb-3">
                              <div className="flex items-start gap-3 min-w-0 flex-1">
                                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/15 flex items-center justify-center flex-shrink-0">
                                  <span className="text-sm font-semibold text-primary">
                                    {note.userName.charAt(0).toUpperCase()}
                                  </span>
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-semibold text-sm leading-tight">{note.userName}</span>
                                    {isManagerNote && (
                                      <Badge variant="outline" className="text-xs font-medium bg-primary/5 text-primary border-primary/20">
                                        {getRoleLabel(note.userRole, assignableRoles)}
                                      </Badge>
                                    )}
                                    {visibilityBadge}
                                    {note.isPinned && (
                                      <Badge variant="secondary" className="text-xs gap-1 font-medium bg-amber-500/10 text-amber-700 border-transparent">
                                        <Pin className="h-3 w-3" />
                                        Pinned
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-0.5" title={fullTime}>
                                    {timeLabel}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0 -mr-1 -mt-1">
                                {note.userId === effectiveSelfId && (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      title="Edit note"
                                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                                      aria-label="Edit note"
                                      onClick={async () => {
                                        setEditNoteId(note.id);
                                        setEditNoteContent(note.content);
                                        setEditNoteVisibility(vis);
                                        setEditNoteSharedWith(note.sharedWith ?? []);
                                        if (vis === 'shared') void loadShareableUsers();
                                        // Load fields (if not already) and parse the note's content
                                        // back into picker + value so the Edit dialog mirrors the Add dialog.
                                        let fieldsForParse = noteFields;
                                        if (fieldsForParse.length === 0 && client?.id) {
                                          fieldsForParse = await loadNoteFields();
                                        }
                                        const parsed = parseNoteContent(note.content, fieldsForParse);
                                        setEditNotePickedFieldId(parsed.defId ?? '');
                                        setEditNoteDraftValue(parsed.value);
                                      }}
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      title="Delete note"
                                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                      aria-label="Delete note"
                                      onClick={() => setDeleteNoteId(note.id)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                )}
                                {canPin && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                      'h-8 px-2 transition-opacity',
                                      note.isPinned ? 'text-amber-600 hover:text-amber-700 opacity-100' : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100',
                                    )}
                                    onClick={async () => {
                                      const next = !note.isPinned;
                                      toggleNotePin(client.id, note.id); // optimistic
                                      try {
                                        await setClientNotePin(client.id, note.id, next, clientActionOpts);
                                        const c = await fetchClient(client.id, clientDetailOpts);
                                        if (c) onClientUpdated?.(mapFetchedClientToClient(c));
                                      } catch {
                                        toggleNotePin(client.id, note.id); // rollback
                                        toast.error('Failed to update pin');
                                      }
                                    }}
                                  >
                                    <Pin className={cn('h-3.5 w-3.5 mr-1', note.isPinned && 'fill-amber-500')} />
                                    {note.isPinned ? 'Unpin' : 'Pin'}
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="pl-12 space-y-2">
                              {(contentLines.length > 0 ? contentLines : [note.content]).map((line, i) => {
                                // Detect "Label: value" entries (single line or "Label:\nvalue").
                                const match = line.match(/^([^:\n]{1,80}):\s*([\s\S]+)$/);
                                if (match) {
                                  const [, label, value] = match;
                                  return (
                                    <div key={i} className="rounded-lg bg-muted/35 px-3 py-2.5">
                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1">
                                        {label.trim()}
                                      </p>
                                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                                        {value.trim()}
                                      </p>
                                    </div>
                                  );
                                }
                                return (
                                  <p key={i} className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap break-words rounded-lg bg-muted/35 px-3 py-2.5">
                                    {line}
                                  </p>
                                );
                              })}
                            </div>
                        </div>
                      );
                    })}
                      </div>
                    </>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Attachments Tab */}
            <TabsContent value="attachments" className="space-y-4 mt-6">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Documents
                </h3>
                <input
                  ref={attachmentsFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.xls,.xlsx"
                  onChange={handleUploadAttachment}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingDoc}
                  onClick={() => attachmentsFileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {uploadingDoc ? 'Uploading...' : 'Upload'}
                </Button>
              </div>

              {documentsLoading ? (
                <p className="text-sm text-muted-foreground">Loading documents...</p>
              ) : clientDocuments.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-lg">
                  <File className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-4">No attachments yet</p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={uploadingDoc}
                    onClick={() => attachmentsFileInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload First Document
                  </Button>
                </div>
              ) : (
                <CrmAttachmentList
                  items={clientDocuments.map((doc) => ({
                    id: doc.id,
                    name: doc.name,
                    mimeType: inferMimeFromFilename(doc.name),
                    size: null,
                  }))}
                  fetchBlob={(item) => fetchDocumentBlob(item.id)}
                  onDownload={(item) => downloadDocument(item.id, item.name)}
                  extraActions={(item) => (
                    <button
                      type="button"
                      onClick={() => handleDeleteDocument(item.id)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                />
              )}
            </TabsContent>

            {/* Access Tab — super users manage which agency users can access this client */}
            {isSuperUser && (
              <TabsContent value="access" className="space-y-6 mt-6">
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Shield className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Client Access
                    </h3>
                  </div>
                  <p className="text-sm text-muted-foreground mb-6">
                    Choose which users in this agency can view and work with this client. Disabled users are blocked from the client list and detail.
                  </p>
                  
                  <div className="relative mb-6">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search users..."
                      value={accessSearchTerm}
                      onChange={(e) => setAccessSearchTerm(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  
                  {accessUsersLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {filteredAccessUsers.map((user) => {
                        const hasAccess = !restrictedUsers.includes(user.id);
                        const isSaving = accessMutationUserId === user.id;
                        
                        return (
                          <Card key={user.id}>
                            <CardContent className="flex items-center justify-between p-4">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                                  <span className="text-sm font-semibold text-primary">
                                    {user.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                                  </span>
                                </div>
                                <div>
                                  <p className="font-medium text-sm">{user.name}</p>
                                  <p className="text-xs text-muted-foreground">{user.email}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                <Label htmlFor={`access-${user.id}`} className="text-sm text-muted-foreground">
                                  {hasAccess ? 'Enabled' : 'Disabled'}
                                </Label>
                                <Switch
                                  id={`access-${user.id}`}
                                  checked={hasAccess}
                                  disabled={isSaving}
                                  onCheckedChange={(checked) => handleAccessToggle(user.id, checked)}
                                />
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      
                      {filteredAccessUsers.length === 0 && accessUsers.length > 0 && (
                        <div className="text-center py-12 border-2 border-dashed rounded-lg">
                          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No users found matching your search</p>
                        </div>
                      )}
                      
                      {accessUsers.length === 0 && (
                        <div className="text-center py-12 border-2 border-dashed rounded-lg">
                          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                          <p className="text-sm text-muted-foreground">No users found for this agency</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            )}
          </Tabs>
        </div>
        </div>
      </SheetContent>
    </Sheet>

      {/* Proposal Details Dialog */}
      <Dialog open={!!selectedProposal} onOpenChange={(open) => !open && setSelectedProposal(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              Proposal Details
            </DialogTitle>
          </DialogHeader>

          {selectedProposal && (
            <div className="space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge className={getStageColor(selectedProposal.lead.stage)}>
                    {getStageLabel(selectedProposal.lead.stage)}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  Owner: <span className="font-medium text-foreground">{selectedProposal.lead.ownerName}</span>
                </p>
              </div>

              {/* Agreement Types */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Agreement Type
                </h4>
                <div className="flex flex-wrap gap-2">
                  {selectedProposal.proposalData.agreementTypes.map((type) => (
                    <Badge key={type} variant="secondary">
                      {getAgreementTypeLabel(type)}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Pricing Details */}
              <div className="grid grid-cols-2 gap-4">
                {selectedProposal.proposalData.tempPricing && (
                  <Card className="border-none shadow-sm">
                    <CardContent className="p-4">
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        Temporary Staffing Pricing
                      </h5>
                      <p className="text-lg font-semibold">
                        {getPricingLabel(
                          selectedProposal.proposalData.tempPricing.pricingType,
                          selectedProposal.proposalData.tempPricing.pricingValue
                        )}
                      </p>
                      {selectedProposal.proposalData.tempPricing.minimumHours && (
                        <p className="text-sm text-muted-foreground">
                          Min. {selectedProposal.proposalData.tempPricing.minimumHours} hours
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {selectedProposal.proposalData.directPricing && (
                  <Card className="border-none shadow-sm">
                    <CardContent className="p-4">
                      <h5 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                        Direct Placement Pricing
                      </h5>
                      <p className="text-lg font-semibold">
                        {getPricingLabel(
                          selectedProposal.proposalData.directPricing.pricingType,
                          selectedProposal.proposalData.directPricing.pricingValue
                        )}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Payment Terms */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  Payment Terms
                </h4>
                <Badge variant="outline" className="text-sm">
                  {getPaymentTermsLabel(selectedProposal.proposalData.paymentTerms)}
                </Badge>
              </div>

              {/* Locations */}
              {selectedProposal.proposalData.locationType === 'multiple' && selectedProposal.proposalData.selectedClients.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Additional Locations
                  </h4>
                  <div className="space-y-2">
                    {selectedProposal.proposalData.selectedClients.map((clientId) => {
                      const additionalClient = clients.find(c => c.id === clientId);
                      return additionalClient ? (
                        <div key={clientId} className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                          <MapPin className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm">{additionalClient.name}</span>
                        </div>
                      ) : null;
                    })}
                  </div>
                </div>
              )}

              {/* Attachments */}
              {selectedProposal.proposalData.attachments.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Attachments
                  </h4>
                  <CrmAttachmentList
                    items={selectedProposal.proposalData.attachments.map((attachment) => ({
                      id: attachment.id,
                      name: attachment.name,
                      mimeType: attachment.type,
                      size: attachment.size,
                    }))}
                    fetchBlob={(item) => fetchProposalAttachmentBlob(item.id)}
                    onDownload={(item) => downloadProposalAttachment(item.id, item.name)}
                  />
                </div>
              )}

              {/* Comment */}
              {selectedProposal.proposalData.comment && (
                <div>
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Comments
                  </h4>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    {selectedProposal.proposalData.comment}
                  </p>
                </div>
              )}

              {/* Created Date */}
              <div className="pt-4 border-t">
                <p className="text-xs text-muted-foreground">
                  Proposal created on {format(new Date(selectedProposal.proposalData.createdAt), 'MMMM d, yyyy')}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AddClientDialog
        open={editClientOpen}
        onOpenChange={setEditClientOpen}
        mode="edit"
        client={client}
        subCompanyId={subCompanyId ?? viewedSubCompanyId ?? currentSubCompany?.id}
        onClientUpdated={async () => {
          if (!client?.id) return;
          const updated = await fetchClient(client.id, clientDetailOpts);
          if (updated && onClientUpdated) {
            onClientUpdated(mapFetchedClientToClient(updated));
          }
        }}
      />

      {/* Edit Contact Dialog — outside tab panels so Overview + Contacts can both open it */}
      <Dialog open={editContactOpen} onOpenChange={(open) => {
        setEditContactOpen(open);
        if (!open) {
          setEditingContactId(null);
          setEditContactTitleSelect('__none__');
          setEditContactTitleOther('');
          setEditContactTitle('');
          setEditContactName('');
          setEditContactEmail('');
          setEditContactPhone('');
          setEditContactPhoneExt('');
          setEditContactIsPrimary(false);
        }
      }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-contact-name">Name *</Label>
              <Input
                id="edit-contact-name"
                placeholder="e.g. John Doe"
                value={editContactName}
                onChange={(e) => setEditContactName(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-contact-title">Title</Label>
              <Select
                value={editContactTitleSelect}
                onValueChange={(value) => {
                  setEditContactTitleSelect(value);
                  if (value === '__other__') {
                    setEditContactTitle(editContactTitleOther);
                  } else {
                    setEditContactTitle(value === '__none__' ? '' : value);
                  }
                }}
              >
                <SelectTrigger id="edit-contact-title">
                  <SelectValue placeholder="Select job title" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select job title</SelectItem>
                  {allowedJobTitles.map((j) => (
                    <SelectItem key={j.id} value={j.name}>{j.name}</SelectItem>
                  ))}
                  <SelectItem value="__other__">Other (enter below)</SelectItem>
                </SelectContent>
              </Select>
              {editContactTitleSelect === '__other__' && (
                <Input
                  placeholder="e.g. VP Sales"
                  value={editContactTitleOther}
                  onChange={(e) => setEditContactTitleOther(e.target.value)}
                />
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-contact-email">Email</Label>
              <Input
                id="edit-contact-email"
                type="email"
                placeholder="john@company.com"
                value={editContactEmail}
                onChange={(e) => setEditContactEmail(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-contact-phone">Phone</Label>
                <Input
                  id="edit-contact-phone"
                  placeholder="+1 234 567 8900"
                  value={editContactPhone}
                  onChange={(e) => setEditContactPhone(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-contact-ext">Ext.</Label>
                <Input
                  id="edit-contact-ext"
                  placeholder="123"
                  value={editContactPhoneExt}
                  onChange={(e) => setEditContactPhoneExt(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-contact-primary"
                checked={editContactIsPrimary}
                onCheckedChange={(checked) => setEditContactIsPrimary(checked === true)}
              />
              <Label htmlFor="edit-contact-primary" className="font-normal cursor-pointer">Set as primary contact</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditContactOpen(false)}>Cancel</Button>
            <Button
              disabled={!editContactName.trim() || !editingContactId || contactMutationLoading}
              onClick={async () => {
                if (!client?.id || !editingContactId || !editContactName.trim()) return;
                setContactMutationLoading(true);
                try {
                  const titleToSend = (editContactTitleSelect === '__other__' ? editContactTitleOther : editContactTitleSelect === '__none__' ? editContactTitle : editContactTitleSelect).trim() || null;
                  const result = await updateClientContact(client.id, editingContactId, {
                    name: editContactName.trim(),
                    title: titleToSend,
                    email: editContactEmail.trim() || null,
                    phone: editContactPhone.trim() || null,
                    phoneExtension: editContactPhoneExt.trim() || null,
                    isPrimary: editContactIsPrimary,
                  }, clientActionOpts);
                  setEditContactOpen(false);
                  if (result.pendingEdit) {
                    toast.success(result.message ?? 'Contact edit submitted for approval.');
                    onPendingEditSubmitted?.();
                  } else {
                    toast.success(result.message ?? 'Contact updated');
                    await refreshClientAfterContactChange();
                  }
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Failed to update contact');
                } finally {
                  setContactMutationLoading(false);
                }
              }}
            >
              {contactMutationLoading ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
