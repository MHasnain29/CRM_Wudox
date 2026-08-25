import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmailRichTextEditor } from '@/components/EmailRichTextEditor';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Send, FileText, Calendar, ChevronDown, ChevronUp, Loader2, PenLine, Paperclip, X, Image as ImageIcon, Film, Mail } from 'lucide-react';
import { applyAgencyFooter } from '@/lib/emailStarterTemplates';
import { recoverPastedEmailHtml } from '@/lib/recoverPastedEmailHtml';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useStore } from '@/lib/store';
import { useActAs } from '@/hooks/useActAs';
import {
  fetchClient,
  fetchClients,
  fetchEmailTemplates,
  fetchMyManagedAgencies,
  fetchReplyAsEligibleUsers,
  sendEmail,
  saveEmailDraft,
  updateEmailDraft,
  deleteEmailDraft,
  type ApiEmailTemplate,
  type ApiEmailDetail,
  type ManagedAgencyEntry,
} from '@/lib/api';
import { toast } from 'sonner';
import { MeetingScheduleSection } from './MeetingScheduleSection';
import {
  EMAIL_ATTACHMENT_ACCEPT,
  fileToBase64,
  formatEmailFileSize,
  isEmailImageMime,
  isEmailVideoMime,
  validateEmailAttachmentSelection,
} from '@/lib/emailAttachmentUtils';

export interface ReplyToEmail {
  id?: string;
  subject: string;
  from: { name: string; email: string };
  to: Array<{ name: string; email: string }>;
  body?: string;
  clientId?: string;
}

interface EmailComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  replyTo?: ReplyToEmail | ApiEmailDetail | null;
  defaultClientId?: string;
  defaultContactId?: string;
  /** Lock To: to a raw address (e.g. employee) — skips client contact picker. */
  fixedRecipient?: { email: string; name: string } | null;
  /** Lock To: to multiple raw addresses (e.g. Contact All). Takes precedence over fixedRecipient when non-empty. */
  fixedRecipients?: Array<{ email: string; name: string }> | null;
  onSent?: () => void;
  onDraftSaved?: () => void;
  /** Pre-fill compose dialog from an existing draft for editing */
  editDraft?: {
    id: string;
    subject: string;
    body: string;
    toEmail?: string;
    toName?: string;
    clientId?: string;
    subCompanyId?: string;
    fromUserId?: string;
  } | null;
  /** Current agency tab context — 'all' or a subCompanyId. Used for OM From: picker. */
  selectedAgencyId?: string;
  /** Pre-select a user in the Send as picker (pass the selected user chip's ID from the Emails page). */
  defaultReplyAsUserId?: string;
  /** Prefill subject when opening compose (e.g. assignment email from Manage Employees). Ignored for reply/editDraft. */
  defaultSubject?: string;
  /** Prefill body HTML when opening compose. Ignored for reply/editDraft. */
  defaultBody?: string;
}

type ContactOption = {
  clientId: string;
  contactId: string;
  clientName: string;
  contactName: string;
  contactTitle: string;
  email: string;
};

