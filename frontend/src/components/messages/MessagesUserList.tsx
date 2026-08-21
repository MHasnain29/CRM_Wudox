import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { format, isToday, isYesterday } from 'date-fns';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AgencyMemberRow, ApiConversation } from '@/lib/api';

export type MessageableUser = AgencyMemberRow;

type MessagesUserListProps = {
  users: MessageableUser[];
  conversations: ApiConversation[];
  loading: boolean;
  searchQuery: string;
  selectedConversationId: string | null;
  selectedUserId: string | null;
  openingUserId: string | null;
  onSelectUser: (user: MessageableUser, existingConversationId: string | null) => void;
};

function displayName(u: MessageableUser) {
  return `${u.firstName} ${u.lastName}`.trim() || u.email;
}

const AVATAR_COLORS = [
  'bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-600', 'bg-orange-500', 'bg-indigo-500',
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const diffMins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (isToday(date)) return format(date, 'h:mm a');
  if (isYesterday(date)) return 'Yesterday';
  if (diffMins < 7 * 24 * 60) return format(date, 'EEE');
  return format(date, 'MMM d');
}

function getInitials(name: string) {
  return (
    name
      .split(/[\s,]+/)
      .map((n) => n[0])
      .filter(Boolean)
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  );
}

function conversationForUser(conversations: ApiConversation[], userId: string) {
  return conversations.find((c) => c.participantUserIds.includes(userId)) ?? null;
}

export function MessagesUserList({
  users,
  conversations,
  loading,
  searchQuery,
  selectedConversationId,
  selectedUserId,
  openingUserId,
  onSelectUser,
}: MessagesUserListProps) {
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows = users.map((user) => {
      const conv = conversationForUser(conversations, user.id);
      return { user, conv };
    });

    const matched = q
      ? rows.filter(({ user }) => {
          const name = displayName(user).toLowerCase();
          const email = user.email.toLowerCase();
          const role = (user.userType ?? user.role).toLowerCase();
          return name.includes(q) || email.includes(q) || role.includes(q);
        })
      : rows;

    // Unread / recent conversations first, then remaining users A–Z
    matched.sort((a, b) => {
      const aUnread = a.conv?.unreadCount ?? 0;
      const bUnread = b.conv?.unreadCount ?? 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      const aTime = a.conv ? new Date(a.conv.lastMessageTime).getTime() : 0;
      const bTime = b.conv ? new Date(b.conv.lastMessageTime).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return displayName(a.user).localeCompare(displayName(b.user));
    });

    return matched;
  }, [users, conversations, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6 px-2">
        {users.length === 0
          ? 'No colleagues found in your agency.'
          : 'No match for your search.'}
      </p>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-2 space-y-1">
        {filtered.map(({ user, conv }) => {
          const name = displayName(user);
          const isSelected =
            (conv && selectedConversationId === conv.id) ||
            (!conv && selectedUserId === user.id);
          const isOpening = openingUserId === user.id;
          return (
            <button
              key={user.id}
              type="button"
              disabled={isOpening}
              onClick={() => onSelectUser(user, conv?.id ?? null)}
              className={cn(
                'w-full p-3 rounded-lg text-left transition-colors',
                isSelected ? 'bg-accent' : 'hover:bg-accent/50',
                isOpening && 'opacity-70'
              )}
            >
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10 flex-shrink-0">
                  <AvatarFallback className={cn('text-white font-medium', avatarColor(name))}>
                    {getInitials(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p
                      className={cn(
                        'font-medium text-sm truncate',
                        isSelected ? 'text-accent-foreground' : 'text-foreground'
                      )}
                    >
                      {name}
                    </p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isOpening ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                      ) : conv && conv.unreadCount > 0 ? (
                        <Badge variant="destructive" className="h-4.5 min-w-[18px] px-1 text-[10px] leading-none flex items-center justify-center">
                          {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
                        </Badge>
                      ) : null}
                      {conv && (
                        <span className={cn('text-[11px]', isSelected ? 'text-accent-foreground/60' : 'text-muted-foreground')}>
                          {relativeTime(conv.lastMessageTime)}
                        </span>
                      )}
                    </div>
                  </div>
                  {user.userType?.trim() ? (
                    <p className={cn('text-xs truncate', isSelected ? 'text-accent-foreground/70' : 'text-muted-foreground')}>
                      {user.userType.trim()}
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      'text-xs truncate',
                      isSelected ? 'text-accent-foreground/80' : 'text-muted-foreground'
                    )}
                  >
                    {conv?.lastMessage ?? user.email}
                  </p>
                  {user.subCompany?.name ? (
                    <p
                      className={cn(
                        'text-xs truncate',
                        isSelected ? 'text-accent-foreground/60' : 'text-muted-foreground/70'
                      )}
                    >
                      {user.subCompany.name}
                    </p>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
