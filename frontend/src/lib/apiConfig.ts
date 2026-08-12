/** Shared API base URL and tunnel helpers (used by api.ts and socket.ts). */

export const API_BASE = import.meta.env.VITE_API_URL ?? 'https://staffing.wudox.ca';
export const API_PREFIX = `${API_BASE}/api/v1`;

/**
 * ngrok free tier shows a browser warning page (HTML 200, no CORS) unless this header is sent.
 * Required when VITE_API_URL points at *.ngrok-free.app / *.ngrok.app in local dev.
 */
export function getTunnelHeaders(): Record<string, string> {
  if (/ngrok(-free)?\.(app|dev)/i.test(API_BASE)) {
    return { 'ngrok-skip-browser-warning': 'true' };
  }
  return {};
}