export function EmailComposeDialog({
  open,
  onOpenChange,
  replyTo,
  defaultClientId,
  defaultContactId,
  fixedRecipient,
  fixedRecipients,
  onSent,
  onDraftSaved,
  editDraft,
  selectedAgencyId,
  defaultReplyAsUserId,
  defaultSubject,
  defaultBody,
}: EmailComposeDialogProps) {
  const { currentSubCompany, currentUser } = useStore();
  const actAs = useActAs();
  // When acting as another user, use their identity for the From display
  const effectiveFromName = actAs.isActive
    ? [actAs.firstName, actAs.lastName].filter(Boolean).join(' ')
    : [currentUser?.firstName, currentUser?.lastName].filter(Boolean).join(' ');
  const effectiveFromEmail = actAs.isActive ? (actAs.email ?? '') : (currentUser?.email ?? '');
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [clientOptions, setClientOptions] = useState<ContactOption[]>([]);
  const [clientSearchLoading, setClientSearchLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactOption | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [templates, setTemplates] = useState<ApiEmailTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [meetingOptionsOpen, setMeetingOptionsOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [omAgencies, setOmAgencies] = useState<(ManagedAgencyEntry & { name: string })[]>([]);
  const [fromSubCompanyId, setFromSubCompanyId] = useState<string>('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [replyAsUsers, setReplyAsUsers] = useState<Array<{ id: string; firstName: string; lastName: string; email: string; subCompanyId?: string | null }>>([]);
  const [replyAsUserId, setReplyAsUserId] = useState<string>('');
  const [fromPopoverOpen, setFromPopoverOpen] = useState(false);

  const isReply = Boolean(replyTo);
  const effectiveFixedRecipients: Array<{ email: string; name: string }> = (() => {
    if (fixedRecipients?.length) {
      return fixedRecipients
        .map((r) => ({ email: r.email.trim(), name: r.name.trim() }))
        .filter((r) => r.email);
    }
    if (fixedRecipient?.email?.trim()) {
      return [{ email: fixedRecipient.email.trim(), name: fixedRecipient.name?.trim() || fixedRecipient.email.trim() }];
    }
    return [];
  })();
  const hasFixedRecipient = effectiveFixedRecipients.length > 0;
  const isOM = currentUser?.role === 'operations_manager';
  // OM agency From only when sending as self — never overrides user-tab / reply-as / act-as.
  const omSelfMode = isOM && !replyAsUserId;
  const omEmails = omAgencies.filter((a) => a.agencyEmail);
  const selectedOmAgency = omEmails.find((a) => a.subCompanyId === fromSubCompanyId) ?? omEmails[0];
  const omFromEmail = selectedOmAgency?.agencyEmail ?? '';
  const selfFromEmail = omSelfMode && omFromEmail ? omFromEmail : effectiveFromEmail;
  const selfFromLabel = `${effectiveFromName} — ${selfFromEmail}`;

  // Filter From dropdown list by selected agency — but keep full replyAsUsers for auto-selection lookup/display
  const visibleReplyAsUsers = (selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me')
    ? replyAsUsers.filter((u) => u.subCompanyId === selectedAgencyId)
    : replyAsUsers;

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const list = await fetchEmailTemplates();
      setTemplates(list);
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  // Load eligible reply-as users once when dialog opens; auto-select if a user chip was active
  useEffect(() => {
    if (!open) return;
    fetchReplyAsEligibleUsers().then((users) => {
      setReplyAsUsers(users);
      if (defaultReplyAsUserId && users.some((u) => u.id === defaultReplyAsUserId)) {
        setReplyAsUserId(defaultReplyAsUserId);
      }
    }).catch(() => setReplyAsUsers([]));
  }, [open, defaultReplyAsUserId]);

  // Load OM per-agency sending emails (self-scoped). Auto-select only for OM-self From.
  useEffect(() => {
    if (!open || !isOM) return;
    let cancelled = false;
    fetchMyManagedAgencies()
      .then((list) => {
        if (cancelled) return;
        const withEmails = list.filter((a) => a.agencyEmail);
        setOmAgencies(withEmails);

        // Prefer draft agency, then concrete agency tab, else first assigned.
        const draftAgency = editDraft?.subCompanyId;
        const tabAgency =
          selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
            ? selectedAgencyId
            : '';
        const preferred =
          (draftAgency && withEmails.some((a) => a.subCompanyId === draftAgency) ? draftAgency : '') ||
          (tabAgency && withEmails.some((a) => a.subCompanyId === tabAgency) ? tabAgency : '') ||
          withEmails[0]?.subCompanyId ||
          '';
        if (preferred) setFromSubCompanyId(preferred);
      })
      .catch(() => {
        if (!cancelled) setOmAgencies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isOM, selectedAgencyId, editDraft?.subCompanyId]);

  // When agency tab changes while OM-self is active, re-sync From to that agency's email.
  useEffect(() => {
    if (!open || !isOM || replyAsUserId) return;
    if (!selectedAgencyId || selectedAgencyId === 'all' || selectedAgencyId === 'me') return;
    if (omAgencies.some((a) => a.subCompanyId === selectedAgencyId && a.agencyEmail)) {
      setFromSubCompanyId(selectedAgencyId);
    }
  }, [selectedAgencyId, open, isOM, replyAsUserId, omAgencies]);

  const searchClients = useCallback(
    async (q: string) => {
      if (q.trim().length < 2) {
        setClientOptions([]);
        return;
      }
      setClientSearchLoading(true);
      try {
        const { data } = await fetchClients({
          search: q.trim(),
          limit: 30,
        });
        const options: ContactOption[] = [];
        for (const client of data) {
          // Skip clients redacted due to lead-lock (held by another associate)
          if ((client as { heldByOtherAssociate?: boolean }).heldByOtherAssociate) continue;
          const contacts = (client as { contacts?: Array<{ id: string; name: string; title?: string; email?: string; isPrimary?: boolean }> }).contacts ?? [];
          for (const c of contacts) {
            if (c.email) {
              options.push({
                clientId: client.id,
                contactId: c.id,
                clientName: client.name,
                contactName: c.name,
                contactTitle: c.title ?? '',
                email: c.email,
              });
            }
          }
        }
        setClientOptions(options);
      } catch {
        setClientOptions([]);
      } finally {
        setClientSearchLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (open && !isReply) loadTemplates();
  }, [open, isReply, loadTemplates]);


  // Search when user types; skip when we have default client and search is still empty (keep pre-filled options)
  useEffect(() => {
    if (!open || hasFixedRecipient) return;
    if (defaultClientId && !clientSearch.trim()) return;
    const t = setTimeout(() => searchClients(clientSearch), 300);
    return () => clearTimeout(t);
  }, [clientSearch, open, defaultClientId, hasFixedRecipient, searchClients]);

  // When opening with default client/contact: fetch full client and pre-select primary or specified contact
  useEffect(() => {
    if (!open || !defaultClientId || isReply || hasFixedRecipient) return;
    let cancelled = false;
    setSubject('');
    setClientSearch('');
    (async () => {
      try {
        const client = await fetchClient(defaultClientId);
        if (cancelled || !client) return;
        const contacts = client.contacts ?? [];
        const withEmail = contacts.filter((c) => c.email?.trim());
        const options: ContactOption[] = withEmail.map((c) => ({
          clientId: client.id,
          contactId: c.id,
          clientName: client.name,
          contactName: c.name,
          contactTitle: c.title ?? '',
          email: c.email ?? '',
        }));
        setClientOptions(options);
        const primary = withEmail.find((c) => (c as { isPrimary?: boolean }).isPrimary);
        const byId = defaultContactId ? withEmail.find((c) => c.id === defaultContactId) : null;
        const chosen = byId ?? primary ?? withEmail[0];
        if (chosen) {
          setSelectedContact({
            clientId: client.id,
            contactId: chosen.id,
            clientName: client.name,
            contactName: chosen.name,
            contactTitle: chosen.title ?? '',
            email: chosen.email ?? '',
          });
        } else {
          setSelectedContact(null);
        }
      } catch {
        if (!cancelled) setClientOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, defaultClientId, defaultContactId, isReply, hasFixedRecipient]);

  useEffect(() => {
    if (!open) {
      setAttachments([]);
      setReplyAsUserId('');
      return;
    }
    if (editDraft) {
      setSubject(editDraft.subject === '(No subject)' ? '' : editDraft.subject);
      setBody(editDraft.body ?? '');
      setSelectedContact(null);
      setSelectedTemplateId('');
    } else if (replyTo) {
      setSubject(replyTo.subject.startsWith('RE:') ? replyTo.subject : `RE: ${replyTo.subject}`);
      setBody('');
      setSelectedContact(null);
    } else if (hasFixedRecipient) {
      setSubject(defaultSubject ?? '');
      setBody(defaultBody ?? '');
      setSelectedContact(null);
      setSelectedTemplateId('');
      setClientSearch('');
    } else if (defaultSubject != null || defaultBody != null) {
      setSubject(defaultSubject ?? '');
      setBody(defaultBody ?? '');
      setSelectedContact(null);
      setSelectedTemplateId('');
      setClientSearch('');
    } else if (!defaultClientId) {
      setSubject('');
      setBody('');
      setSelectedContact(null);
      setSelectedTemplateId('');
      setClientSearch('');
    }
  }, [open, replyTo, defaultClientId, editDraft, hasFixedRecipient, defaultSubject, defaultBody]);

  const handleTemplateSelect = (template: ApiEmailTemplate) => {
    setSelectedTemplateId(template.id);
    setSubject(template.subject);
    const fullBody = recoverPastedEmailHtml(
      [template.headerHtml, template.bodyHtml, template.footerHtml].filter(Boolean).join('\n'),
    );
    const combinedFooter = [currentSubCompany?.emailFooterText?.trim(), currentSubCompany?.emailTagline?.trim()].filter(Boolean).join(' · ') || null;
    setBody(applyAgencyFooter(fullBody, combinedFooter));
    toast.success(`"${template.name}" template loaded – you can edit below`);
  };

  const handleAttachmentSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (!picked.length) return;

    const result = validateEmailAttachmentSelection(attachments, picked);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setAttachments(result.files);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const resolvedSubCompanyId =
        isOM && !replyAsUserId
          ? fromSubCompanyId ||
            (selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
              ? selectedAgencyId
              : undefined) ||
            undefined
          : undefined;
      const payload = {
        subject: subject.trim() || undefined,
        body: body.trim() || undefined,
        ...(hasFixedRecipient
          ? {
              to: effectiveFixedRecipients.map((r) => ({
                email: r.email,
                name: r.name || r.email,
              })),
            }
          : selectedContact
            ? { to: [{ contactId: selectedContact.contactId, clientId: selectedContact.clientId }] }
            : {}),
        clientId: selectedContact?.clientId ?? editDraft?.clientId ?? undefined,
        subCompanyId: resolvedSubCompanyId,
      };
      if (editDraft?.id) {
        await updateEmailDraft(editDraft.id, payload);
        toast.success('Draft updated');
      } else {
        await saveEmailDraft(payload);
        toast.success('Draft saved');
      }
      onOpenChange(false);
      onDraftSaved?.();
      setSubject('');
      setBody('');
      setSelectedContact(null);
      setSelectedTemplateId('');
      setAttachments([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save draft');
    } finally {
      setSavingDraft(false);
    }
  };

  const handleSend = async () => {
    if (isReply) {
      if (!replyTo?.from?.email) {
        toast.error('Cannot determine recipient');
        return;
      }
    } else if (hasFixedRecipient) {
      if (effectiveFixedRecipients.length === 0) {
        toast.error('Cannot determine recipient');
        return;
      }
    } else {
      if (!selectedContact?.email) {
        toast.error('Please select a recipient (client contact)');
        return;
      }
    }
    if (!subject.trim()) {
      toast.error('Please add a subject');
      return;
    }
    if (!body.trim() && attachments.length === 0) {
      toast.error('Please write an email body or attach a file');
      return;
    }

    setSending(true);
    try {
      // OM-self only: prefer manually chosen From agency, else tab context.
      const resolvedSubCompanyId: string | undefined =
        isOM && !replyAsUserId
          ? fromSubCompanyId ||
            (selectedAgencyId && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
              ? selectedAgencyId
              : undefined) ||
            undefined
          : undefined;

      const encodedAttachments = attachments.length
        ? await Promise.all(
            attachments.map(async (file) => ({
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              data: await fileToBase64(file),
            })),
          )
        : undefined;

      const bodyHtml = body.trim()
        ? (body.trim().startsWith('<') ? body.trim() : `<p>${body.trim().replace(/\n/g, '</p><p>')}</p>`)
        : '<p></p>';

      const payload = {
        subject: subject.trim(),
        body: bodyHtml,
        clientId: isReply
          ? (replyTo as ReplyToEmail).clientId
          : hasFixedRecipient
            ? undefined
            : selectedContact?.clientId,
        inReplyTo: replyTo && 'id' in replyTo ? (replyTo as ApiEmailDetail).id : undefined,
        subCompanyId: resolvedSubCompanyId,
        attachments: encodedAttachments,
        replyAsUserId: replyAsUserId || undefined,
      };
      if (isReply && replyTo?.from) {
        await sendEmail({
          ...payload,
          to: [{ email: replyTo.from.email, name: replyTo.from.name }],
        });
      } else if (hasFixedRecipient) {
        await sendEmail({
          ...payload,
          to: effectiveFixedRecipients.map((r) => ({
            email: r.email,
            name: r.name || r.email,
          })),
        });
      } else if (selectedContact) {
        await sendEmail({
          ...payload,
          to: [{ contactId: selectedContact.contactId, clientId: selectedContact.clientId }],
        });
      }
      // If we were editing a draft, delete it now that the email was sent
      if (editDraft?.id) {
        await deleteEmailDraft(editDraft.id).catch(() => {});
      }
      toast.success('Email sent');
      onOpenChange(false);
      onSent?.();
      setSubject('');
      setBody('');
      setSelectedContact(null);
      setSelectedTemplateId('');
      setAttachments([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send email');
    } finally {
      setSending(false);
    }
  };

  const handleInsertBookingLink = (text: string) => {
    setBody((prev) => prev + text);
  };


  const fixedRecipientTooltip = effectiveFixedRecipients
    .map((r) => (r.name ? `${r.name} <${r.email}>` : r.email))
    .join(', ');
  const displayRecipient = isReply
    ? replyTo?.from?.name
      ? `${replyTo.from.name} <${replyTo.from.email}>`
      : replyTo?.from?.email ?? ''
    : hasFixedRecipient
      ? effectiveFixedRecipients.length === 1
        ? effectiveFixedRecipients[0].name
          ? `${effectiveFixedRecipients[0].name} <${effectiveFixedRecipients[0].email}>`
          : effectiveFixedRecipients[0].email
        : `${effectiveFixedRecipients.length} recipients`
      : selectedContact
        ? `${selectedContact.clientName} – ${selectedContact.contactName}${selectedContact.contactTitle ? ` (${selectedContact.contactTitle})` : ''}`
        : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1240px] w-full h-[94vh] overflow-hidden flex flex-col gap-0 p-0 [&>button]:text-white/70 [&>button]:top-3 [&>button]:right-4 [&>button]:hover:text-white">

        {/* ── DARK HEADER ── */}
        <div className="px-6 h-[52px] bg-gradient-to-r from-indigo-700 to-blue-500 flex items-center shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-[30px] h-[30px] bg-white/10 rounded-lg flex items-center justify-center shrink-0">
              <Mail className="h-3.5 w-3.5 text-white/80" />
            </div>
            <div>
              <DialogTitle className="text-white text-sm font-semibold leading-tight tracking-normal">
                {isReply ? 'Reply to Email' : editDraft ? 'Edit Draft' : 'Compose Email'}
              </DialogTitle>
              <p className="text-white/50 text-[11px] mt-0.5">Message body left · Settings right</p>
            </div>
          </div>
        </div>

        {/* ── META STRIP: To / From / Subject ── */}
        <div className="border-b shrink-0 bg-white">

          {/* To row */}
          <div className="flex items-start min-h-[38px] border-b border-slate-100 px-5 gap-3 py-2">
            <span className="text-[10px] font-semibold text-slate-400 w-14 shrink-0 uppercase tracking-wider pt-1">To</span>
            {isReply ? (
              <span className="text-sm text-slate-700 truncate">{displayRecipient}</span>
            ) : hasFixedRecipient ? (
              <div className="flex-1 min-w-0 flex flex-col gap-1">
                {effectiveFixedRecipients.length > 1 && (
                  <span className="text-[11px] font-medium text-slate-500">
                    {effectiveFixedRecipients.length} recipients
                  </span>
                )}
                <div
                  className="max-h-[88px] overflow-y-auto overscroll-contain pr-1"
                  title={fixedRecipientTooltip}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {effectiveFixedRecipients.map((r) => (
                      <span
                        key={r.email.toLowerCase()}
                        className="inline-flex max-w-full items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-0.5 text-xs text-blue-800"
                      >
                        {r.name ? (
                          <>
                            <span className="font-medium truncate max-w-[140px]">{r.name}</span>
                            <span className="text-blue-500/80 truncate max-w-[220px]">&lt;{r.email}&gt;</span>
                          </>
                        ) : (
                          <span className="font-medium truncate max-w-[280px]">{r.email}</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <Popover open={recipientOpen} onOpenChange={setRecipientOpen}>
                <PopoverTrigger asChild>
                  <button
                    role="combobox"
                    aria-expanded={recipientOpen}
                    className="flex-1 text-left py-0 h-auto border-0 bg-transparent cursor-pointer focus:outline-none"
                  >
                    {displayRecipient
                      ? <span className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 rounded-full px-3 py-0.5 text-xs font-medium text-blue-700">{displayRecipient}</span>
                      : <span className="text-slate-300 italic text-sm">Search client or contact…</span>
                    }
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[820px] p-0 shadow-xl border border-slate-200 rounded-xl overflow-hidden" align="start">
                  <Command shouldFilter={false}>
                    <div className="flex items-center gap-2 px-3 border-b border-slate-100 bg-slate-50/80">
                      <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <CommandInput
                        placeholder="Search by client or contact name..."
                        value={clientSearch}
                        onValueChange={setClientSearch}
                        className="border-0 shadow-none focus:ring-0 bg-transparent text-sm py-3 pl-0"
                      />
                      {clientSearchLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />}
                    </div>
                    <CommandList className="max-h-[320px]">
                      <CommandEmpty>
                        <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                          <svg className="h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
                          </svg>
                          <span className="text-sm">
                            {clientSearch.trim().length < 2 ? 'Type at least 2 characters to search' : 'No contacts found'}
                          </span>
                        </div>
                      </CommandEmpty>
                      <CommandGroup className="p-1.5">
                        {clientOptions.map((opt) => (
                          <CommandItem
                            key={`${opt.clientId}-${opt.contactId}`}
                            value={`${opt.clientName} ${opt.contactName} ${opt.contactTitle}`}
                            onSelect={() => {
                              setSelectedContact(opt);
                              setRecipientOpen(false);
                            }}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                          >
                            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shrink-0 text-white text-sm font-semibold">
                              {opt.clientName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="font-semibold text-sm text-slate-800 truncate group-data-[selected=true]:text-white">{opt.clientName}</span>
                              <span className="text-xs text-slate-400 truncate group-data-[selected=true]:text-white/80">
                                {opt.contactName}
                                {opt.contactTitle ? <span className="text-slate-300 group-data-[selected=true]:text-white/70"> · {opt.contactTitle}</span> : null}
                                <span className="text-slate-300 group-data-[selected=true]:text-white/70"> · </span>
                                <span className="text-indigo-400 group-data-[selected=true]:text-white/90">{opt.email}</span>
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* From row */}
          <div className="flex items-center min-h-[38px] border-b border-slate-100 px-5 gap-3">
            <span className="text-[10px] font-semibold text-slate-400 w-14 shrink-0 uppercase tracking-wider">From</span>
            {replyAsUsers.length > 0 || (omSelfMode && omEmails.length > 0) ? (
              <Popover open={fromPopoverOpen} onOpenChange={setFromPopoverOpen}>
                <PopoverTrigger asChild>
                  <button className="flex items-center gap-1.5 text-sm text-slate-700 bg-transparent border-0 p-0 h-auto cursor-pointer hover:text-slate-900 focus:outline-none">
                    {replyAsUserId
                      ? (() => {
                          const u = replyAsUsers.find((u) => u.id === replyAsUserId);
                          return u ? `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} — ${u.email}` : 'Select user';
                        })()
                      : selfFromLabel}
                    <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[820px] p-0 shadow-xl border border-slate-200 rounded-xl overflow-hidden" align="start">
                  <Command>
                    <div className="flex items-center gap-2 px-3 border-b border-slate-100 bg-slate-50/80">
                      <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                      </svg>
                      <CommandInput placeholder="Search by name or email..." className="border-0 shadow-none focus:ring-0 bg-transparent text-sm py-3 pl-0" />
                    </div>
                    <CommandList className="max-h-[320px]" onWheel={e => e.stopPropagation()}>
                      <CommandEmpty>
                        <div className="flex flex-col items-center gap-2 py-8 text-slate-400">
                          <svg className="h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                          </svg>
                          <span className="text-sm">No users found</span>
                        </div>
                      </CommandEmpty>
                      <CommandGroup className="p-1.5">
                        {/* Me / OM self agency emails — selecting these clears reply-as */}
                        {isOM && omEmails.length > 0 ? (
                          omEmails.map((a) => {
                            const isSelected = !replyAsUserId && fromSubCompanyId === a.subCompanyId;
                            return (
                              <CommandItem
                                key={a.subCompanyId}
                                value={`${effectiveFromName} ${a.name} ${a.agencyEmail}`}
                                onSelect={() => {
                                  setReplyAsUserId('');
                                  setFromSubCompanyId(a.subCompanyId);
                                  setFromPopoverOpen(false);
                                }}
                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                              >
                                <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shrink-0 text-white text-sm font-semibold">
                                  {effectiveFromName.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-semibold text-sm text-slate-800 truncate group-data-[selected=true]:text-white">{effectiveFromName}</span>
                                    <span className="text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full group-data-[selected=true]:bg-white/20 group-data-[selected=true]:text-white group-data-[selected=true]:border-white/30">Me</span>
                                    {isSelected && (
                                      <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full group-data-[selected=true]:bg-white/20 group-data-[selected=true]:text-white group-data-[selected=true]:border-white/30">Selected</span>
                                    )}
                                  </div>
                                  <span className="text-xs text-indigo-400 truncate group-data-[selected=true]:text-white/90">{a.agencyEmail}</span>
                                  <span className="text-[10px] text-slate-400 truncate group-data-[selected=true]:text-white/75">{a.name}</span>
                                </div>
                              </CommandItem>
                            );
                          })
                        ) : (
                          <CommandItem value="myself" onSelect={() => { setReplyAsUserId(''); setFromPopoverOpen(false); }} className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer">
                            <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center shrink-0 text-white text-sm font-semibold">
                              {effectiveFromName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-sm text-slate-800 truncate group-data-[selected=true]:text-white">{effectiveFromName}</span>
                                <span className="text-[10px] font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 px-1.5 py-0.5 rounded-full group-data-[selected=true]:bg-white/20 group-data-[selected=true]:text-white group-data-[selected=true]:border-white/30">Me</span>
                              </div>
                              <span className="text-xs text-indigo-400 truncate group-data-[selected=true]:text-white/90">{selfFromEmail}</span>
                            </div>
                          </CommandItem>
                        )}
                        {visibleReplyAsUsers.map((u) => {
                          const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
                          return (
                            <CommandItem
                              key={u.id}
                              value={`${name} ${u.email}`}
                              onSelect={() => { setReplyAsUserId(u.id); setFromPopoverOpen(false); }}
                              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer"
                            >
                              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shrink-0 text-white text-sm font-semibold">
                                {name.charAt(0).toUpperCase()}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="font-semibold text-sm text-slate-800 truncate group-data-[selected=true]:text-white">{name}</span>
                                <span className="text-xs text-indigo-400 truncate group-data-[selected=true]:text-white/90">{u.email}</span>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
              <span className="text-sm">
                <span className="font-medium text-slate-800">{effectiveFromName}</span>
                <span className="text-slate-400 mx-1.5">—</span>
                <span className="text-slate-500">{selfFromEmail}</span>
              </span>
            )}
          </div>

          {/* Subject row */}
          <div className="flex items-center min-h-[38px] px-5 gap-3">
            <span className="text-[10px] font-semibold text-slate-400 w-14 shrink-0 uppercase tracking-wider">Subject</span>
            <Input
              id="subject"
              placeholder="Enter email subject…"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="border-0 shadow-none focus-visible:ring-0 p-0 flex-1 font-medium text-sm h-auto"
            />
          </div>

        </div>

        {/* ── TWO-PANEL BODY ── */}
        <div className="flex flex-1 min-h-0">

          {/* LEFT: full-height editor */}
          <div className="flex-1 flex flex-col min-h-0">
            <EmailRichTextEditor
              value={body}
              onChange={setBody}
              placeholder="Write your email…"
              stretch
            />
          </div>

          {/* RIGHT: 300px sidebar */}
          <div className="w-[300px] shrink-0 border-l overflow-y-auto bg-slate-50/60 flex flex-col">

            {/* Template section */}
            {!isReply && (
              <div className="border-b">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white/70">
                  <div className="w-6 h-6 bg-violet-50 rounded-md flex items-center justify-center shrink-0">
                    <FileText className="h-3 w-3 text-violet-500" />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">Email Template</span>
                </div>
                <div className="px-4 py-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-between font-normal text-xs h-8" disabled={templatesLoading}>
                        {templatesLoading ? (
                          <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading…</span>
                        ) : selectedTemplateId ? (
                          templates.find((t) => t.id === selectedTemplateId)?.name ?? 'Select template'
                        ) : (
                          <span className="text-muted-foreground">Select a template…</span>
                        )}
                        <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[260px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Search templates..." />
                        <CommandList>
                          <CommandEmpty>No templates found</CommandEmpty>
                          {templates.some((t) => t.ownerUserId) && (
                            <CommandGroup heading="My templates">
                              {templates.filter((t) => t.ownerUserId).map((t) => (
                                <CommandItem key={t.id} onSelect={() => handleTemplateSelect(t)}>
                                  <div className="flex flex-col">
                                    <span>{t.name}</span>
                                    <span className="text-xs text-muted-foreground truncate">{t.subject}</span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                          <CommandGroup heading={templates.some((t) => t.ownerUserId) ? 'Shared' : undefined}>
                            {templates.filter((t) => !t.ownerUserId).map((t) => (
                              <CommandItem key={t.id} onSelect={() => handleTemplateSelect(t)}>
                                <div className="flex flex-col">
                                  <span>{t.name}</span>
                                  <span className="text-xs text-muted-foreground truncate">{t.subject}</span>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            )}

            {/* Attachments section */}
            <div className="border-b">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white/70">
                <div className="w-6 h-6 bg-orange-50 rounded-md flex items-center justify-center shrink-0">
                  <Paperclip className="h-3 w-3 text-orange-500" />
                </div>
                <span className="text-xs font-semibold text-slate-500">Attachments</span>
                {attachments.length > 0 && (
                  <span className="ml-auto text-[10px] font-semibold bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full">
                    {attachments.length}
                  </span>
                )}
              </div>
              <div className="px-4 py-3 space-y-2">
                <input
                  ref={attachmentInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept={EMAIL_ATTACHMENT_ACCEPT}
                  onChange={handleAttachmentSelect}
                />
                {attachments.length > 0 && (
                  <div className="space-y-1.5">
                    {attachments.map((file, index) => {
                      const isImage = isEmailImageMime(file.type, file.name);
                      const isVideo = isEmailVideoMime(file.type, file.name);
                      const Icon = isImage ? ImageIcon : isVideo ? Film : FileText;
                      return (
                        <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-md border bg-white px-2.5 py-1.5">
                          {isImage ? (
                            <img
                              src={URL.createObjectURL(file)}
                              alt=""
                              className="h-7 w-7 rounded object-cover shrink-0"
                              onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                            />
                          ) : (
                            <div className="h-7 w-7 rounded bg-muted flex items-center justify-center shrink-0">
                              <Icon className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{file.name}</p>
                            <p className="text-[10px] text-muted-foreground">{formatEmailFileSize(file.size)}</p>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => removeAttachment(index)}
                            disabled={sending || savingDraft}
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full gap-2 text-xs justify-start text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 h-7 px-2"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={sending || savingDraft || attachments.length >= 10}
                >
                  <Paperclip className="h-3 w-3" />
                  Add file
                </Button>
              </div>
            </div>

            {/* Booking link section */}
            {!isReply && (
              <div className="border-b">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-100 bg-white/70">
                  <div className="w-6 h-6 bg-blue-50 rounded-md flex items-center justify-center shrink-0">
                    <Calendar className="h-3 w-3 text-blue-500" />
                  </div>
                  <span className="text-xs font-semibold text-slate-500">Booking Link</span>
                </div>
                <Collapsible open={meetingOptionsOpen} onOpenChange={setMeetingOptionsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="w-full justify-between text-xs text-slate-500 hover:bg-slate-100 rounded-none px-4 h-9">
                      <span>Insert a booking link</span>
                      {meetingOptionsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-4 pb-3">
                    <MeetingScheduleSection
                      onInsertMeetingLink={handleInsertBookingLink}
                      onInsertBookingLink={handleInsertBookingLink}
                    />
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            <div className="flex-1" />

            {/* Signature notice */}
            <div className="m-4 flex items-start gap-2.5 p-3 bg-green-50 border border-green-200 rounded-lg">
              <PenLine className="h-3.5 w-3.5 text-green-600 shrink-0 mt-0.5" />
              <span className="text-[11px] text-green-700 leading-relaxed">
                <span className="font-semibold">Best regards, [your name]</span> + signature auto-appended on send.
              </span>
            </div>

          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className="px-6 py-3 border-t shrink-0 flex justify-between items-center bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending || savingDraft}>
            Cancel
          </Button>
          <div className="flex gap-2">
            {!isReply && (
              <Button variant="outline" onClick={handleSaveDraft} disabled={sending || savingDraft}>
                {savingDraft ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                Save Draft
              </Button>
            )}
            <Button onClick={handleSend} disabled={sending || savingDraft}>
              {sending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Email
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}
