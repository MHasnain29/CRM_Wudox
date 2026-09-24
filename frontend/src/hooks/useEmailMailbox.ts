import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchEmails, fetchEmailById, markEmailRead, type ApiEmailDetail, type ApiEmailListItem } from '@/lib/api';
import { onEmailRefresh } from '@/lib/socket';
import { toast } from 'sonner';

export type EmailMailboxScope = Pick<Parameters<typeof fetchEmails>[0], 'agencyIds' | 'ownerIds' | 'ownerExact' | 'filterMode'>;

/** All email views use the same exact scope for the list and Inbox count. */
export function useEmailMailbox(
  scope: EmailMailboxScope,
  scopeKey: string,
  folder: 'inbox' | 'sent' | 'drafts',
  enabled = true,
  onRead?: () => void,
) {
  const viewKey = `${scopeKey}|${folder}`;
  const activeView = useRef(viewKey);
  activeView.current = viewKey;
  const requestId = useRef(0);
  useEffect(() => () => { ++requestId.current; }, [viewKey]);
  const [search, setSearch] = useState({ scopeKey, value: '' });
  const [selection, setSelection] = useState<{ viewKey: string; email: ApiEmailDetail | null; loading: boolean }>({
    viewKey, email: null, loading: false,
  });
  // Clear state when the scope changes, including a switch back to a prior
  // scope. Keying the visible values also prevents a one-frame stale detail.
  useEffect(() => {
    setSearch({ scopeKey, value: '' });
  }, [scopeKey]);
  useEffect(() => {
    setSelection({ viewKey, email: null, loading: false });
  }, [viewKey]);
  const setSearchQuery = (value: string) => setSearch({ scopeKey, value });
  const setSelectedEmail = useCallback((email: ApiEmailDetail | null) => {
    ++requestId.current;
    setSelection({ viewKey, email, loading: false });
  }, [viewKey]);

  const list = useQuery({
    queryKey: ['email-mailbox', scopeKey, folder],
    queryFn: () => fetchEmails({ ...scope, folder, limit: 100 }),
    enabled,
    staleTime: 0,
  });
  const inbox = useQuery({
    queryKey: ['email-mailbox-unread', scopeKey],
    queryFn: () => fetchEmails({ ...scope, folder: 'inbox', limit: 1 }),
    enabled: enabled && folder !== 'inbox',
    staleTime: 0,
  });
  const refreshList = list.refetch;
  const refreshInbox = inbox.refetch;
  const refetch = useCallback(async () => {
    if (!enabled) return;
    await Promise.all([refreshList(), ...(folder !== 'inbox' ? [refreshInbox()] : [])]);
  }, [enabled, folder, refreshList, refreshInbox]);
  useEffect(() => onEmailRefresh(() => { void refetch(); }), [refetch]);

  const selectEmail = async (item: ApiEmailListItem) => {
    const id = ++requestId.current;
    const isCurrent = () => id === requestId.current && viewKey === activeView.current;
    setSelection({ viewKey, email: null, loading: true });
    try {
      const email = await fetchEmailById(item.id);
      if (!isCurrent()) return;
      setSelection({ viewKey, email, loading: false });
      if (email && folder === 'inbox' && !email.isRead) {
        await markEmailRead(email.id);
        if (isCurrent()) { void refetch(); onRead?.(); }
      }
    } catch {
      if (isCurrent()) toast.error('Could not load email. Please try again.');
    } finally {
      if (isCurrent()) setSelection((prev) => ({ ...prev, loading: false }));
    }
  };

  return {
    emails: enabled ? list.data?.data ?? [] : [],
    unreadCount: enabled ? (folder === 'inbox' ? list.data?.unreadCount : inbox.data?.unreadCount) ?? 0 : 0,
    isLoading: !enabled || list.isLoading,
    error: list.error,
    refetch,
    selectedEmail: selection.viewKey === viewKey ? selection.email : null,
    loadingDetail: selection.viewKey === viewKey && selection.loading,
    setSelectedEmail,
    selectEmail,
    searchQuery: search.scopeKey === scopeKey ? search.value : '',
    setSearchQuery,
  };
}
