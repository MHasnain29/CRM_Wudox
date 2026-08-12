/**
 * Toast notification deduplication.
 *
 * Uses localStorage namespaced by userId with a 7-day TTL so shown IDs persist
 * across page refreshes without needing to mark notifications as read on the server.
 *
 * Falls back to a per-userId in-memory Map when localStorage is unavailable
 * (private browsing, storage quota exceeded, etc.).
 *
 * Call markShown() BEFORE toast() so any concurrent async call reading
 * hasBeenShown() immediately sees the IDs as claimed (JS is single-threaded;
 * no await between markShown and toast()).
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// In-memory fallback: userId → Set<notificationId>
const memoryFallback = new Map<string, Set<string>>();

function storageKey(userId: string): string {
  return `notif_toasted_${userId}`;
}

function isLocalStorageAvailable(): boolean {
  try {
    const k = '__ls_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function load(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function save(userId: string, data: Record<string, string>): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(data));
  } catch {
    // Quota exceeded or unavailable — silently ignore; in-memory fallback handles it
  }
}

/** Remove entries older than TTL to prevent unbounded storage growth. */
function cleanup(data: Record<string, string>): Record<string, string> {
  const cutoff = Date.now() - TTL_MS;
  return Object.fromEntries(
    Object.entries(data).filter(([, ts]) => new Date(ts).getTime() > cutoff)
  );
}

export function hasBeenShown(id: string, userId: string): boolean {
  if (!isLocalStorageAvailable()) {
    return memoryFallback.get(userId)?.has(id) ?? false;
  }
  try {
    return id in load(userId);
  } catch {
    return false;
  }
}

export function markShown(ids: string[], userId: string): void {
  if (!isLocalStorageAvailable()) {
    if (!memoryFallback.has(userId)) memoryFallback.set(userId, new Set());
    for (const id of ids) memoryFallback.get(userId)!.add(id);
    return;
  }
  try {
    const data = cleanup(load(userId));
    const now = new Date().toISOString();
    for (const id of ids) data[id] = now;
    save(userId, data);
  } catch {
    // Silently degrade to in-memory
    if (!memoryFallback.has(userId)) memoryFallback.set(userId, new Set());
    for (const id of ids) memoryFallback.get(userId)!.add(id);
  }
}

/** Call on logout to ensure the next login re-shows any still-unread notifications. */
export function clearShown(userId: string): void {
  memoryFallback.delete(userId);
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // ignore
  }
}
