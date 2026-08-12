import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useActivePhoneBundle } from '@/hooks/useActivePhoneBundle';
import { usePhoneSystemAgencyStore } from '@/lib/phoneSystemAgencyStore';
import { useAgencyUsers } from '@/hooks/useAgencyUsers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  Phone,
  Hash,
  Users,
  Voicemail,
  Music,
  Clock,
  Plug,
  Plus,
  Trash2,
  Pencil,
  GitBranch,
  Building2,
  Contact,
  Save,
} from 'lucide-react';
import {
  type DemoRingGroup,
  type DemoVoicemailBox,
  type DemoAudioClip,
  type AudioClipSourceType,
  type FallbackAction,
  newEntityId,
} from '@/lib/phoneSystemTypes';
import { FallbackFieldsEditor } from '@/components/phone-system/FallbackFieldsEditor';
import { StaffExtensionsTab } from '@/components/phone-system/StaffExtensionsTab';
import { CallFlowBuilderTab, type CallFlowBuilderHandle } from '@/components/phone-system/call-flow/CallFlowBuilderTab';
import { staffExtensionByUserId, resolveRingGroupMember, syncStaffExtensionNamesFromUsers, suggestNextRingGroupExtension, isRingGroupReferencedInFlow, isVoicemailBoxReferenced, parseRingGroupMenuKey } from '@/lib/phoneSystemExtensions';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import {
  testAgencyTwilioConnection,
  syncAgencyTwilioNumbers,
  saveAgencyTwilioCredentials,
  uploadPhoneAudioClip,
  fetchPhoneAudioClipStreamUrl,
} from '@/lib/phoneSystemApi';
import { migrateBundle } from '@/lib/phoneSystemAgencyBundle';

function remindSave() {
  toast.message('Unsaved changes — click Save to persist');
}

interface PhoneSystemTabProps {
  isActive?: boolean;
}

