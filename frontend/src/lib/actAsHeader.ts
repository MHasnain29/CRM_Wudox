/**
 * Module-level singleton that holds the current act-as user ID.
 * Updated by Layout.tsx (always mounted) via useActAs() → useEffect.
 * Read by getAuthHeaders() in api.ts so every API call carries the header.
 *
 * Plain module variable (not Zustand) so getAuthHeaders() can read it
 * synchronously without a React context — no render-cycle gap.
 * Cleared automatically on page reload (agency switch does window.location.href).
 */
let _actAsUserId: string | null = null;

export const actAsHeader = {
  set(id: string | null): void {
    _actAsUserId = id;
  },
  get(): string | null {
    return _actAsUserId;
  },
};
