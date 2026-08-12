import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Mail, Send, Inbox, FileText, Reply, Plus, Search, X, PenLine, Trash2, Star, Check, Upload, Eye, Pencil, ArrowLeft, TrendingUp, Paperclip, UserCheck, LayoutTemplate } from 'lucide-react';
import { useClientPagination, SectionPaginationBar } from '@/components/SectionPagination';
import { ForwardedChip } from '@/components/offboarding/ForwardedChip';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { EmailComposeDialog } from '@/components/EmailComposeDialog';
import { CustomEmailTemplatesSheet } from '@/components/email/CustomEmailTemplatesSheet';
import { EmailRichTextEditor } from '@/components/EmailRichTextEditor';
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
  fetchEmails,
  fetchEmailById,
  markEmailRead,
  fetchEmailUnreadCount,
  fetchEmailSignatures,
  createEmailSignature,
  updateEmailSignature,
  deleteEmailSignature,
  deleteEmail,
  type ApiEmailListItem,
  type ApiEmailDetail,
  type ApiEmailSignature,
  type ApiUser,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn, repairLegacyEmailBody } from '@/lib/utils';
import { ScopeFilterBar } from '@/components/ScopeFilterBar';
import { StickyHeader } from '@/components/StickyHeader';
import { useScopeFilter } from '@/hooks/useElevatedScopeFilter';
import { useScopeQueryParams } from '@/hooks/useScopeQueryParams';
import { useActAs } from '@/hooks/useActAs';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { onEmailRefresh } from '@/lib/socket';
import { useCanAccessMultipleAgencies, useHasPermission, useIsTeamManagerOnly } from '@/lib/access';
import { EmailAttachmentBar } from '@/components/EmailAttachmentBar';
import { PersonSectionHeader } from '@/components/PersonSectionHeader';
import { getUserRoleTitle } from '@/lib/roleLabels';

function EmailSubjectLine({
  subject,
  attachmentCount,
  className,
}: {
  subject: string;
  attachmentCount?: number;
  className?: string;
}) {
  if (!attachmentCount) {
    return <p className={className}>{subject}</p>;
  }
  return (
    <p className={cn(className, 'flex items-center gap-1 min-w-0')}>
      <span className="truncate">{subject}</span>
      <Paperclip className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
    </p>
  );
}

function DeleteEmailConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete email?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this email? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {isDeleting ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Per-agency email section (full view, rendered for each agency in "All" view) ──
function AgencyEmailsSection({
  agency,
  onViewAgency,
  ownerIds,
  scopeKey,
}: {
  agency: { id: string; name: string };
  onViewAgency: () => void;
  ownerIds?: string[];
  scopeKey: string;
}) {
  const { currentUser } = useStore();
  const [currentFolder, setCurrentFolder] = useState<'inbox' | 'sent' | 'drafts'>('inbox');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<ApiEmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [deletingEmailId, setDeletingEmailId] = useState<string | null>(null);
  const [emailToDelete, setEmailToDelete] = useState<string | null>(null);
  const canDeleteEmail = useHasPermission('emails:delete');

  const handleDeleteEmail = async (id: string) => {
    setDeletingEmailId(id);
    try {
      await deleteEmail(id);
      if (selectedEmail?.id === id) setSelectedEmail(null);
      refetch();
      toast.success('Email deleted');
    } catch {
      toast.error('Failed to delete email');
    } finally {
      setDeletingEmailId(null);
      setEmailToDelete(null);
    }
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['agency-emails-full', agency.id, currentFolder, scopeKey],
    queryFn: () => fetchEmails({ folder: currentFolder, agencyIds: [agency.id], ownerIds, limit: 100 }),
    staleTime: 0,
  });

  const emails = data?.data ?? [];
  const unreadCount = currentFolder === 'inbox' ? (data?.unreadCount ?? 0) : 0;

  const filteredEmails = emails.filter(
    e => searchQuery === '' ||
      e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.from.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.body || '').toLowerCase().replace(/<[^>]*>/g, '').includes(searchQuery.toLowerCase())
  );

  const {
    pageRows,
    startIndex,
    total,
    totalPages,
    page,
    setPage,
    pageSize,
    showPagination,
  } = useClientPagination(filteredEmails, [agency.id, currentFolder, searchQuery]);

  const handleSelectEmail = async (item: ApiEmailListItem) => {
    setLoadingDetail(true);
    setSelectedEmail(null);
    try {
      const detail = await fetchEmailById(item.id);
      setSelectedEmail(detail ?? null);
      if (detail && currentFolder === 'inbox' && !detail.isRead) {
        await markEmailRead(detail.id);
        refetch();
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const bodyPreview = (body: string) => {
    const stripped = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 120) + (stripped.length > 120 ? '…' : '');
  };

  return (
    <>
      <Card className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0 border-b">
          <div>
            <h3 className="font-semibold text-base">{agency.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {emails.length} in {currentFolder}
              {unreadCount > 0 ? ` · ${unreadCount} unread` : ''}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onViewAgency}>
            View Agency
          </Button>
        </div>
        <CardContent className="flex-1 overflow-hidden flex flex-col p-4 pt-3" style={{ minHeight: 0 }}>
          <div className="grid grid-cols-12 gap-4 flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            {/* Left: search + tabs + list */}
            <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Tabs
                value={currentFolder}
                onValueChange={(v) => { setCurrentFolder(v as 'inbox' | 'sent' | 'drafts'); setSelectedEmail(null); }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="inbox" className="gap-1.5">
                    <Inbox className="h-3.5 w-3.5" />Inbox
                    {unreadCount > 0 && (
                      <Badge variant="default" className="ml-1 h-4 w-4 rounded-full p-0 flex items-center justify-center text-[10px]">
                        {unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="sent" className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />Sent
                  </TabsTrigger>
                  <TabsTrigger value="drafts" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" />Drafts
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={currentFolder} className="mt-3">
                  <ScrollArea className="h-[calc(90vh-240px)]">
                    <div className="space-y-2 pr-2">
                      {isLoading ? (
                        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
                      ) : filteredEmails.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No emails in {currentFolder}</p>
                        </div>
                      ) : pageRows.map((email) => {
                        const isSelected = selectedEmail?.id === email.id;
                        return (
                          <Card
                            key={email.id}
                            className={cn(
                              'cursor-pointer hover:bg-accent/50 transition-colors',
                              isSelected && 'bg-accent',
                              !email.isRead && 'border-l-4 border-l-primary'
                            )}
                            onClick={() => handleSelectEmail(email)}
                          >
                            <CardContent className="p-3">
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between">
                                  <p className={cn('text-sm font-medium truncate flex-1 mr-2', !email.isRead && 'font-bold', isSelected && 'text-accent-foreground')}>
                                    {email.folder === 'sent' ? email.to[0]?.name : email.from.name}
                                  </p>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {!email.isRead && <Badge variant="default" className="text-[10px] py-0 px-1 h-4">New</Badge>}
                                    <span className={cn('text-[10px]', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>
                                      {format(new Date(email.timestamp), 'MMM d')}
                                    </span>
                                    {canDeleteEmail && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                        disabled={deletingEmailId === email.id}
                                        onClick={(e) => { e.stopPropagation(); setEmailToDelete(email.id); }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <EmailSubjectLine
                                  subject={email.subject}
                                  attachmentCount={email.attachmentCount}
                                  className={cn('text-xs truncate', !email.isRead && 'font-semibold', isSelected && 'text-accent-foreground')}
                                />
                                {email.forwardedFromName && (
                                  <ForwardedChip name={email.forwardedFromName} className="text-[10px]" />
                                )}
                                {email.sentBy && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                                    <UserCheck className="h-3 w-3 shrink-0" />
                                    {email.sentBy.id === currentUser?.id
                                      ? `You sent this as ${email.from.name}`
                                      : email.from.userId === currentUser?.id
                                        ? `Sent on your behalf by ${email.sentBy.name}`
                                        : `Sent by ${email.sentBy.name} as ${email.from.name}`}
                                  </span>
                                )}
                                <p className={cn('text-xs line-clamp-2', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>{bodyPreview(email.body)}</p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                      {showPagination && (
                        <SectionPaginationBar
                          total={total}
                          startIndex={startIndex}
                          pageLen={pageRows.length}
                          totalPages={totalPages}
                          page={page}
                          onPageChange={setPage}
                          pageSize={pageSize}
                        />
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            {/* Right: email detail */}
            <div className="col-span-8 flex flex-col overflow-hidden">
              {loadingDetail ? (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  </CardContent>
                </Card>
              ) : selectedEmail ? (
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardContent className="p-5 flex flex-col overflow-hidden" style={{ height: '100%' }}>
                    <div className="space-y-3 mb-4 shrink-0">
                      <div className="flex items-start justify-between">
                        <h2 className="text-xl font-semibold flex-1">{selectedEmail.subject}</h2>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedEmail(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-primary">
                            {selectedEmail.from.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedEmail.from.name}</p>
                            <span className="text-xs text-muted-foreground">{format(new Date(selectedEmail.timestamp), 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{selectedEmail.from.email}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">To: {selectedEmail.to.map(t => t.name).join(', ')}</p>
                          {(selectedEmail.sentBy || selectedEmail.originalSentBy) && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                              <UserCheck className="h-3 w-3 shrink-0" />
                              {selectedEmail.sentBy
                                ? selectedEmail.sentBy.id === currentUser?.id
                                  ? `You sent this as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Sent on your behalf by ${selectedEmail.sentBy.name}`
                                    : `Sent by ${selectedEmail.sentBy.name} as ${selectedEmail.from.name}`
                                : selectedEmail.originalSentBy!.id === currentUser?.id
                                  ? `You sent the original as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Reply to an email sent on your behalf by ${selectedEmail.originalSentBy!.name}`
                                    : `Reply to an email sent by ${selectedEmail.originalSentBy!.name} as ${selectedEmail.from.name}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <ScrollArea className="flex-1 my-4">
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: selectedEmail.body?.startsWith('<')
                            ? repairLegacyEmailBody(selectedEmail.body)
                            : `<p class="whitespace-pre-wrap">${(selectedEmail.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
                        }}
                      />
                    </ScrollArea>
                    <EmailAttachmentBar email={selectedEmail} />
                    <Separator className="mb-4" />
                    <div className="shrink-0">
                      <Button onClick={() => setReplyDialogOpen(true)}>
                        <Reply className="h-4 w-4 mr-2" />Reply
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Select an email to view</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <DeleteEmailConfirmDialog
        open={emailToDelete !== null}
        onOpenChange={(open) => { if (!open && !deletingEmailId) setEmailToDelete(null); }}
        onConfirm={() => { if (emailToDelete) void handleDeleteEmail(emailToDelete); }}
        isDeleting={deletingEmailId !== null}
      />
      <EmailComposeDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyTo={selectedEmail}
        selectedAgencyId={selectedEmail?.subCompanyId ?? agency.id}
        defaultReplyAsUserId={
          selectedEmail?.from.userId && selectedEmail.from.userId !== currentUser?.id
            ? selectedEmail.from.userId
            : undefined
        }
        onSent={() => { setReplyDialogOpen(false); refetch(); }}
      />
    </>
  );
}

// ─── Combined all-agencies email section ─────────────────────────────────────
function AllAgenciesEmailsSection({
  agencyIds,
  ownerIds,
  scopeKey,
}: {
  agencyIds: string[];
  ownerIds?: string[];
  scopeKey: string;
}) {
  const { currentUser } = useStore();
  const [currentFolder, setCurrentFolder] = useState<'inbox' | 'sent' | 'drafts'>('inbox');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<ApiEmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [deletingEmailId, setDeletingEmailId] = useState<string | null>(null);
  const [emailToDelete, setEmailToDelete] = useState<string | null>(null);
  const canDeleteEmail = useHasPermission('emails:delete');

  const handleDeleteEmail = async (id: string) => {
    setDeletingEmailId(id);
    try {
      await deleteEmail(id);
      if (selectedEmail?.id === id) setSelectedEmail(null);
      refetch();
      toast.success('Email deleted');
    } catch {
      toast.error('Failed to delete email');
    } finally {
      setDeletingEmailId(null);
      setEmailToDelete(null);
    }
  };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['all-agencies-emails-combined', agencyIds.join(','), currentFolder, scopeKey],
    queryFn: () => fetchEmails({ folder: currentFolder, agencyIds, ownerIds, limit: 100 }),
    staleTime: 0,
    enabled: agencyIds.length > 0,
  });

  const emails = data?.data ?? [];
  const unreadCount = currentFolder === 'inbox' ? (data?.unreadCount ?? 0) : 0;

  const filteredEmails = emails.filter(
    e => searchQuery === '' ||
      e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.from.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.body || '').toLowerCase().replace(/<[^>]*>/g, '').includes(searchQuery.toLowerCase())
  );

  const handleSelectEmail = async (item: ApiEmailListItem) => {
    setLoadingDetail(true);
    setSelectedEmail(null);
    try {
      const detail = await fetchEmailById(item.id);
      setSelectedEmail(detail ?? null);
      if (detail && currentFolder === 'inbox' && !detail.isRead) {
        await markEmailRead(detail.id);
        refetch();
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const bodyPreview = (body: string) => {
    const stripped = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 120) + (stripped.length > 120 ? '…' : '');
  };

  return (
    <>
      <Card className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <CardContent className="flex-1 overflow-hidden flex flex-col p-4" style={{ minHeight: 0 }}>
          <div className="grid grid-cols-12 gap-4 flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Tabs
                value={currentFolder}
                onValueChange={(v) => { setCurrentFolder(v as 'inbox' | 'sent' | 'drafts'); setSelectedEmail(null); }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="inbox" className="gap-1.5">
                    <Inbox className="h-3.5 w-3.5" />Inbox
                    {unreadCount > 0 && (
                      <Badge variant="default" className="ml-1 h-4 w-4 rounded-full p-0 flex items-center justify-center text-[10px]">
                        {unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="sent" className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />Sent
                  </TabsTrigger>
                  <TabsTrigger value="drafts" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" />Drafts
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={currentFolder} className="mt-3">
                  <ScrollArea className="h-[calc(90vh-240px)]">
                    <div className="space-y-2 pr-2">
                      {isLoading ? (
                        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
                      ) : filteredEmails.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No emails in {currentFolder}</p>
                        </div>
                      ) : filteredEmails.map((email) => {
                        const isSelected = selectedEmail?.id === email.id;
                        return (
                          <Card
                            key={email.id}
                            className={cn(
                              'cursor-pointer hover:bg-accent/50 transition-colors',
                              isSelected && 'bg-accent',
                              !email.isRead && 'border-l-4 border-l-primary'
                            )}
                            onClick={() => handleSelectEmail(email)}
                          >
                            <CardContent className="p-3">
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between">
                                  <p className={cn('text-sm font-medium truncate flex-1 mr-2', !email.isRead && 'font-bold', isSelected && 'text-accent-foreground')}>
                                    {email.folder === 'sent' ? email.to[0]?.name : email.from.name}
                                  </p>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {!email.isRead && <Badge variant="default" className="text-[10px] py-0 px-1 h-4">New</Badge>}
                                    <span className={cn('text-[10px]', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>
                                      {format(new Date(email.timestamp), 'MMM d')}
                                    </span>
                                    {canDeleteEmail && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                        disabled={deletingEmailId === email.id}
                                        onClick={(e) => { e.stopPropagation(); setEmailToDelete(email.id); }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <EmailSubjectLine
                                  subject={email.subject}
                                  attachmentCount={email.attachmentCount}
                                  className={cn('text-xs truncate', !email.isRead && 'font-semibold', isSelected && 'text-accent-foreground')}
                                />
                                {email.forwardedFromName && (
                                  <ForwardedChip name={email.forwardedFromName} className="text-[10px]" />
                                )}
                                {email.sentBy && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                                    <UserCheck className="h-3 w-3 shrink-0" />
                                    {email.sentBy.id === currentUser?.id
                                      ? `You sent this as ${email.from.name}`
                                      : email.from.userId === currentUser?.id
                                        ? `Sent on your behalf by ${email.sentBy.name}`
                                        : `Sent by ${email.sentBy.name} as ${email.from.name}`}
                                  </span>
                                )}
                                <p className={cn('text-xs line-clamp-2', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>{bodyPreview(email.body)}</p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            <div className="col-span-8 flex flex-col overflow-hidden">
              {loadingDetail ? (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  </CardContent>
                </Card>
              ) : selectedEmail ? (
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardContent className="p-5 flex flex-col overflow-hidden" style={{ height: '100%' }}>
                    <div className="space-y-3 mb-4 shrink-0">
                      <div className="flex items-start justify-between">
                        <h2 className="text-xl font-semibold flex-1">{selectedEmail.subject}</h2>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedEmail(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-primary">
                            {selectedEmail.from.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedEmail.from.name}</p>
                            <span className="text-xs text-muted-foreground">{format(new Date(selectedEmail.timestamp), 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{selectedEmail.from.email}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">To: {selectedEmail.to.map(t => t.name).join(', ')}</p>
                          {(selectedEmail.sentBy || selectedEmail.originalSentBy) && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                              <UserCheck className="h-3 w-3 shrink-0" />
                              {selectedEmail.sentBy
                                ? selectedEmail.sentBy.id === currentUser?.id
                                  ? `You sent this as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Sent on your behalf by ${selectedEmail.sentBy.name}`
                                    : `Sent by ${selectedEmail.sentBy.name} as ${selectedEmail.from.name}`
                                : selectedEmail.originalSentBy!.id === currentUser?.id
                                  ? `You sent the original as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Reply to an email sent on your behalf by ${selectedEmail.originalSentBy!.name}`
                                    : `Reply to an email sent by ${selectedEmail.originalSentBy!.name} as ${selectedEmail.from.name}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <ScrollArea className="flex-1 my-4">
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: selectedEmail.body?.startsWith('<')
                            ? repairLegacyEmailBody(selectedEmail.body)
                            : `<p class="whitespace-pre-wrap">${(selectedEmail.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
                        }}
                      />
                    </ScrollArea>
                    <EmailAttachmentBar email={selectedEmail} />
                    <Separator className="mb-4" />
                    <div className="shrink-0">
                      <Button onClick={() => setReplyDialogOpen(true)}>
                        <Reply className="h-4 w-4 mr-2" />Reply
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Select an email to view</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <DeleteEmailConfirmDialog
        open={emailToDelete !== null}
        onOpenChange={(open) => { if (!open && !deletingEmailId) setEmailToDelete(null); }}
        onConfirm={() => { if (emailToDelete) void handleDeleteEmail(emailToDelete); }}
        isDeleting={deletingEmailId !== null}
      />
      <EmailComposeDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyTo={selectedEmail}
        selectedAgencyId={selectedEmail?.subCompanyId}
        defaultReplyAsUserId={
          selectedEmail?.from.userId && selectedEmail.from.userId !== currentUser?.id
            ? selectedEmail.from.userId
            : undefined
        }
        onSent={() => { setReplyDialogOpen(false); refetch(); }}
      />
    </>
  );
}

// ─── Combined All-Team email view (manager "All Team" view) ─────────────────
// Inbox / sent / drafts all honor ownerIds for elevated + managers (backend).
function TeamEmailsSection({ teamUsers }: { teamUsers: ApiUser[] }) {
  const PAGE_SIZE = 10;
  const { currentUser } = useStore();
  const [currentFolder, setCurrentFolder] = useState<'inbox' | 'sent' | 'drafts'>('inbox');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmail, setSelectedEmail] = useState<ApiEmailDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [page, setPage] = useState(1);

  const [deletingEmailId, setDeletingEmailId] = useState<string | null>(null);
  const [emailToDelete, setEmailToDelete] = useState<string | null>(null);
  const canDeleteEmail = useHasPermission('emails:delete');

  const handleDeleteEmail = async (id: string) => {
    setDeletingEmailId(id);
    try {
      await deleteEmail(id);
      if (selectedEmail?.id === id) setSelectedEmail(null);
      refetch();
      toast.success('Email deleted');
    } catch {
      toast.error('Failed to delete email');
    } finally {
      setDeletingEmailId(null);
      setEmailToDelete(null);
    }
  };

  const ownerIds = useMemo(() => teamUsers.map(u => u.id), [teamUsers]);
  const ownerKey = ownerIds.join(',');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['team-emails-full', ownerKey, currentFolder],
    queryFn: () => fetchEmails({ folder: currentFolder, ownerIds, limit: 100 }),
    staleTime: 0,
    enabled: ownerIds.length > 0,
  });

  const emails = data?.data ?? [];
  const unreadCount = currentFolder === 'inbox' ? (data?.unreadCount ?? 0) : 0;

  const filteredEmails = emails.filter(
    e => searchQuery === '' ||
      e.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.from.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.body || '').toLowerCase().replace(/<[^>]*>/g, '').includes(searchQuery.toLowerCase())
  );

  useEffect(() => {
    setPage(1);
  }, [ownerKey, currentFolder, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredEmails.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageRows = filteredEmails.slice(startIndex, startIndex + PAGE_SIZE);

  const handleSelectEmail = async (item: ApiEmailListItem) => {
    setLoadingDetail(true);
    setSelectedEmail(null);
    try {
      const detail = await fetchEmailById(item.id);
      setSelectedEmail(detail ?? null);
      if (detail && currentFolder === 'inbox' && !detail.isRead) {
        await markEmailRead(detail.id);
        refetch();
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const bodyPreview = (body: string) => {
    const stripped = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 120) + (stripped.length > 120 ? '…' : '');
  };

  return (
    <>
      <Card className="flex flex-col" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b">
          <div>
            <h3 className="font-semibold text-base">Emails</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{emails.length} emails · {unreadCount} unread</p>
          </div>
        </div>
        <CardContent className="flex-1 overflow-hidden flex flex-col p-4" style={{ minHeight: 0 }}>
          <div className="grid grid-cols-12 gap-4 flex-1 overflow-hidden" style={{ minHeight: 0 }}>
            <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search emails..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Tabs
                value={currentFolder}
                onValueChange={(v) => { setCurrentFolder(v as 'inbox' | 'sent' | 'drafts'); setSelectedEmail(null); }}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="inbox" className="gap-1.5">
                    <Inbox className="h-3.5 w-3.5" />Inbox
                    {unreadCount > 0 && (
                      <Badge variant="default" className="ml-1 h-4 w-4 rounded-full p-0 flex items-center justify-center text-[10px]">
                        {unreadCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="sent" className="gap-1.5">
                    <Send className="h-3.5 w-3.5" />Sent
                  </TabsTrigger>
                  <TabsTrigger value="drafts" className="gap-1.5">
                    <FileText className="h-3.5 w-3.5" />Drafts
                  </TabsTrigger>
                </TabsList>
                <TabsContent value={currentFolder} className="mt-3">
                  <ScrollArea className="h-[calc(90vh-240px)]">
                    <div className="space-y-2 pr-2">
                      {isLoading ? (
                        <div className="text-center py-12 text-muted-foreground text-sm">Loading…</div>
                      ) : filteredEmails.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                          <Mail className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">No emails in {currentFolder}</p>
                        </div>
                      ) : (
                        <>
                          {pageRows.map((email) => {
                        const isSelected = selectedEmail?.id === email.id;
                        return (
                          <Card
                            key={email.id}
                            className={cn(
                              'cursor-pointer hover:bg-accent/50 transition-colors',
                              isSelected && 'bg-accent',
                              !email.isRead && 'border-l-4 border-l-primary'
                            )}
                            onClick={() => handleSelectEmail(email)}
                          >
                            <CardContent className="p-3">
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between">
                                  <p className={cn('text-sm font-medium truncate flex-1 mr-2', !email.isRead && 'font-bold', isSelected && 'text-accent-foreground')}>
                                    {email.folder === 'sent' ? email.to[0]?.name : email.from.name}
                                  </p>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {!email.isRead && <Badge variant="default" className="text-[10px] py-0 px-1 h-4">New</Badge>}
                                    <span className={cn('text-[10px]', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>
                                      {format(new Date(email.timestamp), 'MMM d')}
                                    </span>
                                    {canDeleteEmail && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                        disabled={deletingEmailId === email.id}
                                        onClick={(e) => { e.stopPropagation(); setEmailToDelete(email.id); }}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                                <EmailSubjectLine
                                  subject={email.subject}
                                  attachmentCount={email.attachmentCount}
                                  className={cn('text-xs truncate', !email.isRead && 'font-semibold', isSelected && 'text-accent-foreground')}
                                />
                                {email.forwardedFromName && (
                                  <ForwardedChip name={email.forwardedFromName} className="text-[10px]" />
                                )}
                                {email.sentBy && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                                    <UserCheck className="h-3 w-3 shrink-0" />
                                    {email.sentBy.id === currentUser?.id
                                      ? `You sent this as ${email.from.name}`
                                      : email.from.userId === currentUser?.id
                                        ? `Sent on your behalf by ${email.sentBy.name}`
                                        : `Sent by ${email.sentBy.name} as ${email.from.name}`}
                                  </span>
                                )}
                                <p className={cn('text-xs line-clamp-2', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>{bodyPreview(email.body)}</p>
                              </div>
                            </CardContent>
                          </Card>
                        );
                          })}
                          {filteredEmails.length > PAGE_SIZE && (
                            <div className="flex flex-col gap-2 pt-3 mt-2 border-t">
                              <div className="text-xs text-muted-foreground">
                                Showing {startIndex + 1} to {Math.min(startIndex + pageRows.length, filteredEmails.length)} of {filteredEmails.length}
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                                  disabled={safePage === 1}
                                >
                                  Previous
                                </Button>
                                <div className="flex items-center gap-1">
                                  {(() => {
                                    const maxButtons = 7;
                                    const start =
                                      totalPages <= maxButtons
                                        ? 1
                                        : Math.min(Math.max(1, safePage - 3), totalPages - maxButtons + 1);
                                    const end = Math.min(start + maxButtons - 1, totalPages);
                                    return Array.from({ length: end - start + 1 }, (_, i) => start + i).map((p) => (
                                      <Button
                                        key={p}
                                        variant={safePage === p ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setPage(p)}
                                        className="min-w-[36px]"
                                      >
                                        {p}
                                      </Button>
                                    ));
                                  })()}
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                  disabled={safePage === totalPages}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            </div>

            <div className="col-span-8 flex flex-col overflow-hidden">
              {loadingDetail ? (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-32">
                    <p className="text-muted-foreground text-sm">Loading…</p>
                  </CardContent>
                </Card>
              ) : selectedEmail ? (
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardContent className="p-5 flex flex-col overflow-hidden" style={{ height: '100%' }}>
                    <div className="space-y-3 mb-4 shrink-0">
                      <div className="flex items-start justify-between">
                        <h2 className="text-xl font-semibold flex-1">{selectedEmail.subject}</h2>
                        <Button variant="ghost" size="icon" onClick={() => setSelectedEmail(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <span className="text-xs font-semibold text-primary">
                            {selectedEmail.from.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedEmail.from.name}</p>
                            <span className="text-xs text-muted-foreground">{format(new Date(selectedEmail.timestamp), 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{selectedEmail.from.email}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">To: {selectedEmail.to.map(t => t.name).join(', ')}</p>
                          {(selectedEmail.sentBy || selectedEmail.originalSentBy) && (
                            <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                              <UserCheck className="h-3 w-3 shrink-0" />
                              {selectedEmail.sentBy
                                ? selectedEmail.sentBy.id === currentUser?.id
                                  ? `You sent this as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Sent on your behalf by ${selectedEmail.sentBy.name}`
                                    : `Sent by ${selectedEmail.sentBy.name} as ${selectedEmail.from.name}`
                                : selectedEmail.originalSentBy!.id === currentUser?.id
                                  ? `You sent the original as ${selectedEmail.from.name}`
                                  : selectedEmail.from.userId === currentUser?.id
                                    ? `Reply to an email sent on your behalf by ${selectedEmail.originalSentBy!.name}`
                                    : `Reply to an email sent by ${selectedEmail.originalSentBy!.name} as ${selectedEmail.from.name}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Separator />
                    <ScrollArea className="flex-1 my-4">
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{
                          __html: selectedEmail.body?.startsWith('<')
                            ? repairLegacyEmailBody(selectedEmail.body)
                            : `<p class="whitespace-pre-wrap">${(selectedEmail.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
                        }}
                      />
                    </ScrollArea>
                    <EmailAttachmentBar email={selectedEmail} />
                    <Separator className="mb-4" />
                    <div className="shrink-0">
                      <Button onClick={() => setReplyDialogOpen(true)}>
                        <Reply className="h-4 w-4 mr-2" />Reply
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="flex-1">
                  <CardContent className="flex items-center justify-center h-full">
                    <div className="text-center text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>Select an email to view</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <DeleteEmailConfirmDialog
        open={emailToDelete !== null}
        onOpenChange={(open) => { if (!open && !deletingEmailId) setEmailToDelete(null); }}
        onConfirm={() => { if (emailToDelete) void handleDeleteEmail(emailToDelete); }}
        isDeleting={deletingEmailId !== null}
      />
      <EmailComposeDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyTo={selectedEmail}
        selectedAgencyId={selectedEmail?.subCompanyId}
        defaultReplyAsUserId={
          selectedEmail?.from.userId && selectedEmail.from.userId !== currentUser?.id
            ? selectedEmail.from.userId
            : undefined
        }
        onSent={() => { setReplyDialogOpen(false); refetch(); }}
      />
    </>
  );
}

export default function Emails() {
  const { currentSubCompany, setUnreadEmailsCount, currentUser } = useStore();
  const [selectedEmail, setSelectedEmail] = useState<ApiEmailDetail | null>(null);
  const [currentFolder, setCurrentFolder] = useState<'inbox' | 'sent' | 'drafts'>('inbox');

  const canComposeEmail = useHasPermission('clients:write');
  const canDeleteEmail = useHasPermission('emails:delete');
  const actAs = useActAs();
  const [deletingEmailId, setDeletingEmailId] = useState<string | null>(null);
  const [emailToDelete, setEmailToDelete] = useState<string | null>(null);

  const scopeFilter = useScopeFilter();
  const {
    isElevated,
    showHierarchyFilters,
    isAgencyHierarchyViewer,
    isPureManager,
    agencies,
    selectedAgencyId,
    selectedLeaderId,
    selectedManagerId,
    selectedUserId,
    setSelectedAgencyId,
    setSelectedManagerId,
    setSelectedUserId,
    onlyMe,
    getAssociatesForManager,
    getUsersForLeader,
    teamUsers: managerTeamUsers,
    showAllTeamView,
    showAgencySections,
    showManagerSections,
    filterRowProps,
    leaderParamInUrl,
    managerParamInUrl,
    userParamInUrl,
    scopeKey,
  } = scopeFilter;

  const composeAgencyId = useWriteAgencyId(
    isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me'
      ? selectedAgencyId
      : currentSubCompany?.id,
  );

  const { ownerIds: elevatedOwnerIds } = useScopeQueryParams(scopeFilter);
  const [emailsSearchParams] = useSearchParams();
  const linkedUserIdParam = emailsSearchParams.get('linkedUserId') ?? '';

  const [searchQuery, setSearchQuery] = useState('');
  const [composeDialogOpen, setComposeDialogOpen] = useState(false);
  const [replyDialogOpen, setReplyDialogOpen] = useState(false);
  const [editDraftEmail, setEditDraftEmail] = useState<{ id: string; subject: string; body: string; clientId?: string; fromUserId?: string; subCompanyId?: string } | null>(null);
  const [emails, setEmails] = useState<ApiEmailListItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Signatures state
  const [view, setView] = useState<'emails' | 'signatures'>('emails');
  const [customTemplatesOpen, setCustomTemplatesOpen] = useState(false);
  const [signatures, setSignatures] = useState<ApiEmailSignature[]>([]);
  const [sigLoading, setSigLoading] = useState(false);
  const [selectedSig, setSelectedSig] = useState<ApiEmailSignature | null>(null);
  const [sigForm, setSigForm] = useState({ name: '', content: '', isDefault: false });
  const [sigSaving, setSigSaving] = useState(false);
  const [sigDeleting, setSigDeleting] = useState<string | null>(null);
  const [sigEditorTab, setSigEditorTab] = useState<'edit' | 'preview'>('edit');
  const [sigImgUploading, setSigImgUploading] = useState(false);
  const sigImgInputRef = useRef<HTMLInputElement>(null);

  const loadListCounterRef = useRef(0);

  const loadList = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    if (showAgencySections || showAllTeamView) { setLoading(false); return; }
    if (showAllTeamView) { setLoading(false); return; }
    const counter = ++loadListCounterRef.current;
    setLoading(true);
    try {
      const agencyIds = isElevated && selectedAgencyId !== 'all' && selectedAgencyId !== 'me' ? [selectedAgencyId] : undefined;
      const ownerIds = elevatedOwnerIds;
      if (ownerIds !== undefined && ownerIds.length === 0) {
        if (counter === loadListCounterRef.current) { setEmails([]); setLoading(false); }
        return;
      }
      const res = await fetchEmails({ folder: currentFolder, limit: 100, ownerIds, agencyIds });
      if (counter !== loadListCounterRef.current) return;
      setEmails(res.data);
      if (currentFolder === 'inbox') {
        setUnreadCount(res.unreadCount);
        setUnreadEmailsCount(res.unreadCount);
      }
    } finally {
      if (counter === loadListCounterRef.current) setLoading(false);
    }
  }, [currentFolder, currentSubCompany?.id, isElevated, showAllTeamView, selectedAgencyId, setUnreadEmailsCount, elevatedOwnerIds, linkedUserIdParam]);

  const loadInboxUnreadCount = useCallback(async () => {
    const count = await fetchEmailUnreadCount();
    setUnreadCount(count);
    setUnreadEmailsCount(count);
  }, [setUnreadEmailsCount]);

  const loadSignatures = useCallback(async () => {
    setSigLoading(true);
    try {
      const list = await fetchEmailSignatures();
      setSignatures(list);
    } finally {
      setSigLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'signatures') loadSignatures();
  }, [view, loadSignatures]);

  const handleSigSelect = (sig: ApiEmailSignature) => {
    setSelectedSig(sig);
    setSigForm({ name: sig.name, content: sig.content, isDefault: sig.isDefault });
  };

  const handleSigNew = () => {
    setSelectedSig(null);
    setSigForm({ name: '', content: '', isDefault: false });
  };

  const handleSigSave = async () => {
    if (!sigForm.name.trim()) { toast.error('Signature name is required'); return; }
    if (!sigForm.content.trim()) { toast.error('Signature content is required'); return; }
    setSigSaving(true);
    try {
      if (selectedSig) {
        const updated = await updateEmailSignature(selectedSig.id, sigForm);
        setSignatures((prev) => prev.map((s) =>
          s.id === updated.id ? updated : sigForm.isDefault ? { ...s, isDefault: false } : s
        ));
        setSelectedSig(updated);
        toast.success('Signature updated');
      } else {
        const created = await createEmailSignature(sigForm);
        setSignatures((prev) => [
          ...(sigForm.isDefault ? prev.map((s) => ({ ...s, isDefault: false })) : prev),
          created,
        ]);
        setSelectedSig(created);
        setSigForm({ name: created.name, content: created.content, isDefault: created.isDefault });
        toast.success('Signature created');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save signature');
    } finally {
      setSigSaving(false);
    }
  };

  const handleSigDelete = async (id: string) => {
    setSigDeleting(id);
    try {
      await deleteEmailSignature(id);
      setSignatures((prev) => prev.filter((s) => s.id !== id));
      if (selectedSig?.id === id) {
        setSelectedSig(null);
        setSigForm({ name: '', content: '', isDefault: false });
      }
      toast.success('Signature deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete signature');
    } finally {
      setSigDeleting(null);
    }
  };

  const handleSigImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Only image files are allowed'); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error('Image must be under 5MB'); return; }
    setSigImgUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const tag = `<img src="${dataUrl}" alt="" style="max-width:200px;height:auto;display:block;margin:4px 0"/>`;
      setSigForm((f) => ({ ...f, content: f.content + tag }));
      setSigImgUploading(false);
    };
    reader.onerror = () => {
      toast.error('Failed to read image');
      setSigImgUploading(false);
    };
    reader.readAsDataURL(file);
    if (sigImgInputRef.current) sigImgInputRef.current.value = '';
  };

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (currentFolder === 'inbox') loadInboxUnreadCount();
  }, [currentFolder, loadInboxUnreadCount]);

  useEffect(() => {
    return onEmailRefresh(() => {
      loadList();
      if (currentFolder === 'inbox') loadInboxUnreadCount();
    });
  }, [loadList, loadInboxUnreadCount, currentFolder]);

  const filteredEmails = emails.filter(
    (email) =>
      searchQuery === '' ||
      email.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.from.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (email.body || '').toLowerCase().replace(/<[^>]*>/g, '').includes(searchQuery.toLowerCase())
  );

  const handleDeleteEmail = async (id: string) => {
    setDeletingEmailId(id);
    try {
      await deleteEmail(id);
      if (selectedEmail?.id === id) setSelectedEmail(null);
      setEmails((prev) => prev.filter((e) => e.id !== id));
      toast.success('Email deleted');
    } catch {
      toast.error('Failed to delete email');
    } finally {
      setDeletingEmailId(null);
      setEmailToDelete(null);
    }
  };

  const handleSelectEmail = async (item: ApiEmailListItem) => {
    // Drafts open in compose/edit dialog instead of read-only view
    if (item.folder === 'drafts') {
      setEditDraftEmail({ id: item.id, subject: item.subject, body: item.body, clientId: item.clientId, fromUserId: item.from.userId, subCompanyId: item.subCompanyId });
      return;
    }
    setLoadingDetail(true);
    setSelectedEmail(null);
    try {
      const detail = await fetchEmailById(item.id);
      setSelectedEmail(detail ?? null);
      if (detail && currentFolder === 'inbox' && !detail.isRead) {
        await markEmailRead(detail.id);
        setEmails((prev) => prev.map((e) => (e.id === detail.id ? { ...e, isRead: true } : e)));
        loadInboxUnreadCount();
      }
    } finally {
      setLoadingDetail(false);
    }
  };

  const bodyPreview = (body: string) => {
    const stripped = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped.slice(0, 120) + (stripped.length > 120 ? '…' : '');
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Emails</h1>
          <p className="text-muted-foreground mt-1">Manage client communications</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 min-w-[9.75rem] justify-center px-3 text-xs"
            onClick={() => setCustomTemplatesOpen(true)}
          >
            <LayoutTemplate className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            Custom Templates
          </Button>
          <Button
            variant={view === 'signatures' ? 'default' : 'outline'}
            size="sm"
            className="h-8 min-w-[9.75rem] justify-center px-3 text-xs"
            onClick={() => setView((v) => v === 'signatures' ? 'emails' : 'signatures')}
          >
            <PenLine className="h-3.5 w-3.5 mr-1.5 shrink-0" />
            Signatures
          </Button>
          {view === 'emails' && canComposeEmail && (
            <Button
              size="sm"
              className="h-8 min-w-[9.75rem] justify-center px-3 text-xs"
              onClick={() => setComposeDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5 shrink-0" />
              Compose Email
            </Button>
          )}
        </div>
      </div>

      {/* Agency / Manager / User tabs — 3-row filter for elevated roles, emails view only */}
      {view === 'emails' && (
        <StickyHeader zIndex={40}>
          <ScopeFilterBar show={showHierarchyFilters} filterRowProps={filterRowProps} />
        </StickyHeader>
      )}


      {/* All Agencies — one section per agency */}
      {view === 'emails' && showAgencySections && (
        agencies.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">No agencies in scope</p>
        ) : (
          <div className="space-y-4">
            {agencies.map((agency) => (
              <AgencyEmailsSection
                key={agency.id}
                agency={agency}
                onViewAgency={() => setSelectedAgencyId(agency.id)}
                ownerIds={elevatedOwnerIds}
                scopeKey={`${scopeKey}|${elevatedOwnerIds?.join(',') ?? ''}`}
              />
            ))}
          </div>
        )
      )}

      {/* Manager / Team — one section per user */}
      {view === 'emails' && showAllTeamView && (
        managerTeamUsers.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-12">
            {showManagerSections ? 'No managers / team in this agency' : 'No team members in this scope'}
          </p>
        ) : (
          <div className="space-y-6">
            {managerTeamUsers.map((user) => (
              <div key={user.id}>
                <PersonSectionHeader
                  user={user}
                  roleTitle={getUserRoleTitle(user)}
                  onView={() =>
                    showManagerSections ? setSelectedManagerId(user.id) : setSelectedUserId(user.id)
                  }
                />
                <TeamEmailsSection teamUsers={[user]} />
              </div>
            ))}
          </div>
        )
      )}

      {view === 'signatures' && (
        <div className="grid grid-cols-12 gap-6 h-[calc(100%-80px)]">
          {/* Left: signature list */}
          <div className="col-span-4 flex flex-col gap-3">
            <Button variant="ghost" className="w-fit -ml-1 text-muted-foreground" onClick={() => setView('emails')}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Emails
            </Button>
            <Button variant="outline" className="w-full" onClick={handleSigNew}>
              <Plus className="h-4 w-4 mr-2" />
              New Signature
            </Button>
            <ScrollArea className="flex-1 h-[calc(100vh-18rem)]">
              {sigLoading ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Loading…</p>
              ) : signatures.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <PenLine className="h-10 w-10 mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No signatures yet</p>
                </div>
              ) : (
                <div className="space-y-2 pr-1">
                  {signatures.map((sig) => (
                    <Card
                      key={sig.id}
                      className={cn(
                        'cursor-pointer hover:bg-accent/50 transition-colors',
                        selectedSig?.id === sig.id && 'bg-accent'
                      )}
                      onClick={() => handleSigSelect(sig)}
                    >
                      <CardContent className="p-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {sig.isDefault && <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" fill="currentColor" />}
                          <span className="text-sm font-medium truncate">{sig.name}</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                          disabled={sigDeleting === sig.id}
                          onClick={(e) => { e.stopPropagation(); handleSigDelete(sig.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: signature editor */}
          <div className="col-span-8">
            <Card className="h-full">
              <CardContent className="p-6 flex flex-col gap-4 h-full">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">
                    {selectedSig ? 'Edit Signature' : 'New Signature'}
                  </h3>
                  <div className="flex items-center gap-2">
                    {/* Image upload */}
                    <input
                      ref={sigImgInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleSigImageUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={sigImgUploading}
                      onClick={() => sigImgInputRef.current?.click()}
                    >
                      <Upload className="h-4 w-4 mr-1.5" />
                      {sigImgUploading ? 'Uploading…' : 'Upload image'}
                    </Button>
                    {selectedSig && (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={handleSigNew}>
                        <Plus className="h-4 w-4 mr-1" />
                        New
                      </Button>
                    )}
                  </div>
                </div>

                {/* Name */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Signature name</label>
                  <Input
                    placeholder="e.g. Work, Formal, Casual"
                    value={sigForm.name}
                    onChange={(e) => setSigForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>

                {/* Editor / Preview tabs */}
                <div className="flex-1 min-h-0 flex flex-col gap-2">
                  <div className="flex items-center gap-1 border rounded-md w-fit p-0.5 bg-muted/40">
                    <button
                      type="button"
                      onClick={() => setSigEditorTab('edit')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1 text-sm rounded transition-colors',
                        sigEditorTab === 'edit' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setSigEditorTab('preview')}
                      className={cn(
                        'flex items-center gap-1.5 px-3 py-1 text-sm rounded transition-colors',
                        sigEditorTab === 'preview' ? 'bg-background shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <Eye className="h-3.5 w-3.5" /> Preview
                    </button>
                  </div>

                  {sigEditorTab === 'edit' ? (
                    <EmailRichTextEditor
                      id="sig-content"
                      value={sigForm.content}
                      onChange={(val) => setSigForm((f) => ({ ...f, content: val }))}
                      placeholder="Write your signature — name, title, phone, website…"
                      minHeight={200}
                    />
                  ) : (
                    <div className="flex-1 rounded-md border bg-white dark:bg-background overflow-auto p-4 min-h-[200px]">
                      {sigForm.content ? (
                        <div
                          className="prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: sigForm.content }}
                        />
                      ) : (
                        <p className="text-muted-foreground text-sm italic">Nothing to preview yet.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-2 border-t">
                  <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
                    <input
                      type="checkbox"
                      className="accent-primary h-4 w-4"
                      checked={sigForm.isDefault}
                      onChange={(e) => setSigForm((f) => ({ ...f, isDefault: e.target.checked }))}
                    />
                    <span>Set as default <span className="text-muted-foreground">(auto-inserted when composing)</span></span>
                  </label>
                  <Button onClick={handleSigSave} disabled={sigSaving}>
                    {sigSaving ? 'Saving…' : (
                      <><Check className="h-4 w-4 mr-2" />{selectedSig ? 'Save changes' : 'Create signature'}</>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {view === 'emails' && !showAgencySections && !showAllTeamView && <div className="grid grid-cols-12 gap-6 h-[calc(100%-80px)]">
        <div className="col-span-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search emails..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <Tabs value={currentFolder} onValueChange={(v) => setCurrentFolder(v as 'inbox' | 'sent' | 'drafts')}>
            <StickyHeader>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="inbox" className="gap-2">
                  <Inbox className="h-4 w-4" />
                  Inbox
                  {unreadCount > 0 && (
                    <Badge variant="default" className="ml-1 h-5 w-5 rounded-full p-0 flex items-center justify-center text-xs">
                      {unreadCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="sent" className="gap-2">
                  <Send className="h-4 w-4" />
                  Sent
                </TabsTrigger>
                <TabsTrigger value="drafts" className="gap-2">
                  <FileText className="h-4 w-4" />
                  Drafts
                </TabsTrigger>
              </TabsList>
            </StickyHeader>

            <TabsContent value={currentFolder} className="mt-4">
              <ScrollArea className="h-[calc(100vh-20rem)]">
                <div className="space-y-2">
                  {loading ? (
                    <div className="text-center py-12 text-muted-foreground">Loading…</div>
                  ) : filteredEmails.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Mail className="h-12 w-12 mx-auto mb-3 opacity-50" />
                      <p>No emails in {currentFolder}</p>
                    </div>
                  ) : (
                    filteredEmails.map((email) => {
                      const isSelected = selectedEmail?.id === email.id;
                      return (
                        <Card
                          key={email.id}
                          className={cn(
                            'cursor-pointer hover:bg-accent/50 transition-colors',
                            isSelected && 'bg-accent',
                            !email.isRead && 'border-l-4 border-l-primary'
                          )}
                          onClick={() => handleSelectEmail(email)}
                        >
                          <CardContent className="p-4">
                            <div className="space-y-2">
                              <div className="flex items-start justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p
                                      className={cn(
                                        'text-sm font-medium truncate',
                                        !email.isRead && 'font-bold',
                                        isSelected && 'text-accent-foreground'
                                      )}
                                    >
                                      {email.folder === 'sent' ? email.to[0]?.name : email.from.name}
                                    </p>
                                    {!email.isRead && (
                                      <Badge variant="default" className="text-xs">
                                        New
                                      </Badge>
                                    )}
                                  </div>
                                  <p
                                    className={cn(
                                      'text-xs truncate',
                                      isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground'
                                    )}
                                  >
                                    {email.folder === 'sent' ? email.to[0]?.email : email.from.email}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1 ml-2 shrink-0">
                                  <span
                                    className={cn(
                                      'text-xs whitespace-nowrap',
                                      isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground'
                                    )}
                                  >
                                    {format(new Date(email.timestamp), 'MMM d')}
                                  </span>
                                  {canDeleteEmail && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                      disabled={deletingEmailId === email.id}
                                      onClick={(e) => { e.stopPropagation(); setEmailToDelete(email.id); }}
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                              <EmailSubjectLine
                                subject={email.subject}
                                attachmentCount={email.attachmentCount}
                                className={cn(
                                  'text-sm truncate',
                                  !email.isRead && 'font-semibold',
                                  isSelected && 'text-accent-foreground'
                                )}
                              />
                              {email.forwardedFromName && (
                                <ForwardedChip name={email.forwardedFromName} />
                              )}
                              {email.sentBy && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                                  <UserCheck className="h-3 w-3 shrink-0" />
                                  {email.sentBy.id === currentUser?.id
                                    ? `You sent this as ${email.from.name}`
                                    : email.from.userId === currentUser?.id
                                      ? `Sent on your behalf by ${email.sentBy.name}`
                                      : `Sent by ${email.sentBy.name} as ${email.from.name}`}
                                </span>
                              )}
                              <p
                                className={cn(
                                  'text-xs line-clamp-2',
                                  isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground'
                                )}
                              >
                                {bodyPreview(email.body)}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <div className="col-span-8">
          {loadingDetail ? (
            <Card className="h-full">
              <CardContent className="flex items-center justify-center h-64">Loading…</CardContent>
            </Card>
          ) : selectedEmail ? (
            <Card className="h-full">
              <CardContent className="p-6 flex flex-col h-full">
                <div className="space-y-4 mb-6">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h2 className="text-2xl font-semibold">{selectedEmail.subject}</h2>
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => setSelectedEmail(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="text-sm font-semibold text-primary">
                        {selectedEmail.from.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)}
                      </span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{selectedEmail.from.name}</p>
                          <p className="text-sm text-muted-foreground">{selectedEmail.from.email}</p>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(selectedEmail.timestamp), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        To: {selectedEmail.to.map((t) => t.name).join(', ')}
                      </div>
                      {(selectedEmail.sentBy || selectedEmail.originalSentBy) && (
                        <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-medium text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full leading-none">
                          <UserCheck className="h-3 w-3 shrink-0" />
                          {selectedEmail.sentBy
                            ? selectedEmail.sentBy.id === currentUser?.id
                              ? `You sent this as ${selectedEmail.from.name}`
                              : selectedEmail.from.userId === currentUser?.id
                                ? `Sent on your behalf by ${selectedEmail.sentBy.name}`
                                : `Sent by ${selectedEmail.sentBy.name} as ${selectedEmail.from.name}`
                            : selectedEmail.originalSentBy!.id === currentUser?.id
                              ? `You sent the original as ${selectedEmail.from.name}`
                              : selectedEmail.from.userId === currentUser?.id
                                ? `Reply to an email sent on your behalf by ${selectedEmail.originalSentBy!.name}`
                                : `Reply to an email sent by ${selectedEmail.originalSentBy!.name} as ${selectedEmail.from.name}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                <ScrollArea className="flex-1 my-6">
                  <div
                    className="prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{
                      __html:
                        selectedEmail.body?.startsWith('<') ?
                          repairLegacyEmailBody(selectedEmail.body)
                          : `<p class="whitespace-pre-wrap">${(selectedEmail.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
                    }}
                  />
                </ScrollArea>

                <EmailAttachmentBar email={selectedEmail} />
                <Separator className="my-4" />

                <div className="flex gap-2">
                  <Button variant="default" onClick={() => setReplyDialogOpen(true)}>
                    <Reply className="h-4 w-4 mr-2" />
                    Reply
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full">
              <CardContent className="flex items-center justify-center h-full">
                <div className="text-center text-muted-foreground">
                  <Mail className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Select an email to view</p>
                  <p className="text-sm mt-2">Choose an email from the list to read its content</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>}

      <DeleteEmailConfirmDialog
        open={emailToDelete !== null}
        onOpenChange={(open) => { if (!open && !deletingEmailId) setEmailToDelete(null); }}
        onConfirm={() => { if (emailToDelete) void handleDeleteEmail(emailToDelete); }}
        isDeleting={deletingEmailId !== null}
      />
      <EmailComposeDialog
        open={composeDialogOpen}
        onOpenChange={setComposeDialogOpen}
        onSent={loadList}
        onDraftSaved={loadList}
        selectedAgencyId={composeAgencyId ?? selectedAgencyId}
        defaultReplyAsUserId={
          actAs.isActive
            ? actAs.userId!
            : (selectedUserId && selectedUserId !== 'me' && selectedUserId !== 'all')
              ? selectedUserId
              : (selectedManagerId && selectedManagerId !== 'all' && selectedManagerId !== 'me')
                ? selectedManagerId
                : (selectedLeaderId && selectedLeaderId !== 'all' && selectedLeaderId !== 'me')
                  ? selectedLeaderId
                  : undefined
        }
      />

      <EmailComposeDialog
        open={replyDialogOpen}
        onOpenChange={setReplyDialogOpen}
        replyTo={selectedEmail ?? null}
        selectedAgencyId={selectedEmail?.subCompanyId ?? composeAgencyId ?? selectedAgencyId}
        defaultReplyAsUserId={
          selectedEmail?.from.userId && selectedEmail.from.userId !== currentUser?.id
            ? selectedEmail.from.userId
            : undefined
        }
        onSent={() => {
          loadList();
          setReplyDialogOpen(false);
        }}
      />

      <EmailComposeDialog
        open={!!editDraftEmail}
        onOpenChange={(open) => { if (!open) setEditDraftEmail(null); }}
        editDraft={editDraftEmail}
        selectedAgencyId={editDraftEmail?.subCompanyId ?? composeAgencyId ?? selectedAgencyId}
        defaultReplyAsUserId={
          editDraftEmail?.fromUserId && editDraftEmail.fromUserId !== currentUser?.id
            ? editDraftEmail.fromUserId
            : undefined
        }
        onSent={() => { setEditDraftEmail(null); loadList(); }}
        onDraftSaved={() => { setEditDraftEmail(null); loadList(); }}
      />
      <CustomEmailTemplatesSheet open={customTemplatesOpen} onOpenChange={setCustomTemplatesOpen} />
    </div>
  );
}