export function PhoneSystemTab({ isActive: _isActive = true }: PhoneSystemTabProps) {
  const phoneBundle = useActivePhoneBundle();
  const saving = usePhoneSystemAgencyStore((s) => s.saving);
  const loadError = usePhoneSystemAgencyStore((s) => s.loadError);
  const callFlowRef = useRef<CallFlowBuilderHandle>(null);

  const [flowSaveAction, setFlowSaveAction] = useState<'save' | 'publish' | null>(null);
  const [subTab, setSubTab] = useState('call-flow');

  const [isAddRingGroupOpen, setIsAddRingGroupOpen] = useState(false);
  const [deleteRingGroupId, setDeleteRingGroupId] = useState<string | null>(null);
  const [addMemberGroupId, setAddMemberGroupId] = useState<string | null>(null);

  const [newRingGroup, setNewRingGroup] = useState({
    extension: '',
    name: '',
    ringStrategy: 'simultaneous' as 'simultaneous' | 'sequential',
    dialTimeoutSec: 20,
  });
  const [newMember, setNewMember] = useState({ userId: '' });

  const [isVoicemailDialogOpen, setIsVoicemailDialogOpen] = useState(false);
  const [editVoicemailId, setEditVoicemailId] = useState<string | null>(null);
  const [deleteVoicemailId, setDeleteVoicemailId] = useState<string | null>(null);
  const [voicemailForm, setVoicemailForm] = useState({
    extension: '',
    name: '',
  });

  const [isAudioDialogOpen, setIsAudioDialogOpen] = useState(false);
  const [editAudioId, setEditAudioId] = useState<string | null>(null);
  const [deleteAudioId, setDeleteAudioId] = useState<string | null>(null);
  const [audioForm, setAudioForm] = useState({
    name: '',
    sourceType: 'message' as AudioClipSourceType,
    scriptText: '',
    pendingFile: null as File | null,
    r2Key: null as string | null,
    fileName: null as string | null,
    mimeType: null as string | null,
  });
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);

  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [twilioApiKeySecret, setTwilioApiKeySecret] = useState('');
  const [twilioTesting, setTwilioTesting] = useState(false);
  const [twilioSyncing, setTwilioSyncing] = useState(false);
  const [twilioSaving, setTwilioSaving] = useState(false);

  const activeAgencyId = usePhoneSystemAgencyStore((s) => s.activeAgencyId);
  const patchActiveBundle = usePhoneSystemAgencyStore((s) => s.patchActiveBundle);
  const { users: agencyUsers, userLabel } = useAgencyUsers(activeAgencyId);

  useEffect(() => {
    if (!activeAgencyId || !agencyUsers.length) return;
    patchActiveBundle((bundle) => {
      const nextStaff = syncStaffExtensionNamesFromUsers(bundle.staffExtensions ?? [], agencyUsers);
      if (nextStaff === bundle.staffExtensions) return bundle;
      return { ...bundle, staffExtensions: nextStaff };
    });
  }, [activeAgencyId, agencyUsers, patchActiveBundle]);

  useEffect(() => {
    if (!audioForm.pendingFile) return;
    const url = URL.createObjectURL(audioForm.pendingFile);
    setAudioPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audioForm.pendingFile]);

  if (!phoneBundle) {
    return (
      <TabsContent value="phone-system" className="space-y-4 mt-0">
        {loadError ? (
          <div className="py-8 text-center space-y-2">
            <p className="text-sm text-destructive">{loadError}</p>
            <p className="text-xs text-muted-foreground">Refresh the page or check that the backend is running.</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading phone system…</p>
        )}
      </TabsContent>
    );
  }

  const {
    config,
    setConfig,
    phoneNumbers,
    setPhoneNumbers,
    menuRoutes: _menuRoutes,
    setMenuRoutes,
    ringGroups,
    setRingGroups,
    staffExtensions,
    setStaffExtensions,
    voicemailBoxes,
    setVoicemailBoxes,
    audioClips,
    setAudioClips,
    businessHours,
    setBusinessHours,
    draftFlow,
    publishedFlow,
    flowTitle,
    setFlowTitle,
    setDraftFlow,
    agencyOptions,
    setActiveAgencyId,
    saveBundle,
    publishActiveFlow,
    bundle,
    twilio,
    setTwilio,
    rebuildDraftFlowFromResources,
  } = phoneBundle;

  const saveTwilioCredentials = async () => {
    if (!activeAgencyId) return;
    setTwilioSaving(true);
    try {
      const saved = await saveAgencyTwilioCredentials(
        activeAgencyId,
        {
          accountSid: twilio.accountSid,
          apiKeySid: twilio.apiKeySid,
          twimlAppSid: twilio.twimlAppSid,
          region: twilio.region,
        },
        {
          authToken: twilioAuthToken || undefined,
          apiKeySecret: twilioApiKeySecret || undefined,
        },
      );
      usePhoneSystemAgencyStore.setState((state) => ({
        bundles: { ...state.bundles, [saved.subCompanyId]: migrateBundle(saved) },
        loadedFromApi: { ...state.loadedFromApi, [saved.subCompanyId]: true },
        loadError: null,
      }));
      setTwilioAuthToken('');
      setTwilioApiKeySecret('');
      toast.success('Twilio credentials saved for this agency');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save Twilio credentials');
    } finally {
      setTwilioSaving(false);
    }
  };

  const handleTestTwilio = async () => {
    if (!activeAgencyId) return;
    setTwilioTesting(true);
    try {
      const result = await testAgencyTwilioConnection(activeAgencyId);
      if (result.ok) {
        toast.success(result.message + (result.phoneNumberCount != null ? ` (${result.phoneNumberCount} number(s))` : ''));
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connection test failed');
    } finally {
      setTwilioTesting(false);
    }
  };

  const handleSyncTwilioNumbers = async () => {
    if (!activeAgencyId) return;
    setTwilioSyncing(true);
    try {
      const saved = await syncAgencyTwilioNumbers(activeAgencyId);
      usePhoneSystemAgencyStore.setState((state) => ({
        bundles: { ...state.bundles, [saved.subCompanyId]: migrateBundle(saved) },
        loadedFromApi: { ...state.loadedFromApi, [saved.subCompanyId]: true },
        loadError: null,
      }));
      toast.success('Phone numbers synced from Twilio');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to sync numbers');
    } finally {
      setTwilioSyncing(false);
    }
  };

  const handleSave = async () => {
    try {
      setFlowSaveAction('save');
      callFlowRef.current?.flushDraft();
      await saveBundle();
      callFlowRef.current?.markSaved();
      toast.success('Phone system saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save phone system');
    } finally {
      setFlowSaveAction(null);
    }
  };

  const handlePublishCallFlow = async () => {
    try {
      setFlowSaveAction('publish');
      const graph = callFlowRef.current?.flushDraft();
      await publishActiveFlow(graph);
      callFlowRef.current?.markSaved();
      const updated = usePhoneSystemAgencyStore.getState().getActiveBundle();
      if (updated?.publishedFlow) {
        setDraftFlow(updated.publishedFlow);
      }
      toast.success('Call flow published — inbound calls use this flow now');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish call flow');
    } finally {
      setFlowSaveAction(null);
    }
  };

  const addRingGroup = () => {
    if (!newRingGroup.extension.trim() || !newRingGroup.name.trim()) {
      toast.error('Extension and name are required');
      return;
    }
    if (ringGroups.some((g) => g.extension === newRingGroup.extension.trim())) {
      toast.error('Extension already in use');
      return;
    }
    setRingGroups((prev) => [
      ...prev,
      {
        id: newEntityId('rg'),
        extension: newRingGroup.extension.trim(),
        name: newRingGroup.name.trim(),
        ringStrategy: newRingGroup.ringStrategy,
        dialTimeoutSec: newRingGroup.dialTimeoutSec,
        fallbackAction: 'voicemail' as FallbackAction,
        fallbackVoicemailBoxId: voicemailBoxes[0]?.id ?? '',
        fallbackForwardE164: '',
        members: [],
      },
    ]);
    setIsAddRingGroupOpen(false);
    setNewRingGroup({
      extension: '',
      name: '',
      ringStrategy: 'simultaneous',
      dialTimeoutSec: 20,
    });
    remindSave();
  };

  const confirmDeleteRingGroup = () => {
    if (!deleteRingGroupId) return;
    const inDraft = isRingGroupReferencedInFlow(draftFlow, deleteRingGroupId);
    const inPublished = isRingGroupReferencedInFlow(publishedFlow, deleteRingGroupId);
    if (inDraft || inPublished) {
      toast.error('Remove this ring group from the call flow before deleting');
      setDeleteRingGroupId(null);
      return;
    }
    setRingGroups((prev) => prev.filter((g) => g.id !== deleteRingGroupId));
    setDeleteRingGroupId(null);
    remindSave();
  };

  const addRingGroupMember = () => {
    if (!addMemberGroupId) return;
    if (!newMember.userId) {
      toast.error('Select a user');
      return;
    }
    const staff = staffExtensionByUserId(staffExtensions).get(newMember.userId);
    if (!staff) {
      toast.error('Assign a PBX extension on the Extensions tab first');
      return;
    }
    const group = ringGroups.find((g) => g.id === addMemberGroupId);
    if (group?.members.some((m) => m.userId === newMember.userId)) {
      toast.error('User is already in this ring group');
      return;
    }
    setRingGroups((prev) =>
      prev.map((g) =>
        g.id === addMemberGroupId
          ? {
              ...g,
              members: [
                ...g.members,
                {
                  id: newEntityId('m'),
                  userId: staff.userId,
                  userName: staff.userName,
                  extension: staff.extension,
                },
              ],
            }
          : g,
      ),
    );
    setAddMemberGroupId(null);
    setNewMember({ userId: '' });
    remindSave();
  };

  const removeRingGroupMember = (groupId: string, memberId: string) => {
    setRingGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, members: g.members.filter((m) => m.id !== memberId) }
          : g,
      ),
    );
    remindSave();
  };

  const resetVoicemailForm = () => {
    setVoicemailForm({ extension: '', name: '' });
    setEditVoicemailId(null);
  };

  const openAddVoicemail = () => {
    resetVoicemailForm();
    setIsVoicemailDialogOpen(true);
  };

  const openEditVoicemail = (vm: DemoVoicemailBox) => {
    setVoicemailForm({
      extension: vm.extension,
      name: vm.name,
    });
    setEditVoicemailId(vm.id);
    setIsVoicemailDialogOpen(true);
  };

  const syncMenuRoutesFromVoicemail = (
    vmId: string,
    patch: { extension?: string; name?: string },
  ) => {
    setMenuRoutes((prev) =>
      prev.map((r) =>
        r.voicemailBoxId === vmId
          ? {
              ...r,
              ...(patch.extension != null ? { voicemailExtension: patch.extension } : {}),
              ...(patch.name != null ? { voicemailName: patch.name } : {}),
            }
          : r,
      ),
    );
  };

  const saveVoicemailBox = () => {
    const extension = voicemailForm.extension.trim();
    const name = voicemailForm.name.trim();
    if (!extension || !name) {
      toast.error('Extension and name are required');
      return;
    }

    if (editVoicemailId) {
      if (voicemailBoxes.some((v) => v.extension === extension && v.id !== editVoicemailId)) {
        toast.error('Extension already in use');
        return;
      }
      setVoicemailBoxes((prev) =>
        prev.map((v) =>
          v.id === editVoicemailId
            ? {
                ...v,
                extension,
                name,
                greetingType: 'unavailable' as const,
                linkedMenuKey: null,
                notifyEmails: [],
              }
            : v,
        ),
      );
      syncMenuRoutesFromVoicemail(editVoicemailId, { extension, name });
    } else {
      if (voicemailBoxes.some((v) => v.extension === extension)) {
        toast.error('Extension already in use');
        return;
      }
      setVoicemailBoxes((prev) => [
        ...prev,
        {
          id: newEntityId('vm'),
          extension,
          name,
          greetingType: 'unavailable',
          linkedMenuKey: null,
          notifyEmails: [],
        },
      ]);
    }
    setIsVoicemailDialogOpen(false);
    resetVoicemailForm();
    remindSave();
  };

  const confirmDeleteVoicemail = () => {
    if (!deleteVoicemailId) return;
    if (
      isVoicemailBoxReferenced(deleteVoicemailId, ringGroups, [draftFlow, publishedFlow])
    ) {
      toast.error('Remove this voicemail box from ring group fallbacks or call flow before deleting');
      setDeleteVoicemailId(null);
      return;
    }
    setVoicemailBoxes((prev) => prev.filter((v) => v.id !== deleteVoicemailId));
    setDeleteVoicemailId(null);
    remindSave();
  };

  const resetAudioForm = () => {
    setAudioForm({
      name: '',
      sourceType: 'message',
      scriptText: '',
      pendingFile: null,
      r2Key: null,
      fileName: null,
      mimeType: null,
    });
    setAudioPreviewUrl(null);
    setEditAudioId(null);
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
  };

  const loadAudioPreview = async (clipId: string) => {
    if (!activeAgencyId) return;
    const url = await fetchPhoneAudioClipStreamUrl(activeAgencyId, clipId);
    setAudioPreviewUrl(url);
  };

  const openAddAudio = () => {
    resetAudioForm();
    setIsAudioDialogOpen(true);
  };

  const openEditAudio = (clip: DemoAudioClip) => {
    setAudioForm({
      name: clip.name,
      sourceType: clip.sourceType ?? (clip.r2Key ? 'upload' : 'message'),
      scriptText: clip.scriptText,
      pendingFile: null,
      r2Key: clip.r2Key ?? null,
      fileName: clip.fileName ?? null,
      mimeType: clip.mimeType ?? null,
    });
    setEditAudioId(clip.id);
    setAudioPreviewUrl(null);
    if (audioFileInputRef.current) audioFileInputRef.current.value = '';
    setIsAudioDialogOpen(true);
    if ((clip.sourceType === 'upload' || clip.r2Key) && clip.r2Key) {
      void loadAudioPreview(clip.id);
    }
  };

  const handleAudioSourceTypeChange = (next: AudioClipSourceType) => {
    setAudioForm((prev) => {
      if (prev.sourceType === next) return prev;
      return {
        ...prev,
        sourceType: next,
        scriptText: next === 'message' ? prev.scriptText : '',
        pendingFile: null,
        r2Key: next === 'upload' ? prev.r2Key : null,
        fileName: next === 'upload' ? prev.fileName : null,
        mimeType: next === 'upload' ? prev.mimeType : null,
      };
    });
    if (next === 'message') {
      setAudioPreviewUrl(null);
      if (audioFileInputRef.current) audioFileInputRef.current.value = '';
    }
  };

  const saveAudioClip = async () => {
    const name = audioForm.name.trim();
    const scriptText = audioForm.scriptText.trim();
    if (!name) {
      toast.error('Clip name is required');
      return;
    }
    if (audioForm.sourceType === 'message' && !scriptText) {
      toast.error('Recording script is required for message clips');
      return;
    }
    if (audioForm.sourceType === 'upload' && !audioForm.pendingFile && !audioForm.r2Key) {
      toast.error('Voice file is required for upload clips');
      return;
    }
    if (!activeAgencyId) {
      toast.error('Agency context required');
      return;
    }

    const clipId = editAudioId ?? newEntityId('ac');

    if (editAudioId) {
      if (audioClips.some((c) => c.name === name && c.id !== editAudioId)) {
        toast.error('A clip with this name already exists');
        return;
      }
    } else if (audioClips.some((c) => c.name === name)) {
      toast.error('A clip with this name already exists');
      return;
    }

    setAudioUploading(true);
    try {
      let r2Key = audioForm.r2Key;
      let fileName = audioForm.fileName;
      let mimeType = audioForm.mimeType;

      if (audioForm.sourceType === 'upload' && audioForm.pendingFile) {
        const uploaded = await uploadPhoneAudioClip(activeAgencyId, clipId, audioForm.pendingFile);
        r2Key = uploaded.r2Key;
        fileName = uploaded.fileName;
        mimeType = uploaded.mimeType;
      }

      const clip: DemoAudioClip = {
        id: clipId,
        name,
        sourceType: audioForm.sourceType,
        scriptText: audioForm.sourceType === 'message' ? scriptText : '',
        r2Key: audioForm.sourceType === 'upload' ? r2Key : null,
        fileName: audioForm.sourceType === 'upload' ? fileName : null,
        mimeType: audioForm.sourceType === 'upload' ? mimeType : null,
        durationSec: 15,
        uploadedAt: new Date().toISOString(),
      };

      if (editAudioId) {
        setAudioClips((prev) => prev.map((c) => (c.id === editAudioId ? clip : c)));
      } else {
        setAudioClips((prev) => [...prev, clip]);
      }

      setIsAudioDialogOpen(false);
      resetAudioForm();
      remindSave();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save audio clip');
    } finally {
      setAudioUploading(false);
    }
  };

  const confirmDeleteAudio = () => {
    if (!deleteAudioId) return;
    setAudioClips((prev) => prev.filter((c) => c.id !== deleteAudioId));
    setDeleteAudioId(null);
    remindSave();
  };

  const openAddRingGroupDialog = () => {
    setNewRingGroup({
      extension: suggestNextRingGroupExtension(ringGroups),
      name: '',
      ringStrategy: 'simultaneous',
      dialTimeoutSec: 20,
    });
    setIsAddRingGroupOpen(true);
  };

  return (
    <TabsContent value="phone-system" className="space-y-4 mt-0">
      {loadError ? (
        <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          {loadError}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Phone System
          </h2>
          <p className="text-sm text-muted-foreground">
            Configure auto attendant, ring groups, voicemail, and business hours per agency.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {agencyOptions.length > 1 ? (
            <Select value={activeAgencyId} onValueChange={setActiveAgencyId}>
              <SelectTrigger className="w-[200px] h-9">
                <Building2 className="h-3.5 w-3.5 mr-2 shrink-0" />
                <SelectValue placeholder="Agency" />
              </SelectTrigger>
              <SelectContent>
                {agencyOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="call-flow" className="gap-1">
            <GitBranch className="h-3.5 w-3.5" /> Call Flow
          </TabsTrigger>
          <TabsTrigger value="numbers" className="gap-1">
            <Hash className="h-3.5 w-3.5" /> Number
          </TabsTrigger>
          <TabsTrigger value="extensions" className="gap-1">
            <Contact className="h-3.5 w-3.5" /> Extensions
          </TabsTrigger>
          <TabsTrigger value="ring-groups" className="gap-1">
            <Users className="h-3.5 w-3.5" /> Ring Groups
          </TabsTrigger>
          <TabsTrigger value="voicemail" className="gap-1">
            <Voicemail className="h-3.5 w-3.5" /> Voicemail
          </TabsTrigger>
          <TabsTrigger value="audio" className="gap-1">
            <Music className="h-3.5 w-3.5" /> Audio
          </TabsTrigger>
          <TabsTrigger value="hours" className="gap-1">
            <Clock className="h-3.5 w-3.5" /> Hours
          </TabsTrigger>
          <TabsTrigger value="integrations" className="gap-1">
            <Plug className="h-3.5 w-3.5" /> Integrations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="call-flow" className="mt-4">
          <CallFlowBuilderTab
            ref={callFlowRef}
            bundle={bundle}
            flowTitle={flowTitle}
            draftFlow={draftFlow}
            publishedFlow={publishedFlow}
            ringGroups={ringGroups}
            staffExtensions={staffExtensions}
            voicemailBoxes={voicemailBoxes}
            audioClips={audioClips}
            saving={saving}
            savingLabel={flowSaveAction === 'save' ? 'Saving…' : 'Publishing…'}
            onFlowTitleChange={setFlowTitle}
            onDraftChange={setDraftFlow}
            onSave={handleSave}
            onPublish={handlePublishCallFlow}
          />
        </TabsContent>

        {/* Numbers */}
        <TabsContent value="numbers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Phone number</CardTitle>
              <CardDescription>
                One incoming DID per agency. Routing is configured in the Call Flow tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              {(() => {
                const num =
                  phoneNumbers[0] ?? {
                    id: newEntityId('pn'),
                    e164: '',
                    label: '',
                    isActive: true,
                  };

                const updateNumber = (patch: Partial<typeof num>) => {
                  setPhoneNumbers([{ ...num, ...patch }]);
                };

                return (
                  <>
                    <div className="space-y-2">
                      <Label>Incoming phone number</Label>
                      <Input
                        className="font-mono"
                        value={num.e164}
                        placeholder="+16475551234"
                        onChange={(e) => updateNumber({ e164: e.target.value })}
                        onBlur={remindSave}
                      />
                      <p className="text-xs text-muted-foreground">
                        Your agency&apos;s main DID. Include + and country code (e.g. +1…).
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Label</Label>
                      <Input
                        value={num.label}
                        placeholder="e.g. Main line"
                        onChange={(e) => updateNumber({ label: e.target.value })}
                        onBlur={remindSave}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Outbound caller ID</Label>
                      <Input
                        className="font-mono"
                        value={config.outboundCallerId ?? num.e164}
                        placeholder="+16475551234"
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            outboundCallerId: e.target.value,
                          }))
                        }
                        onBlur={remindSave}
                      />
                      <p className="text-xs text-muted-foreground">
                        Number shown to recipients on outbound calls. Defaults to the incoming DID when empty.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="outbound-enabled"
                        checked={config.outboundEnabled ?? Boolean(num.e164)}
                        onCheckedChange={(checked) => {
                          setConfig((c) => ({ ...c, outboundEnabled: checked }));
                          remindSave();
                        }}
                      />
                      <Label htmlFor="outbound-enabled">Outbound calling enabled</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="inbound-enabled"
                        checked={config.inboundEnabled ?? Boolean(num.e164)}
                        onCheckedChange={(checked) => {
                          setConfig((c) => ({ ...c, inboundEnabled: checked }));
                          remindSave();
                        }}
                      />
                      <Label htmlFor="inbound-enabled">Inbound calling enabled</Label>
                    </div>
                    <div className="space-y-2">
                      <Label>Auto-attendant extension</Label>
                      <Input
                        value={config.autoAttendantExtension}
                        onChange={(e) =>
                          setConfig((c) => ({
                            ...c,
                            autoAttendantExtension: e.target.value.replace(/\D/g, '').slice(0, 6),
                          }))
                        }
                        onBlur={remindSave}
                        placeholder="e.g. 112"
                        className="font-mono max-w-[120px]"
                      />
                      <p className="text-xs text-muted-foreground">
                        PBX extension for this agency. Greeting, menu, timeout, and extension dialing
                        are configured on the Call Flow tab.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        id="number-active"
                        checked={num.isActive}
                        onCheckedChange={(checked) => {
                          updateNumber({ isActive: checked });
                          remindSave();
                        }}
                      />
                      <Label htmlFor="number-active">Number active</Label>
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="extensions" className="mt-4">
          <StaffExtensionsTab
            agencyId={activeAgencyId}
            staffExtensions={staffExtensions}
            ringGroups={ringGroups}
            voicemailBoxes={voicemailBoxes}
            onStaffExtensionsChange={setStaffExtensions}
            onSaved={remindSave}
          />
        </TabsContent>

        {/* Ring Groups */}
        <TabsContent value="ring-groups" className="space-y-4 mt-4">
          <div className="rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground space-y-1">
            <p>
              <strong>Extension</strong> is this group&apos;s dial number (extension-dial{' '}
              <span className="font-mono">ext#</span>) and the default IVR key when you rebuild the
              call flow.
            </p>
            <p>
              <strong>Members</strong> are CRM users from the Extensions tab — they receive inbound
              rings according to the ring strategy below.
            </p>
            <p>
              IVR routing is wired in the <strong>Call Flow</strong> tab. After changes here,{' '}
              <strong>Save</strong> and <strong>Publish</strong> the call flow.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                rebuildDraftFlowFromResources();
                remindSave();
                toast.message('Call flow rebuilt from ring groups');
              }}
            >
              Rebuild call flow
            </Button>
            <Button size="sm" onClick={openAddRingGroupDialog}>
              <Plus className="h-4 w-4 mr-1" /> Add ring group
            </Button>
          </div>
          <Dialog open={isAddRingGroupOpen} onOpenChange={setIsAddRingGroupOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add ring group</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Extension</Label>
                      <Input
                        value={newRingGroup.extension}
                        onChange={(e) =>
                          setNewRingGroup((s) => ({ ...s, extension: e.target.value }))
                        }
                        placeholder="e.g. 4"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={newRingGroup.name}
                        onChange={(e) =>
                          setNewRingGroup((s) => ({ ...s, name: e.target.value }))
                        }
                        placeholder="e.g. Support"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Ring strategy</Label>
                      <Select
                        value={newRingGroup.ringStrategy}
                        onValueChange={(v) =>
                          setNewRingGroup((s) => ({
                            ...s,
                            ringStrategy: v as 'simultaneous' | 'sequential',
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="simultaneous">Simultaneous</SelectItem>
                          <SelectItem value="sequential">Sequential</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {newRingGroup.ringStrategy === 'sequential'
                          ? 'Members ring one at a time in list order; each gets the full timeout.'
                          : 'All members ring at once; first to answer gets the call.'}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>Timeout (sec)</Label>
                      <Input
                        type="number"
                        value={newRingGroup.dialTimeoutSec}
                        onChange={(e) =>
                          setNewRingGroup((s) => ({
                            ...s,
                            dialTimeoutSec: parseInt(e.target.value, 10) || 20,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddRingGroupOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={addRingGroup}>Add group</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

          {ringGroups.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No ring groups yet. Add one to route menu keys to teams.
              </CardContent>
            </Card>
          ) : (
            ringGroups.map((group) => {
              const inDraftFlow = isRingGroupReferencedInFlow(draftFlow, group.id);
              const inPublishedFlow = isRingGroupReferencedInFlow(publishedFlow, group.id);
              const menuKey = parseRingGroupMenuKey(group.extension);
              return (
              <Card key={group.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          className="h-8 w-20 font-mono"
                          value={group.extension}
                          onChange={(e) => {
                            setRingGroups((prev) =>
                              prev.map((g) =>
                                g.id === group.id ? { ...g, extension: e.target.value } : g,
                              ),
                            );
                          }}
                          onBlur={remindSave}
                        />
                        <Input
                          className="h-8 max-w-xs font-medium"
                          value={group.name}
                          onChange={(e) => {
                            const name = e.target.value;
                            setRingGroups((prev) =>
                              prev.map((g) => (g.id === group.id ? { ...g, name } : g)),
                            );
                          }}
                          onBlur={remindSave}
                        />
                        {menuKey != null ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            IVR key {menuKey}
                          </Badge>
                        ) : null}
                        {inDraftFlow ? (
                          <Badge variant="secondary" className="text-xs">
                            In call flow
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                            Not in call flow
                          </Badge>
                        )}
                        {inPublishedFlow ? null : inDraftFlow ? (
                          <Badge variant="outline" className="text-xs text-amber-700 border-amber-300">
                            Publish required
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 pt-1">
                        <Select
                          value={group.ringStrategy}
                          onValueChange={(v) => {
                            setRingGroups((prev) =>
                              prev.map((g) =>
                                g.id === group.id
                                  ? { ...g, ringStrategy: v as 'simultaneous' | 'sequential' }
                                  : g,
                              ),
                            );
                            remindSave();
                          }}
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="simultaneous">Simultaneous</SelectItem>
                            <SelectItem value="sequential">Sequential</SelectItem>
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground max-w-md">
                          {group.ringStrategy === 'sequential'
                            ? 'Sequential — one member at a time in list order'
                            : 'Simultaneous — all members ring together'}
                        </span>
                        <div className="flex items-center gap-2 text-sm">
                          <Label className="text-xs text-muted-foreground">Timeout</Label>
                          <Input
                            type="number"
                            className="h-8 w-16"
                            value={group.dialTimeoutSec}
                            onChange={(e) => {
                              setRingGroups((prev) =>
                                prev.map((g) =>
                                  g.id === group.id
                                    ? {
                                        ...g,
                                        dialTimeoutSec: parseInt(e.target.value, 10) || 20,
                                      }
                                    : g,
                                ),
                              );
                            }}
                            onBlur={remindSave}
                          />
                          <span className="text-muted-foreground text-xs">sec</span>
                        </div>
                      </div>
                      <FallbackFieldsEditor
                        fallbackAction={group.fallbackAction}
                        fallbackVoicemailBoxId={group.fallbackVoicemailBoxId}
                        fallbackForwardE164={group.fallbackForwardE164}
                        voicemailBoxes={voicemailBoxes}
                        onActionChange={(action) => {
                          setRingGroups((prev) =>
                            prev.map((g) =>
                              g.id === group.id ? { ...g, fallbackAction: action } : g,
                            ),
                          );
                          remindSave();
                        }}
                        onVoicemailChange={(id) => {
                          setRingGroups((prev) =>
                            prev.map((g) =>
                              g.id === group.id ? { ...g, fallbackVoicemailBoxId: id } : g,
                            ),
                          );
                          remindSave();
                        }}
                        onForwardChange={(e164) => {
                          setRingGroups((prev) =>
                            prev.map((g) =>
                              g.id === group.id ? { ...g, fallbackForwardE164: e164 } : g,
                            ),
                          );
                          remindSave();
                        }}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive shrink-0"
                      onClick={() => setDeleteRingGroupId(group.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium">Members</p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAddMemberGroupId(group.id);
                        setNewMember({ userId: '' });
                      }}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Add member
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Extension</TableHead>
                        <TableHead className="w-10" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.members.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                            No members — add staff to this ring group
                          </TableCell>
                        </TableRow>
                      ) : (
                        group.members.map((member) => {
                          const staff = resolveRingGroupMember(member, staffExtensions);
                          if (!staff) return null;
                          const liveUser = agencyUsers.find((u) => u.id === staff.userId);
                          const displayName = liveUser ? userLabel(liveUser) : staff.userName;
                          return (
                          <TableRow key={member.id}>
                            <TableCell>
                              <span className="text-sm font-medium">{displayName}</span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">{staff.extension}</span>
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => removeRingGroupMember(group.id, member.id)}
                              >
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              </Button>
                            </TableCell>
                          </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
            })
          )}

          <Dialog
            open={!!addMemberGroupId}
            onOpenChange={(open) => !open && setAddMemberGroupId(null)}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add ring group member</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label>User (from system)</Label>
                  {(() => {
                    const group = ringGroups.find((g) => g.id === addMemberGroupId);
                    const available = staffExtensions.filter(
                      (s) => !group?.members.some((m) => m.userId === s.userId),
                    );
                    if (available.length === 0) {
                      return (
                        <p className="text-sm text-muted-foreground">
                          No users with extensions available. Assign extensions on the Extensions
                          tab first, or all eligible users are already in this group.
                        </p>
                      );
                    }
                    return (
                      <Select
                        value={newMember.userId || undefined}
                        onValueChange={(userId) => setNewMember({ userId })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select user" />
                        </SelectTrigger>
                        <SelectContent>
                          {available.map((s) => {
                            const liveUser = agencyUsers.find((u) => u.id === s.userId);
                            const name = liveUser ? userLabel(liveUser) : s.userName;
                            return (
                              <SelectItem key={s.userId} value={s.userId}>
                                {name} · ext {s.extension}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    );
                  })()}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddMemberGroupId(null)}>
                  Cancel
                </Button>
                <Button onClick={addRingGroupMember} disabled={!newMember.userId}>
                  Add member
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={!!deleteRingGroupId}
            onOpenChange={(open) => !open && setDeleteRingGroupId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete ring group?</AlertDialogTitle>
                <AlertDialogDescription>
                  Remove this group from the call flow before deleting. Members will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteRingGroup}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Voicemail */}
        <TabsContent value="voicemail" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAddVoicemail}>
              <Plus className="h-4 w-4 mr-1" /> Add voicemail box
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Shared voicemail boxes</CardTitle>
              <CardDescription>
                Voicemail boxes used as ring-group fallbacks. Delete is blocked while a box is referenced in the call flow or a ring group.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {voicemailBoxes.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No voicemail boxes yet.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ext</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {voicemailBoxes.map((vm) => (
                      <TableRow key={vm.id}>
                        <TableCell className="font-mono">{vm.extension}</TableCell>
                        <TableCell>{vm.name}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditVoicemail(vm)}
                              aria-label="Edit voicemail box"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => setDeleteVoicemailId(vm.id)}
                              aria-label="Delete voicemail box"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={isVoicemailDialogOpen}
            onOpenChange={(open) => {
              setIsVoicemailDialogOpen(open);
              if (!open) resetVoicemailForm();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editVoicemailId ? 'Edit voicemail box' : 'Add voicemail box'}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Extension</Label>
                    <Input
                      value={voicemailForm.extension}
                      onChange={(e) =>
                        setVoicemailForm((s) => ({ ...s, extension: e.target.value }))
                      }
                      placeholder="e.g. 11"
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={voicemailForm.name}
                      onChange={(e) =>
                        setVoicemailForm((s) => ({ ...s, name: e.target.value }))
                      }
                      placeholder="e.g. Support VM"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsVoicemailDialogOpen(false);
                    resetVoicemailForm();
                  }}
                >
                  Cancel
                </Button>
                <Button onClick={saveVoicemailBox}>
                  {editVoicemailId ? 'Save changes' : 'Add box'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={!!deleteVoicemailId}
            onOpenChange={(open) => !open && setDeleteVoicemailId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete voicemail box?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the shared mailbox. Reassign ring group fallbacks first if this box is in use.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteVoicemail}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Audio */}
        <TabsContent value="audio" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openAddAudio}>
              <Plus className="h-4 w-4 mr-1" /> Add audio clip
            </Button>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audio library</CardTitle>
              <CardDescription>
                Caller messages can be text-to-speech scripts or uploaded voice files (MP3/WAV).
                Edit clips here, save the agency, and publish the call flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {audioClips.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  No audio clips yet. Add clips before configuring the dial plan.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Content</TableHead>
                      <TableHead className="w-24 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audioClips.map((clip) => {
                      const clipType =
                        clip.sourceType === 'upload' || clip.r2Key ? 'Voice file' : 'Message';
                      const content =
                        clipType === 'Voice file'
                          ? clip.fileName || 'Uploaded audio'
                          : clip.scriptText;
                      return (
                      <TableRow key={clip.id}>
                        <TableCell className="font-medium">{clip.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{clipType}</TableCell>
                        <TableCell className="max-w-md text-xs text-muted-foreground truncate">
                          {content}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditAudio(clip)}
                              aria-label="Edit audio clip"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive"
                              onClick={() => setDeleteAudioId(clip.id)}
                              aria-label="Delete audio clip"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={isAudioDialogOpen}
            onOpenChange={(open) => {
              setIsAudioDialogOpen(open);
              if (!open) resetAudioForm();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editAudioId ? 'Edit audio clip' : 'Add audio clip'}
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="space-y-2">
                  <Label>Clip name</Label>
                  <Input
                    value={audioForm.name}
                    onChange={(e) => setAudioForm((s) => ({ ...s, name: e.target.value }))}
                    placeholder="Exact name used in dial plan"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Clip type</Label>
                  <RadioGroup
                    value={audioForm.sourceType}
                    onValueChange={(value) =>
                      handleAudioSourceTypeChange(value as AudioClipSourceType)
                    }
                    className="grid gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="message" id="audio-type-message" />
                      <Label htmlFor="audio-type-message" className="font-normal">
                        Message (text-to-speech)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="upload" id="audio-type-upload" />
                      <Label htmlFor="audio-type-upload" className="font-normal">
                        Upload voice file
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
                {audioForm.sourceType === 'message' ? (
                  <div className="space-y-2">
                    <Label>Recording script</Label>
                    <Textarea
                      rows={4}
                      value={audioForm.scriptText}
                      onChange={(e) =>
                        setAudioForm((s) => ({ ...s, scriptText: e.target.value }))
                      }
                      placeholder="Script read by Twilio text-to-speech…"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label>Voice file</Label>
                    <Input
                      ref={audioFileInputRef}
                      type="file"
                      accept="audio/mpeg,audio/wav,.mp3,.wav"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        setAudioForm((s) => ({ ...s, pendingFile: file }));
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {audioForm.pendingFile
                        ? `Selected: ${audioForm.pendingFile.name}`
                        : audioForm.fileName
                          ? `Current file: ${audioForm.fileName}`
                          : 'MP3 or WAV, max 10 MB'}
                    </p>
                    {audioPreviewUrl && (
                      <audio controls src={audioPreviewUrl} className="w-full" />
                    )}
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {audioForm.sourceType === 'message'
                    ? 'Script text is used for live Twilio Say playback. Save the agency bundle to persist.'
                    : 'The file uploads when you save this clip. Then save the agency bundle to persist metadata.'}
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsAudioDialogOpen(false);
                    resetAudioForm();
                  }}
                  disabled={audioUploading}
                >
                  Cancel
                </Button>
                <Button onClick={() => void saveAudioClip()} disabled={audioUploading}>
                  {audioUploading
                    ? 'Uploading…'
                    : editAudioId
                      ? 'Save changes'
                      : 'Add clip'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <AlertDialog
            open={!!deleteAudioId}
            onOpenChange={(open) => !open && setDeleteAudioId(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete audio clip?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the clip from the library. Update play-message nodes on the Call Flow
                  first if this clip is in use.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDeleteAudio}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </TabsContent>

        {/* Business Hours */}
        <TabsContent value="hours" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business hours</CardTitle>
              <CardDescription>
                Open/closed routing uses these hours in the timezone below. Save after changing hours or timezone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="max-w-xs space-y-2">
                <Label htmlFor="phone-business-hours-timezone">Timezone</Label>
                <Select
                  value={config.timezone ?? 'America/Toronto'}
                  onValueChange={(v) => {
                    setConfig((c) => ({ ...c, timezone: v }));
                    remindSave();
                  }}
                >
                  <SelectTrigger id="phone-business-hours-timezone">
                    <SelectValue placeholder="Select timezone" />
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
                  </SelectContent>
                </Select>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead>Enabled</TableHead>
                    <TableHead>From</TableHead>
                    <TableHead>To</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {businessHours.map((day) => (
                    <TableRow key={day.dayOfWeek}>
                      <TableCell>{day.label}</TableCell>
                      <TableCell>
                        <Switch
                          checked={day.enabled}
                          onCheckedChange={(checked) => {
                            setBusinessHours((prev) =>
                              prev.map((d) =>
                                d.dayOfWeek === day.dayOfWeek ? { ...d, enabled: checked } : d,
                              ),
                            );
                            remindSave();
                          }}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          className="h-8 w-28"
                          value={day.open}
                          disabled={!day.enabled}
                          onChange={(e) => {
                            setBusinessHours((prev) =>
                              prev.map((d) =>
                                d.dayOfWeek === day.dayOfWeek
                                  ? { ...d, open: e.target.value }
                                  : d,
                              ),
                            );
                          }}
                          onBlur={remindSave}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="time"
                          className="h-8 w-28"
                          value={day.close}
                          disabled={!day.enabled}
                          onChange={(e) => {
                            setBusinessHours((prev) =>
                              prev.map((d) =>
                                d.dayOfWeek === day.dayOfWeek
                                  ? { ...d, close: e.target.value }
                                  : d,
                              ),
                            );
                          }}
                          onBlur={remindSave}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Twilio integration (this agency)</CardTitle>
              <CardDescription>
                Twilio credentials and phone numbers are stored per agency in the database.
                Configure each agency separately below. R2 storage stays org-wide in server{' '}
                <code className="text-xs">.env</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Label>Status</Label>
                <Badge variant={twilio.credentialsConfigured ? 'default' : 'secondary'}>
                  {config.syncStatus === 'synced'
                    ? 'Synced'
                    : twilio.credentialsConfigured
                      ? 'Configured'
                      : 'Not connected'}
                </Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="twilio-account-sid">Account SID</Label>
                  <Input
                    id="twilio-account-sid"
                    className="font-mono text-xs"
                    placeholder="AC…"
                    value={twilio.accountSid ?? ''}
                    onChange={(e) =>
                      setTwilio((prev) => ({ ...prev, accountSid: e.target.value || null }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-api-key-sid">API Key SID</Label>
                  <Input
                    id="twilio-api-key-sid"
                    className="font-mono text-xs"
                    placeholder="SK…"
                    value={twilio.apiKeySid ?? ''}
                    onChange={(e) =>
                      setTwilio((prev) => ({ ...prev, apiKeySid: e.target.value || null }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-twiml-app-sid">TwiML App SID</Label>
                  <Input
                    id="twilio-twiml-app-sid"
                    className="font-mono text-xs"
                    placeholder="AP…"
                    value={twilio.twimlAppSid ?? ''}
                    onChange={(e) =>
                      setTwilio((prev) => ({ ...prev, twimlAppSid: e.target.value || null }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-region">Region (optional)</Label>
                  <Input
                    id="twilio-region"
                    className="font-mono text-xs"
                    placeholder="e.g. us1, ie1"
                    value={twilio.region ?? ''}
                    onChange={(e) =>
                      setTwilio((prev) => ({ ...prev, region: e.target.value || null }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Twilio edge region only — leave blank for default US. Do not enter an email.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-auth-token">Auth Token</Label>
                  <Input
                    id="twilio-auth-token"
                    type="password"
                    placeholder={twilio.hasAuthToken ? '•••••••• (leave blank to keep)' : 'Required'}
                    value={twilioAuthToken}
                    onChange={(e) => setTwilioAuthToken(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="twilio-api-key-secret">API Key Secret</Label>
                  <Input
                    id="twilio-api-key-secret"
                    type="password"
                    placeholder={twilio.hasApiKeySecret ? '•••••••• (leave blank to keep)' : 'Required'}
                    value={twilioApiKeySecret}
                    onChange={(e) => setTwilioApiKeySecret(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Inbound webhook URL (set on this agency&apos;s DID in Twilio Console)</Label>
                <Input value={config.webhookUrl} readOnly className="font-mono text-xs" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={twilioSaving} onClick={() => void saveTwilioCredentials()}>
                  {twilioSaving ? 'Saving…' : 'Save credentials'}
                </Button>
                <Button type="button" variant="outline" disabled={twilioTesting} onClick={() => void handleTestTwilio()}>
                  {twilioTesting ? 'Testing…' : 'Test connection'}
                </Button>
                <Button type="button" variant="outline" disabled={twilioSyncing} onClick={() => void handleSyncTwilioNumbers()}>
                  {twilioSyncing ? 'Syncing…' : 'Sync numbers from Twilio'}
                </Button>
              </div>
              <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
                <li>Enter this agency&apos;s Twilio subaccount credentials above and save</li>
                <li>Click Sync numbers or enter the DID manually in the Number tab</li>
                <li>Set the inbound webhook URL on that number in Twilio Console</li>
                <li>Assign staff to ring groups and publish the call flow</li>
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </TabsContent>
  );
}
