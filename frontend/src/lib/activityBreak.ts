/** A failed response is not proof that the server rejected the transition. Re-read before reporting failure. */
export async function confirmBreakTransition<State extends { onBreak: boolean }>(
  onBreak: boolean,
  send: () => Promise<State | null>,
  refresh: () => Promise<State | null>,
): Promise<State> {
  try {
    const response = await send();
    if (response?.onBreak === onBreak) return response;
  } catch { /* The server may have persisted the change before the connection failed. */ }
  const current = await refresh().catch(() => null);
  if (current?.onBreak === onBreak) return current;
  throw new Error(onBreak
    ? 'Could not confirm the break started. Please try again.'
    : 'Could not confirm the break ended. Please try again.');
}

/** Server-relative elapsed time avoids depending on the employee computer's wall clock. */
export function confirmedBreakSeconds(startedAt: string | null, serverTime: string): number | null {
  if (!startedAt) return null;
  const elapsed = Date.parse(serverTime) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.floor(elapsed / 1000) : null;
}
