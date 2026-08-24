import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Send, Paperclip, FileText, Image as ImageIcon, Film, X, MessageSquarePlus, Loader2, Phone, Video, PhoneMissed, PhoneOff, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { useStore } from '@/lib/store';
import {
  fetchConversations,
  fetchConversationMessages,
  sendConversationMessage,
  markConversationRead,
  fetchUnreadMessagesCount,
  fetchAgencyMembers,
  createOrGetConversation,
  getMessageAttachmentUrl,
  fetchMessageAttachmentBlob,
  type ApiConversation,
  type ApiMessage,
  type AgencyMemberRow,
} from '@/lib/api';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { onMessageNew, onConversationRead } from '@/lib/socket';
import { NewMessageDialog } from '@/components/NewMessageDialog';
import { MessagesUserList } from '@/components/messages/MessagesUserList';
import { useInternalCallStore } from '@/lib/internalCallStore';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { toast } from 'sonner';

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-600', 'bg-orange-500', 'bg-indigo-500',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

function highlightText(text: string, term: string, isFocused: boolean): React.ReactNode {
  if (!term) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  let offset = 0;
  let key = 0;
  let idx;
  while ((idx = lower.indexOf(term, offset)) !== -1) {
    if (idx > offset) parts.push(text.slice(offset, idx));
    parts.push(
      <mark
        key={key++}
        className={cn(
          'rounded-sm px-0.5',
          isFocused ? 'bg-yellow-400 text-black' : 'bg-yellow-200/80 text-inherit'
        )}
      >
        {text.slice(idx, idx + term.length)}
      </mark>
    );
    offset = idx + term.length;
  }
  if (offset < text.length) parts.push(text.slice(offset));
  return <>{parts}</>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export default function Messages() {
  const { currentUser, currentSubCompany, setUnreadMessagesCount } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conversations, setConversations] = useState<ApiConversation[]>([]);
  const [users, setUsers] = useState<AgencyMemberRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    () => searchParams.get('conversation')
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messageInput, setMessageInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const selectedConversationIdRef = useRef<string | null>(null);
  selectedConversationIdRef.current = selectedConversationId;

  // In-conversation message search
  const [msgSearchOpen, setMsgSearchOpen] = useState(false);
  const [msgSearchQuery, setMsgSearchQuery] = useState('');
  const [msgSearchIndex, setMsgSearchIndex] = useState(0);
  const msgSearchInputRef = useRef<HTMLInputElement>(null);
  const msgItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const loadConversations = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    try {
      const data = await fetchConversations();
      setConversations(data);
    } catch {
      // ignore
    }
  }, [currentSubCompany?.id]);

  const loadUsers = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    try {
      const list = await fetchAgencyMembers();
      setUsers(list);
    } catch {
      setUsers([]);
    }
  }, [currentSubCompany?.id]);

  const loadSidebar = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    setListLoading(true);
    try {
      await Promise.all([loadUsers(), loadConversations()]);
    } finally {
      setListLoading(false);
    }
  }, [currentSubCompany?.id, loadUsers, loadConversations]);

  const loadUnreadCount = useCallback(async () => {
    try {
      const count = await fetchUnreadMessagesCount();
      setUnreadMessagesCount(count);
    } catch {
      // ignore
    }
  }, [setUnreadMessagesCount]);

  useEffect(() => {
    loadSidebar();
    loadUnreadCount();
  }, [loadSidebar, loadUnreadCount]);

  const selectConversation = useCallback(
    (conversationId: string, userId?: string | null) => {
      setSelectedConversationId(conversationId);
      if (userId !== undefined) setSelectedUserId(userId);
      setSearchParams({ conversation: conversationId }, { replace: true });
    },
    [setSearchParams]
  );

  const handleSelectUser = useCallback(
    async (user: AgencyMemberRow, existingConversationId: string | null) => {
      setSelectedUserId(user.id);
      if (existingConversationId) {
        selectConversation(existingConversationId, user.id);
        return;
      }
      setOpeningUserId(user.id);
      try {
        const conv = await createOrGetConversation(user.id);
        await loadConversations();
        selectConversation(conv.id, user.id);
      } catch {
        toast.error('Failed to start conversation');
      } finally {
        setOpeningUserId(null);
      }
    },
    [selectConversation, loadConversations]
  );

  useEffect(() => {
    const convId = searchParams.get('conversation');
    if (convId && convId !== selectedConversationId) {
      setSelectedConversationId(convId);
    }
  }, [searchParams, selectedConversationId]);

  // Keep selected user in sync when conversation is selected (e.g. deep link)
  useEffect(() => {
    if (!selectedConversationId) return;
    const conv = conversations.find((c) => c.id === selectedConversationId);
    const peerId = conv?.participantUserIds[0];
    if (peerId) setSelectedUserId(peerId);
  }, [selectedConversationId, conversations]);

  const selectedConversation = conversations.find((c) => c.id === selectedConversationId);

  const loadMessages = useCallback(
    async (convId: string) => {
      setMessagesLoading(true);
      try {
        const { data } = await fetchConversationMessages(convId);
        setMessages(data);
        await markConversationRead(convId);
        await loadUnreadCount();
        await loadConversations();
      } finally {
        setMessagesLoading(false);
      }
    },
    [loadUnreadCount, loadConversations]
  );

  useEffect(() => {
    if (selectedConversationId) {
      loadMessages(selectedConversationId);
    } else {
      setMessages([]);
    }
  }, [selectedConversationId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const unsubMessage = onMessageNew((payload) => {
      if (payload.conversationId === selectedConversationIdRef.current) {
        // Call history is system-authored as the caller — always append for both sides.
        // Normal chat: sender already has the message from the POST response.
        const isCall = payload.message.type === 'call';
        if (isCall || payload.message.senderId !== currentUser?.id) {
          setMessages((prev) => {
            if (prev.some((m) => m.id === payload.message.id)) return prev;
            return [...prev, payload.message as ApiMessage];
          });
        }
      }
      loadConversations();
      loadUnreadCount();
    });
    const unsubRead = onConversationRead(() => {
      loadConversations();
      loadUnreadCount();
    });
    return () => {
      unsubMessage();
      unsubRead();
    };
  }, [loadConversations, loadUnreadCount, currentUser?.id]);

  const getOtherParticipantNames = (conv: ApiConversation) =>
    conv.participantNames.join(', ') || 'Unknown';

  const getInitials = (name: string) =>
    name
      .split(/[\s,]+/)
      .map((n) => n[0])
      .filter(Boolean)
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?';

  const handleSendMessage = async () => {
    if (!selectedConversationId) return;
    const hasText = messageInput.trim().length > 0;
    if (!hasText && attachments.length === 0) return;

    setSending(true);
    try {
      const payload: { text?: string; attachments?: Array<{ name: string; fileBase64: string; mimeType?: string }> } = {};
      if (hasText) payload.text = messageInput.trim();
      if (attachments.length > 0) {
        payload.attachments = await Promise.all(
          attachments.map(async (file) => ({
            name: file.name,
            fileBase64: await fileToBase64(file),
            mimeType: file.type || undefined,
          }))
        );
      }
      const sent = await sendConversationMessage(selectedConversationId, payload);
      setMessages((prev) => [...prev, sent]);
      setMessageInput('');
      setAttachments([]);
      await loadConversations();
      await loadUnreadCount();
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (e) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleConversationCreated = (conversationId: string) => {
    void loadConversations().then(() => {
      selectConversation(conversationId, null);
    });
    void loadUnreadCount();
  };

  // Reset search when switching conversations
  useEffect(() => {
    setMsgSearchOpen(false);
    setMsgSearchQuery('');
    setMsgSearchIndex(0);
  }, [selectedConversationId]);

  // Focus search input when opened
  useEffect(() => {
    if (msgSearchOpen) msgSearchInputRef.current?.focus();
  }, [msgSearchOpen]);

  const msgSearchTerm = msgSearchQuery.trim().toLowerCase();
  const msgSearchMatches = useMemo(
    () =>
      msgSearchTerm
        ? messages.filter((msg) => msg.type !== 'call' && !!msg.text?.toLowerCase().includes(msgSearchTerm))
        : [],
    [messages, msgSearchTerm]
  );
  const clampedSearchIndex =
    msgSearchMatches.length > 0 ? Math.min(msgSearchIndex, msgSearchMatches.length - 1) : -1;

  // Scroll to current match. Depend on primitives only so this doesn't fire on
  // every incoming WebSocket message (msgSearchMatches gets a new ref each time).
  useEffect(() => {
    if (clampedSearchIndex < 0) return;
    const targetMsg = msgSearchMatches[clampedSearchIndex];
    if (!targetMsg) return;
    msgItemRefs.current.get(targetMsg.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clampedSearchIndex, msgSearchTerm]);

  return (
    <div className="h-[calc(100vh-120px)] flex gap-4">
      <NewMessageDialog
        open={newMessageOpen}
        onOpenChange={setNewMessageOpen}
        onConversationCreated={handleConversationCreated}
      />

      {/* User list */}
      <div className="w-80 bg-card rounded-lg border border-border flex flex-col min-h-0">
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setNewMessageOpen(true)}
            >
              <MessageSquarePlus className="h-4 w-4 mr-2" />
              New message
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search people..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        <MessagesUserList
          users={users}
          conversations={conversations}
          loading={listLoading}
          searchQuery={searchQuery}
          selectedConversationId={selectedConversationId}
          selectedUserId={selectedUserId}
          openingUserId={openingUserId}
          onSelectUser={handleSelectUser}
        />
      </div>

      {/* Message Thread */}
      <div className="flex-1 bg-card rounded-lg border border-border flex flex-col min-h-0">
        {selectedConversation ? (
          <>
            <div className="p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    <AvatarFallback className="bg-primary text-primary-foreground">
                      {getInitials(getOtherParticipantNames(selectedConversation))}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <h2 className="font-semibold truncate">
                      {getOtherParticipantNames(selectedConversation)}
                    </h2>
                    <p className="text-xs text-muted-foreground">In your agency</p>
                  </div>
                </div>
                {(() => {
                  const peerUserId = selectedConversation.participantUserIds[0];
                  const peerName = getOtherParticipantNames(selectedConversation);
                  if (!peerUserId || !currentUser?.id) return null;
                  return (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        type="button"
                        variant={msgSearchOpen ? 'secondary' : 'outline'}
                        size="icon"
                        aria-label="Search messages"
                        onClick={() => setMsgSearchOpen((o) => !o)}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Start audio call"
                        onClick={() =>
                          void useInternalCallStore.getState().startCall({
                            conversationId: selectedConversation.id,
                            peerUserId,
                            peerName,
                            mediaType: 'audio',
                          })
                        }
                      >
                        <Phone className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Start video call"
                        onClick={() =>
                          void useInternalCallStore.getState().startCall({
                            conversationId: selectedConversation.id,
                            peerUserId,
                            peerName,
                            mediaType: 'video',
                          })
                        }
                      >
                        <Video className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })()}
              </div>
            </div>

            {msgSearchOpen && (
              <div className="px-4 py-2 border-b border-border flex items-center gap-2 bg-muted/30 flex-shrink-0">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  ref={msgSearchInputRef}
                  placeholder="Search in conversation..."
                  value={msgSearchQuery}
                  onChange={(e) => {
                    setMsgSearchQuery(e.target.value);
                    setMsgSearchIndex(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setMsgSearchOpen(false);
                      setMsgSearchQuery('');
                      setMsgSearchIndex(0);
                    } else if (e.key === 'Enter' && msgSearchMatches.length > 0) {
                      e.preventDefault();
                      setMsgSearchIndex((i) =>
                        e.shiftKey
                          ? (i - 1 + msgSearchMatches.length) % msgSearchMatches.length
                          : (i + 1) % msgSearchMatches.length
                      );
                    }
                  }}
                  className="h-8 flex-1"
                />
                {msgSearchQuery.trim() && (
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {msgSearchMatches.length > 0
                      ? `${clampedSearchIndex + 1} / ${msgSearchMatches.length}`
                      : 'No results'}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  disabled={msgSearchMatches.length === 0}
                  onClick={() =>
                    setMsgSearchIndex((i) => (i - 1 + msgSearchMatches.length) % msgSearchMatches.length)
                  }
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  disabled={msgSearchMatches.length === 0}
                  onClick={() =>
                    setMsgSearchIndex((i) => (i + 1) % msgSearchMatches.length)
                  }
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 flex-shrink-0"
                  onClick={() => {
                    setMsgSearchOpen(false);
                    setMsgSearchQuery('');
                    setMsgSearchIndex(0);
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
              {messagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="flex flex-col pb-2">
                  {messages.flatMap((msg, index) => {
                    const prevMsg = messages[index - 1];
                    const msgDate = new Date(msg.createdAt);
                    const prevDate = prevMsg ? new Date(prevMsg.createdAt) : null;
                    const showDateSep = !prevDate || !isSameDay(msgDate, prevDate);
                    const isGrouped =
                      !showDateSep &&
                      prevMsg?.senderId === msg.senderId &&
                      prevMsg?.type !== 'call' &&
                      msg.type !== 'call' &&
                      msgDate.getTime() - (prevDate?.getTime() ?? 0) < 5 * 60 * 1000;

                    const els: JSX.Element[] = [];

                    if (showDateSep) {
                      const label = isToday(msgDate)
                        ? 'Today'
                        : isYesterday(msgDate)
                          ? 'Yesterday'
                          : format(msgDate, 'MMMM d, yyyy');
                      els.push(
                        <div key={`sep-${msg.id}`} className="flex items-center gap-3 py-3 px-1">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-xs text-muted-foreground font-medium">{label}</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      );
                    }

                    if (msg.type === 'call') {
                      const media = msg.metadata?.mediaType ?? 'audio';
                      const outcome = msg.metadata?.outcome;
                      const CallIcon =
                        outcome === 'missed' || outcome === 'declined'
                          ? PhoneMissed
                          : outcome === 'cancelled'
                            ? PhoneOff
                            : media === 'video'
                              ? Video
                              : Phone;
                      els.push(
                        <div key={msg.id} className={cn('flex justify-center', isGrouped ? 'mt-1' : 'mt-3')}>
                          <div className="inline-flex max-w-[90%] items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
                            <CallIcon className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">{msg.text ?? 'Call'}</span>
                            <span className="flex-shrink-0 opacity-70">
                              {format(new Date(msg.createdAt), 'h:mm a')}
                            </span>
                          </div>
                        </div>
                      );
                      return els;
                    }

                    const isCurrentUser = msg.senderId === currentUser?.id;
                    const isFocusedMatch = msgSearchMatches[clampedSearchIndex]?.id === msg.id;
                    els.push(
                      <div
                        key={msg.id}
                        ref={(el) => {
                          if (el) msgItemRefs.current.set(msg.id, el);
                          else msgItemRefs.current.delete(msg.id);
                        }}
                        className={cn(
                          'flex gap-2 px-1',
                          isGrouped ? 'mt-0.5' : 'mt-3',
                          isCurrentUser ? 'flex-row-reverse' : 'flex-row',
                          isFocusedMatch && 'rounded-xl bg-yellow-50/40 dark:bg-yellow-900/10'
                        )}
                      >
                        {isGrouped ? (
                          <div className="w-8 flex-shrink-0" />
                        ) : (
                          <Avatar className="h-8 w-8 flex-shrink-0 mt-0.5">
                            <AvatarFallback
                              className={cn(
                                'text-white text-xs font-medium',
                                isCurrentUser ? 'bg-primary' : avatarColor(msg.senderName)
                              )}
                            >
                              {getInitials(msg.senderName)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <div
                          className={cn(
                            'flex flex-col gap-0.5 max-w-[72%]',
                            isCurrentUser ? 'items-end' : 'items-start'
                          )}
                        >
                          <div
                            className={cn(
                              'px-3.5 py-2',
                              isCurrentUser
                                ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-sm'
                                : 'bg-muted rounded-2xl rounded-bl-sm'
                            )}
                          >
                            {msg.text && (
                              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                {msgSearchTerm
                                  ? highlightText(msg.text, msgSearchTerm, isFocusedMatch)
                                  : msg.text}
                              </p>
                            )}
                            {msg.attachments && msg.attachments.length > 0 && (
                              <div className="mt-2">
                                <CrmAttachmentList
                                  variant="media"
                                  inverted={isCurrentUser}
                                  items={msg.attachments.map((att) => ({
                                    id: att.id,
                                    name: att.name,
                                    mimeType: att.mimeType,
                                    size: att.fileSize,
                                  }))}
                                  getStreamUrl={(item) => {
                                    const att = msg.attachments!.find((a) => a.id === item.id);
                                    if (!att) return null;
                                    return att.fileUrl.startsWith('http://') || att.fileUrl.startsWith('https://')
                                      ? att.fileUrl
                                      : getMessageAttachmentUrl(att.id);
                                  }}
                                  fetchBlob={(item) => fetchMessageAttachmentBlob(item.id)}
                                  onDownload={async (item) => {
                                    const blob = await fetchMessageAttachmentBlob(item.id);
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = item.name;
                                    document.body.appendChild(a);
                                    a.click();
                                    document.body.removeChild(a);
                                    URL.revokeObjectURL(url);
                                  }}
                                />
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground px-1">
                            {format(new Date(msg.createdAt), 'h:mm a')}
                          </span>
                        </div>
                      </div>
                    );
                    return els;
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </ScrollArea>

            <div className="p-4 border-t border-border flex-shrink-0">
              {attachments.length > 0 && (
                <div className="mb-3 space-y-2">
                  {attachments.map((file, index) => {
                    const isImageFile = file.type.startsWith('image/');
                    const isVideoFile = file.type.startsWith('video/');
                    const FileIconComponent = isImageFile ? ImageIcon : isVideoFile ? Film : FileText;
                    return (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-2 rounded border border-border bg-muted"
                      >
                        {isImageFile ? (
                          <img
                            src={URL.createObjectURL(file)}
                            alt={file.name}
                            className="h-16 w-16 rounded object-cover flex-shrink-0"
                            onLoad={(e) => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                          />
                        ) : isVideoFile ? (
                          <video
                            src={URL.createObjectURL(file)}
                            className="h-16 w-24 rounded object-cover flex-shrink-0"
                            muted
                            preload="metadata"
                          />
                        ) : (
                          <FileIconComponent className="h-4 w-4 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(file.size)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => removeAttachment(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-2">
                <Input
                  type="file"
                  id="messages-file-upload"
                  className="hidden"
                  multiple
                  accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar"
                  onChange={handleFileSelect}
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => document.getElementById('messages-file-upload')?.click()}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Textarea
                  placeholder="Type your message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  className="min-h-[44px] max-h-32 resize-none flex-1"
                  rows={1}
                />
                <Button
                  onClick={handleSendMessage}
                  size="icon"
                  disabled={sending || (!messageInput.trim() && attachments.length === 0)}
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Press Enter to send, Shift+Enter for new line
              </p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 p-8 text-center">
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center">
              <MessageSquarePlus className="h-9 w-9 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-1">No conversation selected</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Pick a person from the list or start a new conversation.
              </p>
            </div>
            <Button onClick={() => setNewMessageOpen(true)}>
              <MessageSquarePlus className="h-4 w-4 mr-2" />
              New message
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
