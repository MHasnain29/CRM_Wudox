/**
 * Google Calendar service.
 * Creates/updates/deletes Google Calendar events with Google Meet links.
 * Token stored at SubCompany level — one agency-wide Google account (connected by director).
 */
import { google } from 'googleapis';
import { env } from '../config/env';
import { encryptToken, decryptToken } from '../utils/secretsCrypto';

export { encryptToken, decryptToken };

function isConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

// ── OAuth URL ────────────────────────────────────────────────────────────────

/** Returns the URL to redirect the director to for Google OAuth consent. */
export function getGoogleAuthUrl(state: string): string {
  if (!isConfigured()) throw new Error('Google OAuth is not configured');
  const oauth2Client = getGoogleOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // always return refresh_token
    scope: [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.freebusy',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    state,
    // Restrict to Google Workspace domain if configured (blocks personal Gmail)
    ...(env.GOOGLE_WORKSPACE_DOMAIN ? { hd: env.GOOGLE_WORKSPACE_DOMAIN } : {}),
  });
}

// ── Token exchange ───────────────────────────────────────────────────────────

/** Exchange authorization code for tokens. Returns raw refreshToken. */
export async function exchangeCodeForTokens(code: string): Promise<{ refreshToken: string }> {
  if (!isConfigured()) throw new Error('Google OAuth is not configured');
  const oauth2Client = getGoogleOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned — revoke app access in Google account and reconnect');
  }
  return { refreshToken: tokens.refresh_token };
}

// ── Connected account info ───────────────────────────────────────────────────

/** Get the email address of the Google account behind a refresh token. */
export async function getGoogleAccountEmail(refreshToken: string): Promise<string | null> {
  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();
    return data.email ?? null;
  } catch {
    return null;
  }
}

// ── Calendar operations ──────────────────────────────────────────────────────

export interface CreateEventResult {
  googleEventId: string;
  meetLink: string;
}

/** Result type that distinguishes revoked tokens from other errors. */
export type GcalCreateResult =
  | { ok: true; googleEventId: string; meetLink: string }
  | { ok: false; revoked: boolean };

/**
 * Create a Google Calendar event with a Google Meet link.
 * Returns typed result — check `ok` and `revoked` for error handling.
 */
export async function createCalendarEventWithMeet(params: {
  refreshToken: string;
  title: string;
  startTime: Date;
  endTime: Date;
  attendeeEmails?: string[];
  description?: string | null;
  location?: string | null;
}): Promise<GcalCreateResult> {
  if (!isConfigured()) return { ok: false, revoked: false };
  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: params.refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const event = await calendar.events.insert({
      calendarId: 'primary',
      conferenceDataVersion: 1,
      sendUpdates: 'none',
      requestBody: {
        summary: params.title,
        description: params.description ?? undefined,
        location: params.location ?? undefined,
        start: { dateTime: params.startTime.toISOString(), timeZone: 'UTC' },
        end: { dateTime: params.endTime.toISOString(), timeZone: 'UTC' },
        attendees: params.attendeeEmails?.map((email) => ({ email })) ?? [],
        conferenceData: {
          createRequest: {
            requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            conferenceSolutionKey: { type: 'hangoutsMeet' },
          },
        },
      },
    });

    const googleEventId = event.data.id;
    const meetLink = event.data.hangoutLink ?? event.data.conferenceData?.entryPoints?.[0]?.uri;

    if (!googleEventId || !meetLink) return { ok: false, revoked: false };
    return { ok: true, googleEventId, meetLink };
  } catch (err: any) {
    console.error('[googleCalendar] Failed to create event:', err);
    const revoked = err?.code === 401 || err?.message?.includes('invalid_grant');
    return { ok: false, revoked };
  }
}

/**
 * Update an existing Google Calendar event (title, time, description, guests).
 */
export async function updateCalendarEvent(params: {
  refreshToken: string;
  googleEventId: string;
  title?: string;
  startTime?: Date;
  endTime?: Date;
  description?: string | null;
  location?: string | null;
  /** When set, replaces Google event attendees with this list. */
  attendeeEmails?: string[];
}): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: params.refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const patch: Record<string, any> = {};
    if (params.title) patch.summary = params.title;
    if (params.description !== undefined) patch.description = params.description ?? '';
    if (params.location !== undefined) patch.location = params.location ?? '';
    if (params.startTime) patch.start = { dateTime: params.startTime.toISOString(), timeZone: 'UTC' };
    if (params.endTime) patch.end = { dateTime: params.endTime.toISOString(), timeZone: 'UTC' };
    if (params.attendeeEmails !== undefined) {
      patch.attendees = params.attendeeEmails.map((email) => ({ email }));
    }

    await calendar.events.patch({
      calendarId: 'primary',
      eventId: params.googleEventId,
      sendUpdates: 'none',
      requestBody: patch,
    });
    return true;
  } catch (err) {
    console.error('[googleCalendar] Failed to update event:', err);
    return false;
  }
}

/**
 * Query Google FreeBusy for calendar ids (usually user emails) in a time window.
 * Soft signal only — fails open when Google is unavailable or calendars are not visible
 * to the agency-connected account (typically same Workspace domain).
 */
export async function queryCalendarFreeBusy(params: {
  refreshToken: string;
  timeMin: Date;
  timeMax: Date;
  calendarIds: string[];
}): Promise<{ ok: true; busyByCalendar: Record<string, boolean> } | { ok: false }> {
  if (!isConfigured()) return { ok: false };
  const ids = [...new Set(params.calendarIds.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 0) return { ok: true, busyByCalendar: {} };
  if (params.timeMax <= params.timeMin) return { ok: false };

  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: params.refreshToken });
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: params.timeMin.toISOString(),
        timeMax: params.timeMax.toISOString(),
        items: ids.map((id) => ({ id })),
      },
    });

    const busyByCalendar: Record<string, boolean> = {};
    for (const id of ids) {
      const cal = data.calendars?.[id];
      const busy = (cal?.busy ?? []).length > 0;
      busyByCalendar[id] = busy;
    }
    return { ok: true, busyByCalendar };
  } catch (err) {
    console.error('[googleCalendar] FreeBusy query failed:', err);
    return { ok: false };
  }
}

/**
 * Delete a Google Calendar event.
 */
export async function deleteCalendarEvent(params: {
  refreshToken: string;
  googleEventId: string;
}): Promise<boolean> {
  if (!isConfigured()) return false;
  try {
    const oauth2Client = getGoogleOAuthClient();
    oauth2Client.setCredentials({ refresh_token: params.refreshToken });

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: params.googleEventId,
      sendUpdates: 'none',
    });
    return true;
  } catch (err) {
    console.error('[googleCalendar] Failed to delete event:', err);
    return false;
  }
}
