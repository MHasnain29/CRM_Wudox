import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
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

  const list = useInfiniteQuery({
    queryKey: ['email-mailbox', scopeKey, folder, 'infinite'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => fetchEmails(
      { ...scope, folder, page: pageParam, limit: 50 },
      { signal, throwOnError: true },
    ),
    getNextPageParam: (last) => {
      const { page, totalPages } = last.pagination;
      return last.data.length > 0 && page < totalPages ? page + 1 : undefined;
    },
    enabled,
    staleTime: 0,
    // A failed page stays visible with an explicit retry, rather than a scroll
    // observer repeatedly retrying a request while its sentinel is in view.
    retry: false,
  });
  const emails = useMemo(() => {
    const byId = new Map<string, ApiEmailListItem>();
    for (const page of list.data?.pages ?? []) {
      for (const email of page.data) {
        if (!byId.has(email.id)) byId.set(email.id, email);
      }
    }
    return [...byId.values()];
  }, [list.data]);
  const firstPage = list.data?.pages[0];
  const inbox = useQuery({
    queryKey: ['email-mailbox-unread', scopeKey],
    queryFn: ({ signal }) => fetchEmails(
      { ...scope, folder: 'inbox', limit: 1 },
      { signal, throwOnError: true },
    ),
    enabled: enabled && folder !== 'inbox',
    staleTime: 0,
  });
  const refreshList = list.refetch;
  const refreshInbox = inbox.refetch;
  const refetch = useCallback(async () => {
    if (!enabled) return;
    // Infinite-query refetches every loaded page in order. This reconciles
    // offsets after arrivals/deletions without discarding the visible rows.
    await Promise.all([refreshList(), ...(folder !== 'inbox' ? [refreshInbox()] : [])]);
  }, [enabled, folder, refreshList, refreshInbox]);
  useEffect(() => onEmailRefresh(() => { void refetch(); }), [refetch]);
  const { fetchNextPage, hasNextPage, isFetching, isLoadingError, isRefetchError } = list;
  const loadNextPage = useCallback(async () => {
    if (!enabled || isFetching) return;
    // After a failed refresh, offsets may have shifted. Reconcile the loaded
    // pages successfully before allowing any append; also retry initial errors.
    if (isLoadingError || isRefetchError) {
      await refetch();
      return;
    }
    if (!hasNextPage) return;
    // Also coalesce calls made before React renders the fetching state, and
    // never cancel a refresh that is reconciling already loaded pages.
    await fetchNextPage({ cancelRefetch: false });
  }, [enabled, hasNextPage, isFetching, isLoadingError, isRefetchError, refetch, fetchNextPage]);

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
    emails: enabled ? emails : [],
    totalCount: enabled ? firstPage?.pagination.total ?? 0 : 0,
    unreadCount: enabled ? (folder === 'inbox' ? firstPage?.unreadCount : inbox.data?.unreadCount) ?? 0 : 0,
    isLoading: !enabled || list.isLoading,
    error: list.data ? null : list.error,
    hasNextPage: enabled && list.hasNextPage,
    isFetching: list.isFetching,
    isFetchingNextPage: list.isFetchingNextPage,
    // All list errors pause the scroll observer until the appropriate retry
    // succeeds. Previously loaded rows remain visible throughout recovery.
    nextPageError: list.error,
    loadNextPage,
    refetch,
    selectedEmail: selection.viewKey === viewKey ? selection.email : null,
    loadingDetail: selection.viewKey === viewKey && selection.loading,
    setSelectedEmail,
    selectEmail,
    searchQuery: search.scopeKey === scopeKey ? search.value : '',
    setSearchQuery,
  };
}
