import { useCallback, useEffect, useState } from 'react';
import { fetchApprovalMetadata } from '@/lib/api';
import {
  clearApprovalMetadataCache,
  getApprovalMetadataCache,
  getMetadataInflight,
  isApprovalMetadataComplete,
  registerMetadataInflight,
  setApprovalMetadataCache,
  type ApprovalMetadata,
} from '@/lib/approvalMetadataStore';

export function useApprovalMetadata(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [metadata, setMetadata] = useState<ApprovalMetadata | null>(() => getApprovalMetadataCache());
  const [loading, setLoading] = useState(enabled && !getApprovalMetadataCache());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    let existing = getApprovalMetadataCache();
    if (existing && !isApprovalMetadataComplete(existing)) {
      clearApprovalMetadataCache();
      existing = null;
    }
    if (existing) {
      setMetadata(existing);
      setLoading(false);
      setError(null);
      return existing;
    }

    const pending = getMetadataInflight();
    if (pending) {
      setLoading(true);
      try {
        const data = await pending;
        setMetadata(data);
        setError(null);
        return data;
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to load approval metadata';
        setError(message);
        throw e;
      } finally {
        setLoading(false);
      }
    }

    setLoading(true);
    setError(null);
    const promise = fetchApprovalMetadata();
    registerMetadataInflight(promise);
    try {
      const data = await promise;
      setApprovalMetadataCache(data);
      setMetadata(data);
      return data;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load approval metadata';
      setError(message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load().catch(() => undefined);
  }, [enabled, load]);

  return { metadata, loading, error, reload: load };
}

/** Prefetch metadata after login (idempotent). */
export async function prefetchApprovalMetadata(): Promise<void> {
  if (getApprovalMetadataCache() || getMetadataInflight()) return;
  const promise = fetchApprovalMetadata();
  registerMetadataInflight(promise);
  try {
    const data = await promise;
    setApprovalMetadataCache(data);
  } catch {
    // Non-fatal; pages can retry
  }
}
