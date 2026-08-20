import sgMail from '@sendgrid/mail';
import prisma from '../config/database';
import { env } from '../config/env';
import { enqueueOutboundEmail, shouldSendNow } from './emailSendWindow';
import type { SenderIdentity } from './sender';
import { resolveSenderSignatureBlock, resolveUserSender, senderUserSelect, toSendGridFrom } from './sender';
import { resolveOmSendingEmail } from './omAgencyEmail';
import { isGlobalSendAsUser } from './globalSendAsEligibility';
import { getSendGridAuthenticatedDomains } from './sendgridAuthenticatedDomains';
import { SenderDomainVerificationUnavailableError } from './senderDomainErrors';
import { DEFAULT_BRAND_NAME } from '../config/branding';

function isSendGridConfigured(): boolean {
  return Boolean(env.SENDGRID_API_KEY);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Sanitize rich-text HTML produced by EmailRichTextEditor for safe inclusion
 * in outbound emails. Strips dangerous tags (script/style/iframe/object/embed/link/meta),
 * inline event handlers (on*=), and javascript:/data: URLs while preserving normal
 * formatting tags (p, br, strong, em, ul/ol/li, a, span, etc.).
 */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return '';
  let html = String(input);
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|link|meta|noscript)\b[^>]*\/?>/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*"[^"]*"/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*'[^']*'/gi, '');
  html = html.replace(/\s(on[a-z]+)\s*=\s*[^\s>]+/gi, '');
  html = html.replace(/(href|src|xlink:href)\s*=\s*"\s*(javascript|data|vbscript):[^"]*"/gi, '$1="#"');
  html = html.replace(/(href|src|xlink:href)\s*=\s*'\s*(javascript|data|vbscript):[^']*'/gi, "$1='#'");
  return html;
}

/**
 * Convert rich-text HTML to a plain-text representation for the text/plain
 * email body. Preserves line breaks for block tags and decodes common entities.
 */
export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return '';
  let s = String(input);
  s = s.replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  s = s.replace(/<\s*br\s*\/?\s*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;/gi, ' ')
       .replace(/&amp;/gi, '&')
       .replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>')
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'");
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** Agency branding passed to every email template. */
export interface AgencyBranding {
  name: string;
  logoUrl?: string | null;
  emailFooterText?: string | null;
  emailSignatureTemplate?: string | null;
  emailTagline?: string | null;
  // Per-agency email sending identity (resolved with fallback chain — never undefined after fetch)
  emailFromAddress: string;          // DB ?? env.EMAIL_FROM ?? ''
  emailFromName: string;             // DB ?? env.EMAIL_FROM_NAME ?? DEFAULT_BRAND_NAME
  emailSendAsDomain: string | null;  // DB ?? first of SEND_AS_ALLOWED_DOMAINS ?? null
  emailInboundDomain: string | null; // DB ?? env.EMAIL_INBOUND_DOMAIN ?? null
  emailInboundLocalpart: string | null; // DB ?? env.EMAIL_INBOUND_LOCALPART ?? null
}

const _brandingCache = new Map<string, { data: AgencyBranding; expiresAt: number }>();
const _BRANDING_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Invalidate cached branding for an agency immediately (call after config update). */
export function invalidateAgencyBrandingCache(subCompanyId: string): void {
  _brandingCache.delete(subCompanyId);
}

/**
 * Fetch agency branding + email config for a given subCompanyId.
 * Results are cached for 5 minutes. Call invalidateAgencyBrandingCache after updates.
 * Returns undefined when the subCompany is not found.
 */
export async function getAgencyBranding(subCompanyId: string | null | undefined): Promise<AgencyBranding | undefined> {
  if (!subCompanyId) return undefined;
  const now = Date.now();
  const cached = _brandingCache.get(subCompanyId);
  if (cached && cached.expiresAt > now) return cached.data;

  const sc = await prisma.subCompany.findUnique({
    where: { id: subCompanyId },
    select: {
      name: true,
      agencyLogoUrl: true,
      emailFooterText: true,
      emailSignatureTemplate: true,
      emailTagline: true,
      emailFromAddress: true,
      emailFromName: true,
      emailSendAsDomain: true,
      emailInboundDomain: true,
      emailInboundLocalpart: true,
    },
  }).catch(() => undefined);
  if (!sc) return undefined;
  const data: AgencyBranding = {
    name: sc.name?.trim() || 'Agency',
    logoUrl: sc.agencyLogoUrl?.trim() || null,
    emailFooterText: sc.emailFooterText,
    emailSignatureTemplate: sc.emailSignatureTemplate ?? null,
    emailTagline: sc.emailTagline ?? null,
    emailFromAddress: sc.emailFromAddress ?? env.EMAIL_FROM ?? '',
    emailFromName: sc.emailFromName ?? env.EMAIL_FROM_NAME ?? DEFAULT_BRAND_NAME,
    emailSendAsDomain: sc.emailSendAsDomain
      ?? (env.SEND_AS_ALLOWED_DOMAINS?.split(',')[0]?.trim() || null),
    emailInboundDomain: sc.emailInboundDomain ?? env.EMAIL_INBOUND_DOMAIN ?? null,
    emailInboundLocalpart: sc.emailInboundLocalpart ?? env.EMAIL_INBOUND_LOCALPART ?? null,
  };
  _brandingCache.set(subCompanyId, { data, expiresAt: now + _BRANDING_TTL_MS });
  return data;
}

/** Build a minimal AgencyBranding from just a display name (env-based email config as fallback). */
function minimalBranding(name: string): AgencyBranding {
  return {
    name,
    emailFromAddress: env.EMAIL_FROM ?? '',
    emailFromName: env.EMAIL_FROM_NAME ?? DEFAULT_BRAND_NAME,
    emailSendAsDomain: env.SEND_AS_ALLOWED_DOMAINS?.split(',')[0]?.trim() || null,
    emailInboundDomain: env.EMAIL_INBOUND_DOMAIN ?? null,
    emailInboundLocalpart: env.EMAIL_INBOUND_LOCALPART ?? null,
  };
}

/**
 * Build the CRM reply-to address for any outbound email.
 * When the client replies, SendGrid Inbound Parse routes it back to the CRM inbox.
 * emailId can be an Email record ID (for threading) or any UUID (meeting/campaign — routes to inbox without thread).
 */
export function buildCrmReplyToAddress(
  emailId: string,
  userId: string,
  agency?: { emailInboundDomain?: string | null; emailInboundLocalpart?: string | null; emailFromAddress?: string | null } | null,
): string {
  const fromAddr = (agency?.emailFromAddress || '').trim();
  const m = fromAddr.match(/^([^@]+)@(.+)$/);
  const fromLocal = m?.[1] ?? 'reply';
  const fromDomain = m?.[2] ?? '';
  const local = (agency?.emailInboundLocalpart || env.EMAIL_INBOUND_LOCALPART || fromLocal).trim();
  const domain = (agency?.emailInboundDomain || env.EMAIL_INBOUND_DOMAIN || fromDomain).trim();
  return `${local}+crmreply-${emailId}.${userId}@${domain}`;
}

/** Resolve the From identity from agency config (DB-first; env fallback already baked into AgencyBranding). */
function agencyFrom(agency?: AgencyBranding | null): { email: string; name: string } {
  return {
    email: agency?.emailFromAddress || env.EMAIL_FROM || '',
    name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME,
  };
}

/**
 * CRM user-driven outbound From — single choke point.
 * Routes must not call resolveUserSender directly for compose / campaigns /
 * meetings / proposals / pandadoc CRM mail.
 *
 * Phase A: same behavior as legacy resolveEmailSender + reason logging.
 * Phase B: Super User SendGrid personal domains (eligible roles only).
 */
export type OutboundSenderReason =
  | 'om_agency_email'
  | 'agency_domain_match'
  | 'sendgrid_authenticated'
  | 'agency_system_fallback'
  | 'send_as_disabled'
  | 'override_email';

export type OutboundSenderResult = {
  from: SenderIdentity;
  agency: AgencyBranding | undefined;
  reason: OutboundSenderReason;
};

export type ResolveOutboundUserSenderOpts = {
  userId: string | null | undefined;
  subCompanyId: string;
  /** default true — OM agencyEmail wins (self-send). Reply-as passes false. */
  applyOmAgencyEmail?: boolean;
};

function classifyAfterUserSender(
  user: { sendAsDisabled: boolean } | null | undefined,
  from: SenderIdentity,
  overrideEmail: string | undefined,
): OutboundSenderReason {
  if (user?.sendAsDisabled) return 'send_as_disabled';
  if (!from.userId) return 'agency_system_fallback';
  if (overrideEmail && from.email.toLowerCase() === overrideEmail.toLowerCase()) {
    return 'override_email';
  }
  return 'agency_domain_match';
}

export async function resolveOutboundUserSender(
  opts: ResolveOutboundUserSenderOpts,
): Promise<OutboundSenderResult> {
  const { userId, subCompanyId } = opts;
  const applyOm = opts.applyOmAgencyEmail !== false;
  const overrideEmail = env.SEND_AS_OVERRIDE_EMAIL;

  const [user, agency, omLink] = await Promise.all([
    userId
      ? prisma.user.findUnique({ where: { id: userId }, select: { ...senderUserSelect, role: true } })
      : Promise.resolve(null),
    getAgencyBranding(subCompanyId),
    userId && applyOm
      ? prisma.operationsManagerSubCompany.findUnique({
          where: { userId_subCompanyId: { userId, subCompanyId } },
          select: { agencyEmail: true },
        })
      : Promise.resolve(null),
  ]);

  const systemSender: SenderIdentity = {
    email: agency?.emailFromAddress || '',
    name: agency?.emailFromName || agency?.name || DEFAULT_BRAND_NAME,
  };

  if (applyOm) {
    const omEmail = resolveOmSendingEmail(user?.role, omLink?.agencyEmail);
    if (omEmail && user) {
      const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || 'Staff';
      // Match legacy resolveEmailSender: OM path does not apply SEND_AS_OVERRIDE_EMAIL.
      const from: SenderIdentity = { email: omEmail, name, userId: user.id };
      const reason: OutboundSenderReason = 'om_agency_email';
      console.log(
        `[outbound-sender] user=${user.id} agency=${subCompanyId} from=${from.email} reason=${reason}`,
      );
      return { from, agency, reason };
    }
  }

  // Super / multi-agency users: agency domain match OR SendGrid-authenticated personal domain.
  if (user && isGlobalSendAsUser(user.role)) {
    const candidate = (user.sendAsEmail || user.email || '').toLowerCase().trim();
    const domain = candidate.split('@')[1]?.toLowerCase() ?? '';
    const agencyDomain = (agency?.emailSendAsDomain ?? '').toLowerCase() || null;

    if (user.sendAsDisabled) {
      const from = resolveUserSender(user, agency?.emailSendAsDomain ?? null, systemSender, overrideEmail);
      const reason = classifyAfterUserSender(user, from, overrideEmail);
      console.log(
        `[outbound-sender] user=${user.id} agency=${subCompanyId} from=${from.email || '(empty)'} reason=${reason}`,
      );
      return { from, agency, reason };
    }

    if (agencyDomain && domain === agencyDomain) {
      const from = resolveUserSender(user, agency?.emailSendAsDomain ?? null, systemSender, overrideEmail);
      const reason = classifyAfterUserSender(user, from, overrideEmail);
      console.log(
        `[outbound-sender] user=${user.id} agency=${subCompanyId} from=${from.email || '(empty)'} reason=${reason}`,
      );
      return { from, agency, reason };
    }

    let domains: string[];
    try {
      domains = await getSendGridAuthenticatedDomains();
    } catch (err) {
      if (err instanceof SenderDomainVerificationUnavailableError) throw err;
      console.warn('[outbound-sender] SendGrid domain list failed:', err);
      throw new SenderDomainVerificationUnavailableError();
    }

    const from = resolveUserSender(
      user,
      agency?.emailSendAsDomain ?? null,
      systemSender,
      overrideEmail,
      { extraAllowedDomains: domains, requireAllowedDomain: true },
    );
    const reason: OutboundSenderReason =
      overrideEmail && from.email.toLowerCase() === overrideEmail.toLowerCase()
        ? 'override_email'
        : 'sendgrid_authenticated';
    console.log(
      `[outbound-sender] user=${user.id} agency=${subCompanyId} from=${from.email} reason=${reason}`,
    );
    return { from, agency, reason };
  }

  const from = resolveUserSender(
    user,
    agency?.emailSendAsDomain ?? null,
    systemSender,
    overrideEmail,
  );
  const reason = classifyAfterUserSender(user, from, overrideEmail);
  console.log(
    `[outbound-sender] user=${userId ?? 'none'} agency=${subCompanyId} from=${from.email || '(empty)'} reason=${reason}`,
  );
  return { from, agency, reason };
}

/** @deprecated Prefer resolveOutboundUserSender — thin compatibility wrapper. */
export async function resolveEmailSender(
  userId: string | null | undefined,
  subCompanyId: string,
): Promise<{ from: SenderIdentity; agency: AgencyBranding | undefined; reason: OutboundSenderReason }> {
  return resolveOutboundUserSender({ userId, subCompanyId, applyOmAgencyEmail: true });
}

export { resolveOmSendingEmail } from './omAgencyEmail';

/** Client fields included in lead-related emails (manager request + assignment). */
export interface LeadEmailClientDetails {
  name: string;
  corporateCode: string;
  industry?: string | null;
  location?: string | null;
  address?: string | null;
  companySize?: string | null;
  primaryContact?: {
    name: string;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  tags?: string[];
}

/** Lead row fields for assignment emails. */
export interface LeadEmailLeadFields {
  id: string;
  stage: string;
  status: string;
  temperature?: string | null;
  value?: unknown;
  notes?: string | null;
  nextFollowUp?: Date | string | null;
}

/**
 * Load client + primary contact + agency tags for email bodies.
 */
export async function fetchClientDetailsForEmail(
  clientId: string,
  subCompanyId: string
): Promise<LeadEmailClientDetails> {
  const [client, tagRows] = await Promise.all([
    prisma.client.findUnique({
      where: { id: clientId },
      select: {
        name: true,
        corporateCode: true,
        industry: true,
        location: true,
        address: true,
        companySize: true,
        contacts: {
          where: { isPrimary: true },
          take: 1,
          select: {
            name: true,
            title: true,
            email: true,
            phone: true,
            phoneExtension: true,
          },
        },
      },
    }),
    prisma.clientTag.findMany({
      where: { clientId, subCompanyId },
      select: { tag: true },
      orderBy: { tag: 'asc' },
    }),
  ]);

  if (!client) {
    return { name: 'Unknown client', corporateCode: '—' };
  }

  const c0 = client.contacts[0];
  let phoneLine: string | null = null;
  if (c0?.phone) {
    phoneLine = c0.phoneExtension ? `${c0.phone} ext. ${c0.phoneExtension}` : c0.phone;
  }

  return {
    name: client.name,
    corporateCode: client.corporateCode,
    industry: client.industry,
    location: client.location,
    address: client.address,
    companySize: client.companySize,
    primaryContact: c0
      ? {
          name: c0.name,
          title: c0.title,
          email: c0.email,
          phone: phoneLine,
        }
      : null,
    tags: tagRows.map((t) => t.tag),
  };
}

function formatDateForEmail(d: Date | string | null | undefined): string | undefined {
  if (d == null) return undefined;
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatLeadCurrencyValue(v: unknown): string | undefined {
  if (v == null) return undefined;
  const raw = typeof v === 'object' && v !== null && 'toString' in v ? (v as { toString: () => string }).toString() : String(v);
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw || undefined;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function humanizeStageKey(stage: string): string {
  return stage.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const LEAD_NOTES_EMAIL_MAX = 2000;

function truncateForEmail(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

/** Inner HTML for the “client profile” card (lead request + assignment emails). */
function buildClientProfileCardInnerHtml(d: LeadEmailClientDetails): string {
  const lines: string[] = [];
  lines.push(`<strong>Company:</strong> ${escapeHtml(d.name)}<br>`);
  lines.push(`<strong>Corporate code:</strong> ${escapeHtml(d.corporateCode || '—')}<br>`);
  if (d.industry?.trim()) lines.push(`<strong>Industry:</strong> ${escapeHtml(d.industry.trim())}<br>`);
  if (d.location?.trim()) lines.push(`<strong>Location:</strong> ${escapeHtml(d.location.trim())}<br>`);
  if (d.address?.trim()) lines.push(`<strong>Address:</strong> ${escapeHtml(d.address.trim())}<br>`);
  if (d.companySize?.trim()) lines.push(`<strong>Company size:</strong> ${escapeHtml(d.companySize.trim())}<br>`);

  if (d.primaryContact) {
    const pc = d.primaryContact;
    lines.push(`<br><strong>Primary contact</strong><br>`);
    lines.push(`${escapeHtml(pc.name)}${pc.title?.trim() ? ` — ${escapeHtml(pc.title.trim())}` : ''}<br>`);
    if (pc.email?.trim()) lines.push(`${escapeHtml(pc.email.trim())}<br>`);
    if (pc.phone?.trim()) lines.push(`${escapeHtml(pc.phone.trim())}<br>`);
  }

  if (d.tags && d.tags.length > 0) {
    lines.push(`<br><strong>Tags:</strong> ${escapeHtml(d.tags.join(', '))}`);
  }

  return `<p style="margin:0;line-height:1.65">${lines.join('')}</p>`;
}

function buildLeadSnapshotCardInnerHtml(lead: LeadEmailLeadFields, extraNote?: string): string {
  const lines: string[] = [];
  lines.push(`<strong>Lead ID:</strong> ${escapeHtml(lead.id)}<br>`);
  lines.push(`<strong>Stage:</strong> ${escapeHtml(humanizeStageKey(lead.stage))}<br>`);
  lines.push(`<strong>Status:</strong> ${escapeHtml(lead.status.replace(/_/g, ' '))}<br>`);
  if (lead.temperature) lines.push(`<strong>Temperature:</strong> ${escapeHtml(lead.temperature)}<br>`);
  const val = formatLeadCurrencyValue(lead.value);
  if (val) lines.push(`<strong>Value:</strong> ${escapeHtml(val)}<br>`);
  const nfu = formatDateForEmail(lead.nextFollowUp ?? undefined);
  if (nfu) lines.push(`<strong>Next follow-up:</strong> ${escapeHtml(nfu)}<br>`);
  if (lead.notes?.trim()) {
    lines.push(`<br><strong>Notes</strong><br>`);
    lines.push(`${escapeHtml(truncateForEmail(lead.notes, LEAD_NOTES_EMAIL_MAX)).replace(/\n/g, '<br>')}`);
  }
  if (extraNote?.trim()) {
    lines.push(`<br><br><strong>Reassignment note</strong><br>${escapeHtml(extraNote.trim())}`);
  }
  return `<p style="margin:0;line-height:1.65">${lines.join('')}</p>`;
}

function appendClientProfileTextLines(d: LeadEmailClientDetails, out: string[]): void {
  out.push(`Company: ${d.name}`);
  out.push(`Corporate code: ${d.corporateCode || '—'}`);
  if (d.industry?.trim()) out.push(`Industry: ${d.industry.trim()}`);
  if (d.location?.trim()) out.push(`Location: ${d.location.trim()}`);
  if (d.address?.trim()) out.push(`Address: ${d.address.trim()}`);
  if (d.companySize?.trim()) out.push(`Company size: ${d.companySize.trim()}`);
  if (d.primaryContact) {
    const pc = d.primaryContact;
    out.push(`Primary contact: ${pc.name}${pc.title?.trim() ? ` (${pc.title.trim()})` : ''}`);
    if (pc.email?.trim()) out.push(`Contact email: ${pc.email.trim()}`);
    if (pc.phone?.trim()) out.push(`Contact phone: ${pc.phone.trim()}`);
  }
  if (d.tags?.length) out.push(`Tags: ${d.tags.join(', ')}`);
}

// ─── Template builder ──────────────────────────────────────────────────────────
// All styles are inline for maximum email client compatibility (Outlook, Gmail, etc.)

function tplButton(text: string, url: string, color: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:20px 0">
    <tr>
      <td style="background:${color};border-radius:6px">
        <a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 28px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">${text}</a>
      </td>
    </tr>
  </table>`;
}

function tplCard(label: string, content: string, bg: string, border: string, textColor: string): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0">
    <tr>
      <td style="background:${bg};border-left:4px solid ${border};border-radius:0 6px 6px 0;padding:14px 18px;font-size:14px;line-height:1.65;color:${textColor}">
        <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;color:${border}">${label}</div>
        ${content}
      </td>
    </tr>
  </table>`;
}

function tplDivider(): string {
  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:22px 0"><tr><td style="height:1px;background:#f1f5f9;font-size:0">&nbsp;</td></tr></table>`;
}

function tplSig(name: string, role: string): string {
  return `<div style="font-size:14px;font-weight:700;color:#111827">${name}</div>
  <div style="font-size:12px;color:#6b7280;margin-top:2px">${role}</div>`;
}

function buildEmail(opts: {
  headerColor: string;
  headerIcon: string;
  headerTitle: string;
  headerSubtitle: string;
  body: string;
  agency?: AgencyBranding;
}): string {
  const { headerColor, headerIcon, headerTitle, headerSubtitle, body, agency } = opts;
  const brandName = agency?.name ?? DEFAULT_BRAND_NAME;
  const safeAgencyName = escapeHtml(brandName);

  // Agency logo removed from all outbound emails — always use the emoji icon in the header
  // and never render a footer logo.
  const headerIconHtml = `<td style="width:48px;height:48px;min-width:48px;background:rgba(255,255,255,.15);border:2px solid rgba(255,255,255,.28);border-radius:12px;text-align:center;vertical-align:middle;font-size:22px;line-height:48px">${headerIcon}</td>`;

  const footerLogoHtml = '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:16px 0">
    <tr><td align="center" style="padding:0 8px">
      <table cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;box-shadow:0 2px 12px rgba(0,0,0,.08)">

        <!-- HEADER -->
        <tr>
          <td style="background:${headerColor};padding:20px 20px">
            <table cellpadding="0" cellspacing="0">
              <tr>
                ${headerIconHtml}
                <td style="padding-left:14px;vertical-align:middle">
                  <div style="font-size:20px;font-weight:700;color:#ffffff;margin:0 0 3px;line-height:1.2">${headerTitle}</div>
                  <div style="font-size:12px;color:rgba(255,255,255,.72);margin:0">${headerSubtitle}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- BODY -->
        <tr>
          <td style="background:#ffffff;padding:20px 16px;font-size:15px;line-height:1.75;color:#374151">
            ${body}
          </td>
        </tr>

        <!-- FOOTER -->
        <tr>
          <td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:14px 16px">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-size:12px;color:#9ca3af">${footerLogoHtml}${safeAgencyName}</td>
                <td align="right" style="font-size:11px">
                  <a href="#" style="color:#9ca3af;text-decoration:none">Privacy</a>
                  &nbsp;&bull;&nbsp;
                  <a href="#" style="color:#9ca3af;text-decoration:none">Unsubscribe</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Exported email functions ──────────────────────────────────────────────────

/**
 * Send password reset email with link. No-op if SendGrid not configured.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  firstName: string,
  resetToken: string,
  agency?: AgencyBranding
): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;
  if (env.NODE_ENV === 'development') {
    console.log(`\n[dev] ====================================`);
    console.log(`[dev] Password reset link for ${toEmail}:`);
    console.log(`[dev] ${resetUrl}`);
    console.log(`[dev] ====================================\n`);
  }
  if (!isSendGridConfigured()) {
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
    <p style="margin:0 0 14px">We received a request to reset your ${escapeHtml(agencyLabel)} password. Click the button below to set a new one.</p>
    ${tplButton('Reset My Password →', resetUrl, '#1e40af')}
    ${tplCard('⚠️ Security Notice',
      `<p style="margin:0">This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email — your password will not change.</p>`,
      '#fef2f2', '#dc2626', '#7f1d1d'
    )}
    ${tplDivider()}
    ${tplSig(`${agencyLabel} Team`, 'Automated · Please do not reply directly')}
  `;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Reset your ${agencyLabel} password`,
    text: `Hi ${firstName},\n\nUse this link to set a new password (valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.\n\n— ${agencyLabel}`,
    html: buildEmail({
      headerColor: '#1e40af',
      headerIcon: '🔐',
      headerTitle: 'Reset Your Password',
      headerSubtitle: 'Valid for 1 hour · Do not share this link',
      body,
      agency,
    }),
  });
}

/**
 * Send welcome email to new user with their temporary password and login link.
 */
export async function sendWelcomeWithPassword(
  toEmail: string,
  firstName: string,
  temporaryPassword: string,
  agency?: AgencyBranding
): Promise<void> {
  const loginUrl = env.FRONTEND_URL ? `${env.FRONTEND_URL}/login` : '';
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Welcome email for ${toEmail}. Login: ${loginUrl}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(firstName)}</strong>,</p>
    <p style="margin:0 0 14px">Great news! Your ${escapeHtml(agencyLabel)} account has been created. Use the credentials below to sign in for the first time.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0">
      <tr>
        <td style="background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #3b82f6;border-radius:0 6px 6px 0;padding:16px 20px">
          <div style="font-size:11px;color:#6b7280;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">🔒 Temporary Password</div>
          <div style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#1e40af;letter-spacing:3px">${escapeHtml(temporaryPassword)}</div>
        </td>
      </tr>
    </table>
    ${tplCard('ℹ️ Next Step',
      `<p style="margin:0">After signing in, please change your password immediately. Click <strong>Forgot password?</strong> on the login page anytime to reset it.</p>`,
      '#eff6ff', '#3b82f6', '#1e3a8a'
    )}
    ${loginUrl ? tplButton(`Log in to ${escapeHtml(agencyLabel)} →`, loginUrl, '#1e40af') : ''}
    ${tplDivider()}
    ${tplSig(`${agencyLabel} Team`, 'Automated · Please do not reply directly')}
  `;

  const text = `Hi ${firstName},\n\nYour ${agencyLabel} account has been created.\n\nLog in: ${loginUrl}\nTemporary password: ${temporaryPassword}\n\nPlease sign in and change your password.\n\n— ${agencyLabel}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Your ${agencyLabel} account`,
    text,
    html: buildEmail({
      headerColor: '#1e40af',
      headerIcon: '🎉',
      headerTitle: `Welcome to ${agencyLabel}`,
      headerSubtitle: 'Your account is ready — let\'s get started',
      body,
      agency,
    }),
  });
}

export interface SendClientEmailOptions {
  to: { email: string; name?: string }[];
  cc?: { email: string; name?: string }[];
  from: { email: string; name: string };
  /** Optional Reply-To header (e.g. logged-in user) */
  replyTo?: { email: string; name?: string };
  subject: string;
  text?: string;
  html?: string;
  subCompanyId?: string;
  requestedSendAt?: Date;
  dedupeKey?: string;
  /** Optional file attachments (base64-encoded content) */
  attachments?: {
    content: string;
    filename: string;
    type: string;
    disposition?: 'attachment' | 'inline';
    /** SendGrid content_id — required for cid:… images in HTML */
    contentId?: string;
  }[];
}

/**
 * Send an email to client contacts via SendGrid.
 * Returns true if sent, false if SendGrid not configured.
 */
export async function sendClientEmail(options: SendClientEmailOptions): Promise<boolean> {
  const { to, cc, from, replyTo, subject, text, html, attachments, subCompanyId, requestedSendAt, dedupeKey } = options;
  if (!to.length) return false;

  if (!isSendGridConfigured()) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[dev] Email would send to ${to.map((t) => t.email).join(', ')}: ${subject}`);
    }
    return false;
  }

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const sendFrom = toSendGridFrom(from);
  const sendReplyTo = replyTo
    ? toSendGridFrom({ email: replyTo.email, name: replyTo.name ?? sendFrom.name })
    : undefined;
  console.log(`[email] outbound From="${sendFrom.name}" <${sendFrom.email}> to=${to.map((t) => t.email).join(',')}`);
  const message = {
    to: to.map((t) => ({ email: t.email, name: t.name ?? t.email })),
    cc: cc?.length ? cc.map((c) => ({ email: c.email, name: c.name ?? c.email })) : undefined,
    // Object form (preferred) — name must be present for Gmail/Outlook sender column.
    from: sendFrom,
    replyTo: sendReplyTo,
    subject,
    text: text ?? (html ? html.replace(/<[^>]*>/g, '') : ''),
    html: html ?? undefined,
    attachments: attachments?.length ? attachments.map((a) => ({
      content: a.content,
      filename: a.filename,
      type: a.type,
      disposition: (a.disposition ?? 'attachment') as 'attachment' | 'inline',
      ...(a.contentId ? { content_id: a.contentId } : {}),
    })) : undefined,
  };

  if (subCompanyId) {
    const decision = await shouldSendNow(subCompanyId, requestedSendAt);
    if (!decision.allow) {
      const queued = await enqueueOutboundEmail({
        subCompanyId,
        kind: 'sendgrid_single',
        payload: { message },
        requestedSendAt: requestedSendAt ?? null,
        dedupeKey,
      });
      return queued.queued;
    }
  }

  await sgMail.send(message as any);
  return true;
}

/**
 * Send bug report notification to configured recipients.
 */
export async function sendBugReportEmail(options: {
  toEmails: string[];
  reporterName: string;
  reporterEmail: string;
  bugTitle: string | null;
  bugDescription: string;
  bugId: string;
  reportUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmails, reporterName, reporterEmail, bugTitle, bugDescription, reportUrl, agency } = options;
  if (!toEmails.length || !isSendGridConfigured()) {
    if (process.env.NODE_ENV === 'development' && toEmails.length) {
      console.log(`[dev] Bug report email would send to ${toEmails.join(', ')}: ${bugTitle ?? 'Bug report'}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const title = bugTitle ?? 'Bug report';
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">A new bug has been reported and requires your review.</p>
    ${tplCard('🐛 Bug Details',
      `<p style="margin:0">
        <strong>Reported by:</strong> ${escapeHtml(reporterName)} (${escapeHtml(reporterEmail)})<br>
        <strong>Title:</strong> ${escapeHtml(title)}<br><br>
        <strong>Description:</strong><br>
        ${escapeHtml(bugDescription).replace(/\n/g, '<br>')}
      </p>`,
      '#fff7ed', '#f97316', '#7c2d12'
    )}
    ${reportUrl ? tplButton('View Bug Report →', reportUrl, '#c2410c') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = `New bug report from ${reporterName} (${reporterEmail}).\n\nTitle: ${title}\n\nDescription:\n${bugDescription}${reportUrl ? `\n\nView report: ${reportUrl}` : ''}\n\n— ${agencyLabel}`;

  await sgMail.send({
    to: toEmails,
    from: agencyFrom(agency),
    subject: `[Bug Report] ${title}`,
    text,
    html: buildEmail({
      headerColor: '#c2410c',
      headerIcon: '🐛',
      headerTitle: 'New Bug Report',
      headerSubtitle: 'Requires developer attention',
      body,
      agency,
    }),
  });
}

/**
 * Send lead request notification to the manager (associate requested a lead).
 */
export async function sendLeadRequestedEmail(options: {
  toEmail: string;
  toName: string;
  requesterName: string;
  clientName: string;
  note: string;
  requestUrl?: string;
  agency?: AgencyBranding;
  /** Full client profile (company, contacts, tags) — strongly recommended. */
  clientDetails?: LeadEmailClientDetails;
  requesterEmail?: string;
  requestedAt?: Date;
}): Promise<void> {
  const { toEmail, toName, requesterName, clientName, note, requestUrl, agency, clientDetails, requesterEmail, requestedAt } =
    options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead request email would send to ${toEmail}: ${requesterName} requested lead for ${clientName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const when = requestedAt ? formatDateForEmail(requestedAt) : undefined;

  const requestBlock = `<p style="margin:0">
        <strong>Requested by:</strong> ${escapeHtml(requesterName)}<br>
        ${requesterEmail?.trim() ? `<strong>Requester email:</strong> ${escapeHtml(requesterEmail.trim())}<br>` : ''}
        ${when ? `<strong>Requested at:</strong> ${escapeHtml(when)}<br>` : ''}
        <strong>Client:</strong> ${escapeHtml(clientName)}<br>
        <strong>Note:</strong> ${escapeHtml(note)}
      </p>`;

  const clientProfileCard = clientDetails
    ? tplCard('🏢 Client profile', buildClientProfileCardInnerHtml(clientDetails), '#f8fafc', '#64748b', '#334155')
    : '';

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">A new lead request has been submitted and is waiting for your decision.</p>
    ${tplCard('📌 Request Details', requestBlock, '#eff6ff', '#3b82f6', '#1e3a8a')}
    ${clientProfileCard}
    ${requestUrl ? tplButton('Review Request →', requestUrl, '#0369a1') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const textLines = [
    `Hi ${toName},`,
    '',
    `${requesterName} has requested a lead for client "${clientName}".`,
    '',
    `Note: ${note}`,
  ];
  if (requesterEmail?.trim()) textLines.push(`Requester email: ${requesterEmail.trim()}`);
  if (when) textLines.push(`Requested at: ${when}`);
  if (clientDetails) {
    textLines.push('', '— Client profile —');
    appendClientProfileTextLines(clientDetails, textLines);
  }
  if (requestUrl) textLines.push('', `Review request: ${requestUrl}`);
  textLines.push('', `— ${agencyLabel}`);
  const text = textLines.join('\n');

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Lead request: ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#0369a1',
      headerIcon: '📋',
      headerTitle: 'New Lead Request',
      headerSubtitle: 'Action required — review and respond',
      body,
      agency,
    }),
  });
}

/**
 * Notify a user when a lead is created or reassigned to them (manager assignment, etc.).
 */
export async function sendLeadAssignedEmail(options: {
  toEmail: string;
  toName: string;
  assignedByName: string;
  clientDetails: LeadEmailClientDetails;
  lead: LeadEmailLeadFields;
  leadsUrl: string;
  /** True when created via closed-lost reassignment flow. */
  lostLeadReassignment?: boolean;
  reassignmentNote?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const {
    toEmail,
    toName,
    assignedByName,
    clientDetails,
    lead,
    leadsUrl,
    lostLeadReassignment,
    reassignmentNote,
    agency,
  } = options;

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(
        `[dev] Lead assigned email would send to ${toEmail}: ${clientDetails.name} (lead ${lead.id})`
      );
    }
    return;
  }

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const title = lostLeadReassignment ? 'Lost lead reassigned to you' : 'Lead assigned to you';
  const subtitle = lostLeadReassignment
    ? 'A new open lead was created from a closed-lost record — details below'
    : 'A lead is ready in your pipeline — details below';

  const intro = lostLeadReassignment
    ? `<strong>${escapeHtml(assignedByName)}</strong> reassigned a previously lost lead to you. A new open lead has been created for <strong>${escapeHtml(clientDetails.name)}</strong>.`
    : `<strong>${escapeHtml(assignedByName)}</strong> assigned a lead to you for <strong>${escapeHtml(clientDetails.name)}</strong>.`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">${intro}</p>
    ${tplCard('🎯 Lead snapshot', buildLeadSnapshotCardInnerHtml(lead, reassignmentNote), '#f0fdfa', '#0d9488', '#134e4a')}
    ${tplCard('🏢 Client profile', buildClientProfileCardInnerHtml(clientDetails), '#f8fafc', '#64748b', '#334155')}
    ${tplButton('Open Leads →', leadsUrl, '#0f766e')}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const textLines = [
    `Hi ${toName},`,
    '',
    lostLeadReassignment
      ? `${assignedByName} reassigned a lost lead to you for "${clientDetails.name}".`
      : `${assignedByName} assigned a lead to you for "${clientDetails.name}".`,
    '',
    '— Lead —',
    `Lead ID: ${lead.id}`,
    `Stage: ${humanizeStageKey(lead.stage)}`,
    `Status: ${lead.status.replace(/_/g, ' ')}`,
  ];
  if (lead.temperature) textLines.push(`Temperature: ${lead.temperature}`);
  const val = formatLeadCurrencyValue(lead.value);
  if (val) textLines.push(`Value: ${val}`);
  const nfu = formatDateForEmail(lead.nextFollowUp ?? undefined);
  if (nfu) textLines.push(`Next follow-up: ${nfu}`);
  if (lead.notes?.trim()) textLines.push('', 'Notes:', truncateForEmail(lead.notes, LEAD_NOTES_EMAIL_MAX));
  if (reassignmentNote?.trim()) textLines.push('', 'Reassignment note:', reassignmentNote.trim());
  textLines.push('', '— Client profile —');
  appendClientProfileTextLines(clientDetails, textLines);
  textLines.push('', `Open leads: ${leadsUrl}`, '', `— ${agencyLabel}`);
  const text = textLines.join('\n');

  const subject = lostLeadReassignment
    ? `Lost lead reassigned: ${clientDetails.name}`
    : `New lead assigned: ${clientDetails.name}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject,
    text,
    html: buildEmail({
      headerColor: '#0d9488',
      headerIcon: '🎯',
      headerTitle: title,
      headerSubtitle: subtitle,
      body,
      agency,
    }),
  });
}

/**
 * Notify Director(s) when a lead reassignment request is submitted.
 */
export async function sendLeadReassignmentRequestedEmail(options: {
  toEmail: string;
  toName: string;
  requesterName: string;
  currentOwnerName: string;
  proposedOwnerName: string;
  clientName: string;
  note?: string | null;
  requestUrl?: string;
  agency?: AgencyBranding;
  requestedAt?: Date;
}): Promise<void> {
  const { toEmail, toName, requesterName, currentOwnerName, proposedOwnerName, clientName, note, requestUrl, agency, requestedAt } = options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead reassignment request email would send to ${toEmail}: ${requesterName} → ${proposedOwnerName} for ${clientName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const when = requestedAt ? formatDateForEmail(requestedAt) : undefined;

  const detailsBlock = `<p style="margin:0">
    <strong>Requested by:</strong> ${escapeHtml(requesterName)}<br>
    <strong>Client:</strong> ${escapeHtml(clientName)}<br>
    <strong>Current owner:</strong> ${escapeHtml(currentOwnerName)}<br>
    <strong>Proposed new owner:</strong> ${escapeHtml(proposedOwnerName)}<br>
    ${note?.trim() ? `<strong>Reason:</strong> ${escapeHtml(note.trim())}<br>` : ''}
    ${when ? `<strong>Submitted at:</strong> ${escapeHtml(when)}<br>` : ''}
  </p>`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">A lead reassignment request has been submitted and is awaiting your approval.</p>
    ${tplCard('🔄 Reassignment Request', detailsBlock, '#eff6ff', '#3b82f6', '#1e3a8a')}
    ${requestUrl ? tplButton('Review Request →', requestUrl, '#0369a1') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const textLines = [
    `Hi ${toName},`,
    '',
    `${requesterName} has requested to reassign the lead for "${clientName}".`,
    `Current owner: ${currentOwnerName}`,
    `Proposed new owner: ${proposedOwnerName}`,
  ];
  if (note?.trim()) textLines.push(`Reason: ${note.trim()}`);
  if (when) textLines.push(`Submitted at: ${when}`);
  if (requestUrl) textLines.push('', `Review request: ${requestUrl}`);
  textLines.push('', `— ${agencyLabel}`);

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Lead reassignment request: ${clientName}`,
    text: textLines.join('\n'),
    html: buildEmail({
      headerColor: '#0369a1',
      headerIcon: '🔄',
      headerTitle: 'Lead Reassignment Request',
      headerSubtitle: 'Action required — approve or deny',
      body,
      agency,
    }),
  });
}

/**
 * Notify requester when their lead reassignment request was approved.
 */
export async function sendLeadReassignmentApprovedEmail(options: {
  toEmail: string;
  toName: string;
  directorName: string;
  clientName: string;
  newOwnerName: string;
  reviewNote?: string | null;
  leadsUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmail, toName, directorName, clientName, newOwnerName, reviewNote, leadsUrl, agency } = options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead reassignment approved email would send to ${toEmail}: ${clientName} → ${newOwnerName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const detailsBlock = `<p style="margin:0">
    <strong>Client:</strong> ${escapeHtml(clientName)}<br>
    <strong>New owner:</strong> ${escapeHtml(newOwnerName)}<br>
    <strong>Approved by:</strong> ${escapeHtml(directorName)}<br>
    ${reviewNote?.trim() ? `<strong>Director's note:</strong> ${escapeHtml(reviewNote.trim())}<br>` : ''}
  </p>`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Your lead reassignment request has been <strong>approved</strong>. The lead has been transferred to ${escapeHtml(newOwnerName)}.</p>
    ${tplCard('✅ Approved', detailsBlock, '#f0fdf4', '#22c55e', '#14532d')}
    ${leadsUrl ? tplButton('View Leads →', leadsUrl, '#0f766e') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const textLines = [
    `Hi ${toName},`,
    '',
    `Your reassignment request for "${clientName}" was approved by ${directorName}.`,
    `Lead is now assigned to: ${newOwnerName}`,
  ];
  if (reviewNote?.trim()) textLines.push(`Director's note: ${reviewNote.trim()}`);
  if (leadsUrl) textLines.push('', `View leads: ${leadsUrl}`);
  textLines.push('', `— ${agencyLabel}`);

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Reassignment approved: ${clientName}`,
    text: textLines.join('\n'),
    html: buildEmail({
      headerColor: '#0d9488',
      headerIcon: '✅',
      headerTitle: 'Reassignment Approved',
      headerSubtitle: 'The lead has been transferred',
      body,
      agency,
    }),
  });
}

/**
 * Notify requester when their lead reassignment request was rejected.
 */
export async function sendLeadReassignmentRejectedEmail(options: {
  toEmail: string;
  toName: string;
  directorName: string;
  clientName: string;
  currentOwnerName: string;
  reviewNote?: string | null;
  leadsUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmail, toName, directorName, clientName, currentOwnerName, reviewNote, leadsUrl, agency } = options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead reassignment rejected email would send to ${toEmail}: ${clientName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const detailsBlock = `<p style="margin:0">
    <strong>Client:</strong> ${escapeHtml(clientName)}<br>
    <strong>Remains with:</strong> ${escapeHtml(currentOwnerName)}<br>
    <strong>Denied by:</strong> ${escapeHtml(directorName)}<br>
    ${reviewNote?.trim() ? `<strong>Reason:</strong> ${escapeHtml(reviewNote.trim())}<br>` : ''}
  </p>`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Your lead reassignment request has been <strong>denied</strong>. The lead remains with ${escapeHtml(currentOwnerName)}.</p>
    ${tplCard('❌ Denied', detailsBlock, '#fef2f2', '#ef4444', '#7f1d1d')}
    ${leadsUrl ? tplButton('View Leads →', leadsUrl, '#0f766e') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const textLines = [
    `Hi ${toName},`,
    '',
    `Your reassignment request for "${clientName}" was denied by ${directorName}.`,
    `Lead remains with: ${currentOwnerName}`,
  ];
  if (reviewNote?.trim()) textLines.push(`Reason: ${reviewNote.trim()}`);
  if (leadsUrl) textLines.push('', `View leads: ${leadsUrl}`);
  textLines.push('', `— ${agencyLabel}`);

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Reassignment denied: ${clientName}`,
    text: textLines.join('\n'),
    html: buildEmail({
      headerColor: '#dc2626',
      headerIcon: '❌',
      headerTitle: 'Reassignment Denied',
      headerSubtitle: 'The lead remains with the current owner',
      body,
      agency,
    }),
  });
}

/**
 * Notify director(s) when a new client is created in their agency.
 */
export async function sendClientCreatedEmail(options: {
  toEmail: string;
  toName: string;
  creatorName: string;
  creatorEmail: string;
  creatorRole: string;
  clientName: string;
  clientIndustry?: string | null;
  clientLocation?: string | null;
  agencyName: string;
  clientUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const {
    toEmail,
    toName,
    creatorName,
    creatorEmail,
    creatorRole,
    clientName,
    clientIndustry,
    clientLocation,
    agencyName,
    clientUrl,
    agency,
  } = options;

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(
        `[dev] Client created email would send to ${toEmail}: ${creatorName} created client "${clientName}" in ${agencyName}`
      );
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const safeToName = toName.trim() || toEmail;

  const detailLines = [
    `<strong>Client:</strong> ${escapeHtml(clientName)}`,
    clientIndustry ? `<strong>Industry:</strong> ${escapeHtml(clientIndustry)}` : null,
    clientLocation ? `<strong>Location:</strong> ${escapeHtml(clientLocation)}` : null,
    `<strong>Added by:</strong> ${escapeHtml(creatorName)} (${escapeHtml(creatorEmail)})`,
    `<strong>Role:</strong> ${escapeHtml(creatorRole)}`,
    `<strong>Agency:</strong> ${escapeHtml(agencyName)}`,
  ]
    .filter(Boolean)
    .join('<br>');

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(safeToName)}</strong>,</p>
    <p style="margin:0 0 14px">A new client has been added to your agency.</p>
    ${tplCard(
      '🏢 New Client Details',
      `<p style="margin:0">${detailLines}</p>`,
      '#eff6ff',
      '#3b82f6',
      '#1e3a8a'
    )}
    ${clientUrl ? tplButton('View Client →', clientUrl, '#1e40af') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = [
    `Hi ${safeToName},`,
    '',
    'A new client has been added to your agency.',
    '',
    `Client: ${clientName}`,
    clientIndustry ? `Industry: ${clientIndustry}` : null,
    clientLocation ? `Location: ${clientLocation}` : null,
    `Added by: ${creatorName} (${creatorEmail})`,
    `Role: ${creatorRole}`,
    `Agency: ${agencyName}`,
    clientUrl ? '' : null,
    clientUrl ? `View client: ${clientUrl}` : null,
    '',
    `— ${agencyLabel}`,
  ]
    .filter((line) => line !== null)
    .join('\n');

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `New client added: ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#1e40af',
      headerIcon: '🏢',
      headerTitle: 'New Client Added',
      headerSubtitle: `${creatorName} added a client to ${agencyName}`,
      body,
      agency,
    }),
  });
}

/**
 * Send lead request approved notification to the requester.
 */
export async function sendLeadRequestApprovedEmail(options: {
  toEmail: string;
  toName: string;
  clientName: string;
  leadsUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmail, toName, clientName, leadsUrl, agency } = options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead approved email would send to ${toEmail}: ${clientName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Great news! Your lead request has been reviewed and approved.</p>
    ${tplCard('✅ Approved Lead',
      `<p style="margin:0">
        <strong>Client:</strong> ${escapeHtml(clientName)}<br>
        You now have full access — view contacts, log activities, and manage this account from your leads dashboard.
      </p>`,
      '#f0fdf4', '#16a34a', '#14532d'
    )}
    ${leadsUrl ? tplButton('View Your Leads →', leadsUrl, '#15803d') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = `Hi ${toName},\n\nYour lead request for "${clientName}" has been approved. You can now work this lead.${leadsUrl ? `\n\nView your leads: ${leadsUrl}` : ''}\n\n— ${agencyLabel}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Lead request approved: ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#15803d',
      headerIcon: '✅',
      headerTitle: 'Lead Request Approved!',
      headerSubtitle: 'You can now start working this account',
      body,
      agency,
    }),
  });
}

/**
 * Send lead request rejected notification to the requester.
 */
export async function sendLeadRequestRejectedEmail(options: {
  toEmail: string;
  toName: string;
  clientName: string;
  reason?: string;
  leadsUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmail, toName, clientName, reason, leadsUrl, agency } = options;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Lead rejected email would send to ${toEmail}: ${clientName}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Thank you for your request. After review, it was not approved at this time.</p>
    ${tplCard(`Client: ${escapeHtml(clientName)}`,
      `<p style="margin:0">${reason ? `<strong>Reason:</strong> ${escapeHtml(reason)}` : 'Contact your manager for more details.'}</p>`,
      '#fef2f2', '#dc2626', '#7f1d1d'
    )}
    <p style="margin:14px 0">If you have questions, please reach out to your manager directly.</p>
    ${leadsUrl ? tplButton('Browse Available Leads →', leadsUrl, '#475569') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = `Hi ${toName},\n\nYour lead request for "${clientName}" was not approved.${reason ? `\n\nReason: ${reason}` : ''}${leadsUrl ? `\n\nView leads: ${leadsUrl}` : ''}\n\n— ${agencyLabel}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `Lead request not approved: ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#475569',
      headerIcon: '❌',
      headerTitle: 'Lead Request Not Approved',
      headerSubtitle: 'Please review the reason below',
      body,
      agency,
    }),
  });
}

/**
 * Send bug resolved notification to the user who submitted the bug.
 */
export async function sendBugResolvedEmail(options: {
  toEmail: string;
  toName: string;
  bugTitle: string | null;
  resolutionRemarks: string;
  reportUrl?: string;
  agency?: AgencyBranding;
}): Promise<void> {
  const { toEmail, toName, bugTitle, resolutionRemarks, reportUrl, agency } = options;
  if (!isSendGridConfigured()) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[dev] Bug resolved email would send to ${toEmail}`);
    }
    return;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const title = bugTitle ?? 'Bug report';
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">The bug you reported has been reviewed and resolved. Thank you for helping improve the platform!</p>
    ${tplCard('✅ Resolution Summary',
      `<p style="margin:0">
        <strong>Bug:</strong> ${escapeHtml(title)}<br><br>
        <strong>Resolution:</strong><br>
        ${escapeHtml(resolutionRemarks).replace(/\n/g, '<br>')}
      </p>`,
      '#f0fdf4', '#16a34a', '#14532d'
    )}
    ${reportUrl ? tplButton('View Report →', reportUrl, '#15803d') : ''}
    ${tplDivider()}
    ${tplSig(`${agencyLabel} Team`, 'Automated · Please do not reply directly')}
  `;

  const text = `Hi ${toName},\n\nYour bug report "${title}" has been resolved.\n\nResolution:\n${resolutionRemarks}${reportUrl ? `\n\nView report: ${reportUrl}` : ''}\n\n— ${agencyLabel}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `[Resolved] ${title}`,
    text,
    html: buildEmail({
      headerColor: '#15803d',
      headerIcon: '🛠️',
      headerTitle: 'Bug Resolved',
      headerSubtitle: 'Your reported issue has been fixed',
      body,
      agency,
    }),
  });
}

// ─── Settings request emails (Industry / Tag / Job Title) ──────────────────────

function buildSettingsRequestHtml(opts: {
  headerColor: string;
  headerIcon: string;
  headerTitle: string;
  type: string;
  itemName: string;
  requesterName: string;
  agencyName: string;
  settingsUrl?: string;
  agency?: AgencyBranding;
}): string {
  const { headerColor, headerIcon, headerTitle, type, itemName, requesterName, agencyName, settingsUrl, agency } = opts;
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const body = `
    <p style="margin:0 0 14px">Hi <strong>Admin</strong>,</p>
    <p style="margin:0 0 14px">A team member has requested to add a new ${type} to the platform. Please review it in Settings.</p>
    ${tplCard('📌 Request Details',
      `<p style="margin:0">
        <strong>Requested by:</strong> ${escapeHtml(requesterName)}<br>
        <strong>Agency:</strong> ${escapeHtml(agencyName)}<br>
        <strong>${type.charAt(0).toUpperCase() + type.slice(1)}:</strong> ${escapeHtml(itemName)}
      </p>`,
      '#eff6ff', '#3b82f6', '#1e3a8a'
    )}
    ${settingsUrl ? tplButton('Review in Settings →', settingsUrl, headerColor) : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;
  return buildEmail({ headerColor, headerIcon, headerTitle, headerSubtitle: 'Settings · Action required', body, agency });
}

function buildSettingsApprovedHtml(opts: {
  toName: string;
  type: string;
  itemName: string;
  settingsUrl?: string;
  agency?: AgencyBranding;
}): string {
  const { toName, type, itemName, settingsUrl, agency } = opts;
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Your ${type} request has been reviewed and approved!</p>
    ${tplCard('✅ Approved',
      `<p style="margin:0"><strong>${type.charAt(0).toUpperCase() + type.slice(1)}:</strong> ${escapeHtml(itemName)}<br>You can now use this in the CRM.</p>`,
      '#f0fdf4', '#16a34a', '#14532d'
    )}
    ${settingsUrl ? tplButton('Go to Settings →', settingsUrl, '#15803d') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;
  return buildEmail({
    headerColor: '#15803d',
    headerIcon: '✅',
    headerTitle: `${type.charAt(0).toUpperCase() + type.slice(1)} Request Approved`,
    headerSubtitle: 'Your request has been accepted',
    body,
    agency,
  });
}

function buildSettingsRejectedHtml(opts: {
  toName: string;
  type: string;
  itemName: string;
  settingsUrl?: string;
  agency?: AgencyBranding;
}): string {
  const { toName, type, itemName, settingsUrl, agency } = opts;
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toName)}</strong>,</p>
    <p style="margin:0 0 14px">Your request to add a new ${type} was reviewed and not approved at this time.</p>
    ${tplCard(`${type.charAt(0).toUpperCase() + type.slice(1)}: ${escapeHtml(itemName)}`,
      `<p style="margin:0">Contact an administrator if you have questions.</p>`,
      '#fef2f2', '#dc2626', '#7f1d1d'
    )}
    ${settingsUrl ? tplButton('Go to Settings →', settingsUrl, '#475569') : ''}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;
  return buildEmail({
    headerColor: '#475569',
    headerIcon: '❌',
    headerTitle: `${type.charAt(0).toUpperCase() + type.slice(1)} Request Rejected`,
    headerSubtitle: 'Your request was not approved',
    body,
    agency,
  });
}

/**
 * Notify manager when a lead owner submits a proposal.
 */
export async function sendProposalSubmittedEmail(opts: {
  to: string;
  managerName: string;
  submittedByName: string;
  clientName: string;
  clientMessage?: string;
  defaultFiles?: { name: string; fileUrl: string }[];
  proposalLink: string;
  agency?: AgencyBranding;
}): Promise<void> {
  if (!isSendGridConfigured()) return;
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = opts.agency?.name ?? DEFAULT_BRAND_NAME;

  const defaultFilesHtml = opts.defaultFiles && opts.defaultFiles.length > 0
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0">
        <tr>
          <td style="background:#f8fafc;border-left:4px solid #64748b;border-radius:0 6px 6px 0;padding:14px 18px">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;color:#64748b">📎 Included Files</div>
            ${opts.defaultFiles.map((f) => `
              <div style="display:flex;align-items:center;margin-bottom:8px">
                <span style="font-size:13px;color:#374151;margin-right:10px">📄</span>
                <a href="${f.fileUrl}" target="_blank" rel="noopener noreferrer" style="font-size:13px;color:#1e40af;text-decoration:none;font-weight:500">${escapeHtml(f.name)}</a>
              </div>`).join('')}
          </td>
        </tr>
      </table>`
    : '';

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(opts.managerName)}</strong>,</p>
    <p style="margin:0 0 14px">${escapeHtml(opts.submittedByName)} has submitted a new proposal for <strong>${escapeHtml(opts.clientName)}</strong> that requires your review.</p>
    ${opts.clientMessage ? tplCard('💬 Message to Client',
      `<div style="margin:0">${sanitizeRichHtml(opts.clientMessage)}</div>`,
      '#fffbeb', '#f59e0b', '#78350f'
    ) : ''}
    ${tplButton('Review Proposal →', opts.proposalLink, '#1e40af')}
    ${defaultFilesHtml}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  await sgMail.send({
    to: opts.to,
    from: agencyFrom(opts.agency),
    subject: `New Proposal: ${opts.clientName} — Awaiting Your Review`,
    html: buildEmail({
      headerColor: '#3B82F6',
      headerIcon: '📋',
      headerTitle: 'New Proposal Submitted',
      headerSubtitle: `From ${opts.submittedByName}`,
      body,
      agency: opts.agency,
    }),
  });
}

/**
 * Notify lead owner when their proposal is approved.
 */
export async function sendProposalApprovedEmail(opts: {
  to: string;
  ownerName: string;
  clientName: string;
  reviewerName: string;
  pipelineLink: string;
  agency?: AgencyBranding;
}): Promise<void> {
  if (!isSendGridConfigured()) return;
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = opts.agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(opts.ownerName)}</strong>,</p>
    <p style="margin:0 0 14px">Great news! Your proposal for <strong>${escapeHtml(opts.clientName)}</strong> has been <strong style="color:#16a34a">approved</strong> by ${escapeHtml(opts.reviewerName)}.</p>
    ${tplCard('✅ Next Step',
      `<p style="margin:0">The lead has been moved to <strong>Awaiting Client Approval</strong>. The client contact has been emailed with the agreement for signing.</p>`,
      '#f0fdf4', '#16a34a', '#14532d'
    )}
    ${tplButton('View in Pipeline →', opts.pipelineLink, '#15803d')}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  await sgMail.send({
    to: opts.to,
    from: agencyFrom(opts.agency),
    subject: `Proposal Approved: ${opts.clientName}`,
    html: buildEmail({
      headerColor: '#16A34A',
      headerIcon: '✅',
      headerTitle: 'Proposal Approved!',
      headerSubtitle: `For ${opts.clientName}`,
      body,
      agency: opts.agency,
    }),
  });
}

/**
 * Notify lead owner when their proposal is rejected.
 */
export async function sendProposalRejectedEmail(opts: {
  to: string;
  ownerName: string;
  clientName: string;
  reviewerName: string;
  rejectionComment?: string;
  pipelineLink: string;
  agency?: AgencyBranding;
}): Promise<void> {
  if (!isSendGridConfigured()) return;
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = opts.agency?.name ?? DEFAULT_BRAND_NAME;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(opts.ownerName)}</strong>,</p>
    <p style="margin:0 0 14px">Your proposal for <strong>${escapeHtml(opts.clientName)}</strong> was <strong style="color:#dc2626">not approved</strong> by ${escapeHtml(opts.reviewerName)}.</p>
    ${opts.rejectionComment
      ? tplCard('Reason', `<p style="margin:0">${escapeHtml(opts.rejectionComment)}</p>`, '#fef2f2', '#dc2626', '#7f1d1d')
      : '<p style="margin:0 0 14px">No specific reason was provided.</p>'
    }
    <p style="margin:14px 0">You can submit a revised proposal or reset the lead from your pipeline view.</p>
    ${tplButton('Go to Pipeline →', opts.pipelineLink, '#475569')}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  await sgMail.send({
    to: opts.to,
    from: agencyFrom(opts.agency),
    subject: `Proposal Update: ${opts.clientName}`,
    html: buildEmail({
      headerColor: '#DC2626',
      headerIcon: '❌',
      headerTitle: 'Proposal Not Approved',
      headerSubtitle: `For ${opts.clientName}`,
      body,
      agency: opts.agency,
    }),
  });
}

// ─── Client proposal email ────────────────────────────────────────────────────

export interface ClientProposalEmailData {
  contactName: string;
  clientCompanyName: string;
  agreementTypes: string[];
  tempPricingType?: string;
  tempPricingValue?: number;
  directPricingType?: string;
  directPricingValue?: number;
  paymentTerms: string;
  clientMessage?: string;
  documentShareLink?: string;
  defaultFiles?: { name: string; fileUrl: string }[];
  senderName: string;
  agency?: AgencyBranding;
  /** Used to resolve logo + agency phone for the signature. */
  subCompanyId?: string | null;
  /** Sender user — loads default personal signature + title/phone via resolveSenderSignatureBlock. */
  fromUserId?: string | null;
  /** From address for {{sender_email}} in the agency signature. */
  fromEmail?: string | null;
}

/**
 * Build the HTML for the client-facing proposal email.
 * Resolves the agency signature the same way as compose (logo/phone/title/CID).
 */
export async function buildClientProposalEmailHtml(
  d: ClientProposalEmailData,
): Promise<{ html: string; inlineAttachments: import('./sender').SignatureInlineAttachment[] }> {
  const filesHtml = d.defaultFiles?.length
    ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:16px 0">
        <tr>
          <td style="background:#f8fafc;border-left:4px solid #64748b;border-radius:0 6px 6px 0;padding:14px 18px">
            <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;color:#64748b">📎 Supporting Documents</div>
            ${d.defaultFiles.map((f) => `
              <div style="margin-bottom:8px">
                <a href="${f.fileUrl}" target="_blank" rel="noopener noreferrer" style="font-size:13px;color:#1e40af;text-decoration:none;font-weight:500">📄 ${escapeHtml(f.name)}</a>
              </div>`).join('')}
          </td>
        </tr>
      </table>`
    : '';

  const pandaSignGuide = 'https://support.pandadoc.com/hc/en-us/articles/360016160173';
  const docLinkHtml = d.documentShareLink
    ? `${tplButton('Review & Sign Agreement →', d.documentShareLink, '#1e40af')}<p style="text-align:center;margin:-8px 0 16px;font-size:13px;color:#6b7280">New to PandaDoc? <a href="${pandaSignGuide}" style="color:#1e40af;text-decoration:underline">View the signing guide →</a></p>`
    : tplCard('📄 Agreement',
        `<p style="margin:0">Your agreement document is being prepared and will be shared with you shortly. Please check back or contact us if you have any questions.</p>`,
        '#fffbeb', '#f59e0b', '#92400e'
      );

  const sig = await resolveSenderSignatureBlock(
    d.fromUserId,
    d.senderName,
    d.agency?.name ?? DEFAULT_BRAND_NAME,
    d.agency?.emailSignatureTemplate,
    {
      email: d.fromEmail ?? undefined,
      logoUrl: d.agency?.logoUrl,
      tagline: d.agency?.emailTagline,
      subCompanyId: d.subCompanyId ?? null,
    },
  );

  const body = `
    <p style="margin:0 0 14px">Dear <strong>${escapeHtml(d.contactName)}</strong>,</p>
    ${d.clientMessage
      ? `<div style="margin:0 0 14px">${sanitizeRichHtml(d.clientMessage)}</div>`
      : `<p style="margin:0 0 14px">We are pleased to present a proposal for <strong>${escapeHtml(d.clientCompanyName)}</strong>. Please review the agreement at your earliest convenience.</p>`
    }
    ${docLinkHtml}
    ${filesHtml}
    <p style="margin:14px 0 0">If you have any questions, please don't hesitate to reach out to us directly.</p>
    ${sig.html}
  `;

  return {
    html: buildEmail({
      headerColor: '#1e40af',
      headerIcon: '📄',
      headerTitle: 'Your Proposal is Ready',
      headerSubtitle: `Prepared for ${escapeHtml(d.clientCompanyName)}`,
      body,
      agency: d.agency,
    }),
    inlineAttachments: sig.inlineAttachments,
  };
}

export interface SendProposalClientEmailOptions extends ClientProposalEmailData {
  to: string;
  subCompanyId?: string;
  dedupeKey: string;
  /** Base64-encoded file attachments */
  attachments?: { content: string; filename: string; type: string }[];
  /** Optional per-user sender; falls back to the universal EMAIL_FROM identity. */
  from?: SenderIdentity;
}

/**
 * Send the proposal email to the selected client contact.
 * Uses sendClientEmail so it respects the send-window queue and deduplication.
 */
export async function sendProposalClientEmail(opts: SendProposalClientEmailOptions): Promise<void> {
  if (!isSendGridConfigured()) return;
  const sendFrom = toSendGridFrom(
    opts.from?.email ? { email: opts.from.email, name: opts.from.name } : agencyFrom(opts.agency),
  );
  if (!sendFrom.email) return;

  const { html, inlineAttachments } = await buildClientProposalEmailHtml({
    ...opts,
    fromUserId: opts.fromUserId ?? opts.from?.userId,
    fromEmail: sendFrom.email,
    subCompanyId: opts.subCompanyId,
  });
  const subject = `Proposal Ready for Your Review — ${opts.clientCompanyName}`;

  await sendClientEmail({
    to: [{ email: opts.to, name: opts.contactName }],
    from: sendFrom,
    subject,
    html,
    attachments: [...(opts.attachments ?? []), ...inlineAttachments],
    subCompanyId: opts.subCompanyId,
    dedupeKey: opts.dedupeKey,
  });
}

// ─── Signed document confirmation email ──────────────────────────────────────

export interface SignedConfirmationDefaultFile {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export interface SendSignedConfirmationEmailOptions {
  toEmail: string;
  contactName: string;
  clientCompanyName: string;
  senderName: string;
  agency?: AgencyBranding;
  signedPdfBuffer: Buffer;
  signedPdfFilename: string;
  defaultFileAttachments: SignedConfirmationDefaultFile[];
  proposalId: string;
  subCompanyId?: string;
  /** Optional per-user sender; falls back to the universal EMAIL_FROM identity. */
  from?: SenderIdentity;
  /** User ID of the sender — used to build CRM reply-to so client replies appear in their inbox. */
  fromUserId?: string;
}

/**
 * Send a "deal confirmed" email to the client after they sign the PandaDoc agreement.
 * Attaches the signed PDF and all proposal selected default files.
 */
export async function sendSignedDocumentConfirmationEmail(
  opts: SendSignedConfirmationEmailOptions,
): Promise<void> {
  if (!isSendGridConfigured()) return;
  const sendFrom = toSendGridFrom(
    opts.from?.email ? { email: opts.from.email, name: opts.from.name } : agencyFrom(opts.agency),
  );
  if (!sendFrom.email) return;

  const {
    toEmail,
    contactName,
    clientCompanyName,
    senderName,
    agency,
    signedPdfBuffer,
    signedPdfFilename,
    defaultFileAttachments,
    proposalId,
    subCompanyId,
  } = opts;

  const confirmedSig = await resolveSenderSignatureBlock(
    opts.fromUserId,
    senderName,
    agency?.name ?? DEFAULT_BRAND_NAME,
    agency?.emailSignatureTemplate,
    {
      email: sendFrom.email,
      logoUrl: agency?.logoUrl,
      tagline: agency?.emailTagline,
      subCompanyId,
    },
  );
  const confirmedSigBlock = confirmedSig.html;

  const attachments: { content: string; filename: string; type: string }[] = [
    {
      content: signedPdfBuffer.toString('base64'),
      filename: signedPdfFilename,
      type: 'application/pdf',
    },
    ...defaultFileAttachments.map((f) => ({
      content: f.content.toString('base64'),
      filename: f.filename,
      type: f.mimeType || 'application/octet-stream',
    })),
  ];

  const allFilenames = [signedPdfFilename, ...defaultFileAttachments.map((f) => f.filename)];
  const attachListHtml = `${tplCard(
    '📎 Attached Documents',
    `<p style="margin:0;line-height:1.75">${allFilenames.map((name) => `• ${escapeHtml(name)}`).join('<br>')}</p>`,
    '#f0fdf4', '#16a34a', '#14532d',
  )}`;

  const body = `
    <p style="margin:0 0 14px">Dear <strong>${escapeHtml(contactName)}</strong>,</p>
    <p style="margin:0 0 14px">
      Thank you for signing the agreement with <strong>${escapeHtml(clientCompanyName)}</strong>.
      Your signature has been received and the deal is now confirmed.
      We look forward to working with you!
    </p>
    ${tplCard(
      '✅ Agreement Confirmed',
      `<p style="margin:0">
        Your signed copy of the agreement is attached to this email for your records.${defaultFileAttachments.length ? ' We have also included the supporting documents from your proposal.' : ''}
      </p>`,
      '#f0fdf4', '#16a34a', '#14532d',
    )}
    ${attachListHtml}
    <p style="margin:14px 0 0">If you have any questions or need assistance, please don't hesitate to reach out to us directly.</p>
    ${confirmedSigBlock}
  `;

  const html = buildEmail({
    headerColor: '#16a34a',
    headerIcon: '✅',
    headerTitle: 'Agreement Signed — Deal Confirmed',
    headerSubtitle: `Welcome aboard, ${escapeHtml(clientCompanyName)}!`,
    body,
    agency,
  });

  const text = [
    `Dear ${contactName},`,
    '',
    `Thank you for signing the agreement with ${clientCompanyName}. Your signature has been received and the deal is now confirmed. We look forward to working with you!`,
    '',
    'Attached Documents:',
    ...allFilenames.map((name) => `• ${name}`),
    '',
    `If you have any questions, please don't hesitate to reach out.`,
    '',
    `— ${agency?.name ?? DEFAULT_BRAND_NAME}`,
  ].join('\n');

  await sendClientEmail({
    to: [{ email: toEmail, name: contactName }],
    from: sendFrom,
    ...(opts.fromUserId ? { replyTo: { email: buildCrmReplyToAddress(proposalId, opts.fromUserId, agency) } } : {}),
    subject: `Agreement Confirmed — ${clientCompanyName}`,
    html,
    text,
    attachments: [...attachments, ...confirmedSig.inlineAttachments],
    subCompanyId,
    dedupeKey: `${proposalId}:signed-confirmation`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send unsubscribe confirmation email to a client contact.
 */
export async function sendUnsubscribeEmail(opts: {
  toEmail: string;
  contactName: string;
  clientName: string;
  agencyName: string;
  senderName: string;
  agency?: AgencyBranding;
}): Promise<boolean> {
  const { toEmail, contactName, agencyName, senderName } = opts;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Unsubscribe email would send to ${toEmail} for contact ${contactName}`);
    }
    return false;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(contactName)}</strong>,</p>
    <p style="margin:0 0 14px">We're writing to confirm that you have been <strong>unsubscribed</strong> from all future communications from <strong>${escapeHtml(agencyName)}</strong> regarding staffing services.</p>
    ${tplCard('📬 What This Means',
      `<p style="margin:0">
        You will <strong>no longer receive</strong> emails, calls, or outreach from our team regarding staffing opportunities.<br><br>
        If this was done in error or you'd like to re-subscribe in the future, please contact us directly.
      </p>`,
      '#fff7ed', '#f97316', '#7c2d12'
    )}
    ${tplDivider()}
    <p style="margin:0 0 14px;font-size:13px;color:#6b7280">This action was processed by <strong>${escapeHtml(senderName)}</strong> on behalf of ${escapeHtml(agencyName)}.</p>
    ${tplSig(agencyName, 'This is an automated message')}
  `;

  const text = `Hi ${contactName},\n\nThis email confirms that you have been unsubscribed from all future communications from ${agencyName} regarding staffing services.\n\nYou will no longer receive emails, calls, or outreach from our team.\n\nIf this was done in error, please contact us directly.\n\nProcessed by ${senderName} on behalf of ${agencyName}.\n\n— ${agencyName}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(opts.agency),
    subject: `Unsubscribe Confirmation — ${agencyName}`,
    text,
    html: buildEmail({
      headerColor: '#EA580C',
      headerIcon: '📭',
      headerTitle: 'Unsubscribe Confirmation',
      headerSubtitle: `You have been removed from ${agencyName} communications`,
      body,
      agency: opts.agency ?? minimalBranding(agencyName),
    }),
  });
  return true;
}

/**
 * Send permanently closed notification email to a client's primary contact.
 */
export async function sendPermanentlyClosedEmail(opts: {
  toEmail: string;
  contactName: string;
  clientName: string;
  agencyName: string;
  senderName: string;
  agency?: AgencyBranding;
}): Promise<boolean> {
  const { toEmail, contactName, clientName, agencyName, senderName } = opts;
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Permanently closed email would send to ${toEmail} for ${clientName}`);
    }
    return false;
  }
  sgMail.setApiKey(env.SENDGRID_API_KEY!);

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(contactName)}</strong>,</p>
    <p style="margin:0 0 14px">We're writing to inform you that the account for <strong>${escapeHtml(clientName)}</strong> has been <strong>permanently closed</strong> in our system.</p>
    ${tplCard('📋 What This Means',
      `<p style="margin:0">
        All active communications, leads, and staffing activities related to <strong>${escapeHtml(clientName)}</strong> have been concluded.<br><br>
        No further outreach or services will be provided unless a new engagement is initiated.
      </p>`,
      '#fef2f2', '#dc2626', '#7f1d1d'
    )}
    <p style="margin:14px 0;font-size:14px;color:#374151">If you believe this was done in error or would like to discuss reopening the account, please don't hesitate to reach out to us.</p>
    ${tplDivider()}
    <p style="margin:0 0 14px;font-size:13px;color:#6b7280">This action was processed by <strong>${escapeHtml(senderName)}</strong> on behalf of ${escapeHtml(agencyName)}.</p>
    ${tplSig(agencyName, 'This is an automated message')}
  `;

  const text = `Hi ${contactName},\n\nWe're writing to inform you that the account for ${clientName} has been permanently closed in our system.\n\nAll active communications, leads, and staffing activities related to ${clientName} have been concluded. No further outreach or services will be provided unless a new engagement is initiated.\n\nIf you believe this was done in error, please contact us.\n\nProcessed by ${senderName} on behalf of ${agencyName}.\n\n— ${agencyName}`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(opts.agency),
    subject: `Account Closed — ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#DC2626',
      headerIcon: '🚫',
      headerTitle: 'Account Permanently Closed',
      headerSubtitle: `${clientName} has been closed`,
      body,
      agency: opts.agency ?? minimalBranding(agencyName),
    }),
  });
  return true;
}

// ─── Daily Report Email ─────────────────────────────────────────────────────

export interface UserDailyStats {
  user: { id: string; firstName: string; lastName: string; role: string; email: string };
  calls: { total: number; answered: number; totalDurationSeconds: number };
  emailsSent: number;
  meetings: { total: number; completed: number };
  tasks: { assigned: number; completed: number };
  followUps: { assigned: number; completed: number };
  meetingsScheduled: number;
  pipeline: { won: number; assigned: number };
  breakTime: { total: number; coaching: number; meeting: number };
  idleTime: number;
  activeTime: number;
  productivityPercent: number;
  /** Role-level performance target, or null if none configured for this role. */
  target: { emailsTarget: number; callsTarget: number; meetingScheduleCountTarget: number } | null;
}

function fmtMin(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function prodColor(pct: number): { bg: string; text: string } {
  if (pct >= 90) return { bg: '#22c55e', text: '#ffffff' };
  if (pct >= 70) return { bg: '#eab308', text: '#ffffff' };
  return { bg: '#ef4444', text: '#ffffff' };
}

function statBox(label: string, value: string | number, sub: string, colors: { bg: string; border: string; label: string; value: string }): string {
  return `<td width="25%" style="padding:0 4px 8px">
    <table cellpadding="0" cellspacing="0" width="100%" style="background:${colors.bg};border:1px solid ${colors.border};border-radius:8px">
      <tr><td style="padding:12px;text-align:center">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:${colors.label};margin-bottom:4px">${label}</div>
        <div style="font-size:24px;font-weight:800;color:${colors.value};line-height:1">${value}</div>
        <div style="font-size:10px;color:#6b7280;margin-top:2px">${sub}</div>
      </td></tr>
    </table>
  </td>`;
}

function goalMetricCell(label: string, actual: number, target: number): string {
  const pct = target > 0 ? Math.round((actual / target) * 100) : 0;
  const color = pct >= 100 ? '#15803d' : pct >= 50 ? '#d97706' : '#dc2626';
  const fill = target > 0 ? Math.min(pct, 100) : 0;
  return `<td width="25%" style="padding:0 6px 0 0;vertical-align:top">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:3px">${label}</div>
    <div style="font-size:13px;font-weight:700;color:${color}">${actual}<span style="font-size:10px;font-weight:400;color:#9ca3af"> / ${target}</span></div>
    <div style="font-size:10px;font-weight:600;color:${color};margin-top:1px">${target > 0 ? `${pct}%` : '—'}</div>
    <div style="height:3px;background:#f1f5f9;border-radius:2px;margin-top:4px;overflow:hidden">
      <div style="height:3px;width:${fill}%;background:${color};border-radius:2px"></div>
    </div>
  </td>`;
}

function goalRatioCell(label: string, completed: number, assigned: number): string {
  const pct = assigned > 0 ? Math.round((completed / assigned) * 100) : 0;
  const color = assigned <= 0 ? '#6b7280' : pct >= 100 ? '#15803d' : pct >= 50 ? '#d97706' : '#dc2626';
  const fill = assigned > 0 ? Math.min(pct, 100) : 0;
  return `<td width="25%" style="padding:0 6px 0 0;vertical-align:top">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;margin-bottom:3px">${label}</div>
    <div style="font-size:13px;font-weight:700;color:${color}">${completed}<span style="font-size:10px;font-weight:400;color:#9ca3af"> / ${assigned}</span></div>
    <div style="font-size:10px;font-weight:600;color:${color};margin-top:1px">${assigned > 0 ? `${pct}%` : '—'}</div>
    <div style="height:3px;background:#f1f5f9;border-radius:2px;margin-top:4px;overflow:hidden">
      <div style="height:3px;width:${fill}%;background:${color};border-radius:2px"></div>
    </div>
  </td>`;
}

function memberCard(s: UserDailyStats, isTop: boolean, isBottom: boolean): string {
  const pc = prodColor(s.productivityPercent);
  const borderColor = isTop ? '#d1fae5' : isBottom ? '#fecaca' : '#e2e8f0';
  const headerBg = isTop ? '#f0fdf4' : isBottom ? '#fef2f2' : '#f8fafc';
  const answerRate = s.calls.total > 0 ? Math.round((s.calls.answered / s.calls.total) * 100) : 0;
  const activeColor = s.productivityPercent >= 70 ? '#15803d' : '#dc2626';
  const idleColor = s.idleTime > 60 ? '#dc2626' : '#374151';
  const breakSub = `${s.breakTime.coaching}m coach, ${s.breakTime.meeting - 0}m mtg`;

  return `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px;border:1px solid ${borderColor};border-radius:10px;overflow:hidden">
    <tr><td style="background:${headerBg};padding:12px 16px;border-bottom:1px solid ${borderColor}">
      <table cellpadding="0" cellspacing="0" width="100%"><tr>
        <td style="vertical-align:middle">
          <span style="font-size:15px;font-weight:700;color:#111827">${escapeHtml(s.user.firstName)} ${escapeHtml(s.user.lastName)}</span>
          <span style="font-size:11px;color:#6b7280;margin-left:6px">${escapeHtml(s.user.role.replace(/_/g, ' '))}</span>
        </td>
        <td align="right" style="vertical-align:middle">
          <span style="display:inline-block;background:${pc.bg};color:${pc.text};font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px">${s.productivityPercent}%</span>
        </td>
      </tr></table>
    </td></tr>
    <tr><td style="background:#ffffff;padding:14px 16px">
      <table cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Calls:</span> <strong>${s.calls.total}</strong> <span style="font-size:11px;color:#6b7280">(${s.calls.answered} ans, ${answerRate}%)</span></td>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Emails:</span> <strong>${s.emailsSent}</strong></td>
        </tr>
        <tr>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Meetings:</span> <strong>${s.meetings.total}</strong> <span style="font-size:11px;color:#6b7280">(${s.meetings.completed} done)</span></td>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Tasks:</span> <strong>${s.tasks.completed}/${s.tasks.assigned}</strong> completed</td>
        </tr>
        <tr>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Follow-ups:</span> <strong>${s.followUps.completed}/${s.followUps.assigned}</strong> completed</td>
          <td width="50%" style="padding:3px 0;font-size:13px;color:#374151"><span style="color:#6b7280">Pipeline:</span> ${s.pipeline.won > 0 ? `<strong style="color:#15803d">${s.pipeline.won} won</strong>` : '0 won'}, <strong>${s.pipeline.assigned} assigned</strong></td>
        </tr>
        ${s.target ? `
        <tr><td colspan="2" style="padding:10px 0 4px">
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#6366f1;margin-bottom:8px">Goal vs Target</div>
          <table cellpadding="0" cellspacing="0" width="100%"><tr>
            ${goalMetricCell('Calls', s.calls.total, s.target.callsTarget)}
            ${goalMetricCell('Emails', s.emailsSent, s.target.emailsTarget)}
            ${goalMetricCell('Meetings Sched.', s.meetingsScheduled, s.target.meetingScheduleCountTarget)}
            ${goalRatioCell('Tasks', s.tasks.completed, s.tasks.assigned)}
            ${goalRatioCell('Follow-ups', s.followUps.completed, s.followUps.assigned)}
          </tr></table>
        </td></tr>` : ''}
        <tr><td colspan="2" style="padding:8px 0 0">
          <table cellpadding="0" cellspacing="0" width="100%" style="background:#f8fafc;border:1px solid #f1f5f9;border-radius:6px"><tr>
            <td width="33%" style="padding:8px;text-align:center;border-right:1px solid #f1f5f9">
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#8b5cf6;margin-bottom:2px">Break</div>
              <div style="font-size:14px;font-weight:700;color:#374151">${fmtMin(s.breakTime.total)}</div>
              <div style="font-size:9px;color:#9ca3af">${breakSub}</div>
            </td>
            <td width="33%" style="padding:8px;text-align:center;border-right:1px solid #f1f5f9">
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#f59e0b;margin-bottom:2px">Idle</div>
              <div style="font-size:14px;font-weight:700;color:${idleColor}">${fmtMin(s.idleTime)}</div>
            </td>
            <td width="33%" style="padding:8px;text-align:center">
              <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#22c55e;margin-bottom:2px">Active</div>
              <div style="font-size:14px;font-weight:700;color:${activeColor}">${fmtMin(s.activeTime)}</div>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

function buildIcsInvite(opts: {
  uid: string;
  organizerEmail: string;
  organizerName: string;
  attendeeEmail: string;
  title: string;
  description: string;
  location: string;
  url?: string;
  startUtc: Date;
  endUtc: Date;
}): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${DEFAULT_BRAND_NAME}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${opts.uid}`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(opts.startUtc)}`,
    `DTEND:${fmt(opts.endUtc)}`,
    `SUMMARY:${esc(opts.title)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    `LOCATION:${esc(opts.location)}`,
    `ORGANIZER;CN=${esc(opts.organizerName)}:MAILTO:${opts.organizerEmail}`,
    `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;CN=${esc(opts.attendeeEmail)}:MAILTO:${opts.attendeeEmail}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
  ];
  if (opts.url) lines.push(`URL:${opts.url}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function isUnverifiedSenderError(err: unknown): boolean {
  const body = (err as { response?: { body?: { errors?: { message?: string; field?: string }[] } } })?.response?.body;
  const errors = body?.errors ?? [];
  return errors.some((e) => {
    const msg = (e.message || '').toLowerCase();
    return e.field === 'from' || msg.includes('verified sender') || msg.includes('sender identity');
  });
}

export async function sendMeetingScheduledEmail(opts: {
  contactEmail: string;
  contactName: string;
  meetingTitle: string;
  clientName: string;
  scheduledBy: string;
  startTime: string;
  endTime: string;
  /** Actual Date objects for ICS calendar invite */
  startDate?: Date;
  endDate?: Date;
  meetingId?: string;
  location?: string | null;
  meetingLink?: string | null;
  agenda?: string | null;
  agency?: AgencyBranding;
  /** Optional per-user sender; falls back to the universal EMAIL_FROM identity. */
  from?: SenderIdentity;
  /** User ID of the organizer — used to build CRM reply-to so client replies appear in their inbox. */
  fromUserId?: string;
  /** Agency for logo / phone resolution (prefer meeting agency over user's home agency). */
  subCompanyId?: string | null;
  /** When true, use “updated / rescheduled” copy (e.g. time change). */
  isUpdate?: boolean;
}): Promise<boolean> {
  const { contactEmail, contactName, meetingTitle, clientName, scheduledBy, startTime, endTime, location, meetingLink, agenda, agency } = opts;
  const isUpdate = Boolean(opts.isUpdate);
  const sendFrom = toSendGridFrom(
    opts.from?.email ? { email: opts.from.email, name: opts.from.name } : agencyFrom(agency),
  );
  if (!isSendGridConfigured() || !contactEmail) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Meeting email would send to ${contactEmail}: ${meetingTitle}`);
    }
    return false;
  }
  if (!sendFrom.email) return false;
  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;

  const meetingSig = await resolveSenderSignatureBlock(
    opts.fromUserId,
    scheduledBy,
    agencyLabel,
    agency?.emailSignatureTemplate,
    {
      email: opts.from?.email,
      logoUrl: agency?.logoUrl,
      tagline: agency?.emailTagline,
      subCompanyId: opts.subCompanyId ?? null,
    },
  );
  const meetingSigBlock = meetingSig.html;

  const detailRows = `
    <table cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding:6px 0;width:22px;vertical-align:top;font-size:15px">📋</td>
        <td style="padding:6px 0;vertical-align:top">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280">Meeting</div>
          <div style="font-size:14px;font-weight:700;color:#111827;margin-top:2px">${escapeHtml(meetingTitle)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:6px 0;width:22px;vertical-align:top;font-size:15px">📅</td>
        <td style="padding:6px 0;vertical-align:top">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280">Date &amp; Time</div>
          <div style="font-size:14px;color:#111827;margin-top:2px">${escapeHtml(startTime)} &mdash; ${escapeHtml(endTime)}</div>
        </td>
      </tr>
      ${location ? `
      <tr>
        <td style="padding:6px 0;width:22px;vertical-align:top;font-size:15px">📍</td>
        <td style="padding:6px 0;vertical-align:top">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280">Location</div>
          <div style="font-size:14px;color:#111827;margin-top:2px">${escapeHtml(location)}</div>
        </td>
      </tr>` : ''}
      ${meetingLink ? `
      <tr>
        <td style="padding:6px 0;width:22px;vertical-align:top;font-size:15px">🔗</td>
        <td style="padding:6px 0;vertical-align:top">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280">Meeting Link</div>
          <div style="margin-top:2px"><a href="${escapeHtml(meetingLink)}" style="font-size:14px;color:#2563eb;word-break:break-all">${escapeHtml(meetingLink)}</a></div>
        </td>
      </tr>` : ''}
      ${agenda ? `
      <tr>
        <td style="padding:6px 0;width:22px;vertical-align:top;font-size:15px">📝</td>
        <td style="padding:6px 0;vertical-align:top">
          <div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280">Agenda</div>
          <div style="font-size:14px;color:#374151;white-space:pre-line;margin-top:2px">${escapeHtml(agenda)}</div>
        </td>
      </tr>` : ''}
    </table>
  `;

  const intro = isUpdate
    ? `A meeting with <strong>${escapeHtml(clientName)}</strong> has been <strong>updated / rescheduled</strong>. Here are the new details:`
    : `A meeting has been scheduled with <strong>${escapeHtml(clientName)}</strong>. Here are the details:`;
  const introText = isUpdate
    ? `A meeting with ${clientName} has been updated / rescheduled.`
    : `A meeting has been scheduled with ${clientName}.`;

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(contactName)}</strong>,</p>
    <p style="margin:0 0 14px">${intro}</p>
    ${tplCard('Meeting Details', detailRows, '#eff6ff', '#3b82f6', '#1e3a8a')}
    ${meetingLink ? tplButton('Join Meeting →', meetingLink, '#2563eb') : ''}
    ${meetingSigBlock}
  `;

  const text = `Hi ${contactName},\n\n${introText}\n\nMeeting: ${meetingTitle}\nDate & Time: ${startTime} — ${endTime}${location ? `\nLocation: ${location}` : ''}${meetingLink ? `\nLink: ${meetingLink}` : ''}${agenda ? `\nAgenda: ${agenda}` : ''}\n\nScheduled by ${scheduledBy}\n\n— ${agencyLabel}`;

  try {
    const mailPayload: Parameters<typeof sgMail.send>[0] = {
      to: contactEmail,
      from: sendFrom,
      ...(sendFrom.email && opts.meetingId && opts.fromUserId ? {
        replyTo: buildCrmReplyToAddress(opts.meetingId, opts.fromUserId, agency),
      } : sendFrom.email ? { replyTo: { email: sendFrom.email, name: sendFrom.name } } : {}),
      subject: isUpdate ? `Meeting Updated: ${meetingTitle}` : `Meeting Scheduled: ${meetingTitle}`,
      text,
      html: buildEmail({
        headerColor: '#2563eb',
        headerIcon: '📅',
        headerTitle: isUpdate ? 'Meeting Updated' : 'Meeting Scheduled',
        headerSubtitle: `With ${escapeHtml(clientName)}`,
        body,
        agency,
      }),
    };

    // Attach ICS calendar invite when we have actual Date objects
    if (opts.startDate && opts.endDate) {
      const icsDescription = [
        `Meeting with ${clientName}`,
        meetingLink ? `Link: ${meetingLink}` : '',
        agenda ? `Agenda: ${agenda}` : '',
      ].filter(Boolean).join('\n');

      const ics = buildIcsInvite({
        uid: opts.meetingId ?? `meeting-${Date.now()}@nacrm`,
        organizerEmail: sendFrom.email,
        organizerName: sendFrom.name,
        attendeeEmail: contactEmail,
        title: meetingTitle,
        description: icsDescription,
        location: location ?? meetingLink ?? '',
        url: meetingLink ?? undefined,
        startUtc: opts.startDate,
        endUtc: opts.endDate,
      });

      (mailPayload as any).attachments = [{
        content: Buffer.from(ics).toString('base64'),
        filename: 'invite.ics',
        type: 'text/calendar; method=REQUEST',
        disposition: 'attachment',
      }];
    }

    if (meetingSig.inlineAttachments.length) {
      const existing = ((mailPayload as any).attachments ?? []) as Array<Record<string, unknown>>;
      (mailPayload as any).attachments = [
        ...existing,
        ...meetingSig.inlineAttachments.map((a) => ({
          content: a.content,
          filename: a.filename,
          type: a.type,
          disposition: a.disposition,
          content_id: a.contentId,
        })),
      ];
    }

    try {
      await sgMail.send(mailPayload);
      return true;
    } catch (err: unknown) {
      // Dev/staging SendGrid often only verifies EMAIL_FROM — agency From can 403.
      const fallbackFrom = (env.EMAIL_FROM || '').trim();
      const usedFrom = (sendFrom.email || '').trim().toLowerCase();
      // Only retry for agency-system From (no userId). Never replace a user/OM personal From.
      const canRetry =
        Boolean(fallbackFrom) &&
        fallbackFrom.toLowerCase() !== usedFrom &&
        isUnverifiedSenderError(err) &&
        !opts.from?.userId;
      if (!canRetry) throw err;

      console.warn(
        `[email] Meeting From "${sendFrom.email}" not verified in SendGrid; retrying with EMAIL_FROM="${fallbackFrom}"`,
      );
      mailPayload.from = {
        email: fallbackFrom,
        name: env.EMAIL_FROM_NAME || sendFrom.name || DEFAULT_BRAND_NAME,
      };
      await sgMail.send(mailPayload);
      return true;
    }
  } catch (err) {
    const body = (err as { response?: { body?: unknown } })?.response?.body;
    console.error('[email] Failed to send meeting scheduled email:', body ?? err);
    return false;
  }
}

export async function sendDailyReportEmail(opts: {
  toEmail: string;
  managerName: string;
  date: string;
  teamStats: UserDailyStats[];
  appUrl: string;
  agency?: AgencyBranding;
}): Promise<boolean> {
  const { toEmail, managerName, date, teamStats, appUrl } = opts;
  if (!isSendGridConfigured()) return false;
  if (!teamStats.length) return false;

  sgMail.setApiKey(env.SENDGRID_API_KEY!);

  // Team aggregates
  const totalCalls = teamStats.reduce((a, s) => a + s.calls.total, 0);
  const totalAnswered = teamStats.reduce((a, s) => a + s.calls.answered, 0);
  const totalEmails = teamStats.reduce((a, s) => a + s.emailsSent, 0);
  const totalMeetings = teamStats.reduce((a, s) => a + s.meetings.total, 0);
  const totalMeetingsCompleted = teamStats.reduce((a, s) => a + s.meetings.completed, 0);
  const totalTasksCompleted = teamStats.reduce((a, s) => a + s.tasks.completed, 0);
  const totalFollowUpsCompleted = teamStats.reduce((a, s) => a + s.followUps.completed, 0);
  const totalWon = teamStats.reduce((a, s) => a + s.pipeline.won, 0);
  const totalAssigned = teamStats.reduce((a, s) => a + s.pipeline.assigned, 0);
  const avgProd = Math.round(teamStats.reduce((a, s) => a + s.productivityPercent, 0) / teamStats.length);

  // Top / bottom performer
  const sorted = [...teamStats].sort((a, b) => b.productivityPercent - a.productivityPercent);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const hasMultiple = teamStats.length > 1;

  // Summary boxes
  const summaryRow1 = `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px"><tr>
    ${statBox('Calls', totalCalls, `${totalAnswered} answered`, { bg: '#eff6ff', border: '#bfdbfe', label: '#3b82f6', value: '#1e40af' })}
    ${statBox('Emails', totalEmails, 'sent today', { bg: '#f0fdf4', border: '#bbf7d0', label: '#22c55e', value: '#15803d' })}
    ${statBox('Meetings', totalMeetings, `${totalMeetingsCompleted} completed`, { bg: '#faf5ff', border: '#e9d5ff', label: '#a855f7', value: '#7e22ce' })}
    ${statBox('Tasks', totalTasksCompleted, 'completed', { bg: '#fff7ed', border: '#fed7aa', label: '#f97316', value: '#c2410c' })}
  </tr></table>`;

  const summaryRow2 = `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px"><tr>
    ${statBox('Follow-ups', totalFollowUpsCompleted, 'completed', { bg: '#f0fdfa', border: '#99f6e4', label: '#14b8a6', value: '#0f766e' })}
    ${statBox('Won', totalWon, 'leads closed', { bg: '#f0fdf4', border: '#bbf7d0', label: '#22c55e', value: '#15803d' })}
    ${statBox('Assigned', totalAssigned, 'leads today', { bg: '#eff6ff', border: '#bfdbfe', label: '#3b82f6', value: '#1d4ed8' })}
    ${statBox('Avg Prod.', `${avgProd}%`, 'team avg', { bg: '#f0f9ff', border: '#bae6fd', label: '#0ea5e9', value: '#0369a1' })}
  </tr></table>`;

  // Member cards
  const memberCards = sorted.map((s) =>
    memberCard(s, hasMultiple && s.user.id === top.user.id, hasMultiple && s.user.id === bottom.user.id)
  ).join('');

  // Highlights
  const topHighlight = hasMultiple ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 10px"><tr>
    <td style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#374151">
      &#11088; <strong style="color:#15803d">Top Performer:</strong> ${escapeHtml(top.user.firstName)} ${escapeHtml(top.user.lastName)}
      <span style="font-size:12px;color:#6b7280">&mdash; ${top.productivityPercent}% productivity, ${top.calls.total} calls${top.pipeline.won > 0 ? `, ${top.pipeline.won} won` : ''}</span>
    </td>
  </tr></table>` : '';

  const bottomHighlight = hasMultiple && bottom.productivityPercent < 80 ? `<table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px"><tr>
    <td style="background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #ef4444;border-radius:0 8px 8px 0;padding:12px 16px;font-size:13px;color:#374151">
      &#9888;&#65039; <strong style="color:#dc2626">Needs Attention:</strong> ${escapeHtml(bottom.user.firstName)} ${escapeHtml(bottom.user.lastName)}
      <span style="font-size:12px;color:#6b7280">&mdash; ${bottom.productivityPercent}% productivity, ${fmtMin(bottom.idleTime)} idle${bottom.tasks.assigned > bottom.tasks.completed ? `, ${bottom.tasks.assigned - bottom.tasks.completed} tasks open` : ''}</span>
    </td>
  </tr></table>` : '';

  const body = `
    <p style="margin:0 0 20px">Hi <strong>${escapeHtml(managerName)}</strong>, here's your team's performance summary for today.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 8px"><tr>
      <td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;padding-bottom:10px">Team Summary (${teamStats.length} Member${teamStats.length > 1 ? 's' : ''})</td>
    </tr></table>
    ${summaryRow1}
    ${summaryRow2}
    ${tplDivider()}
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 12px"><tr>
      <td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6366f1;padding-bottom:6px">Individual Performance</td>
    </tr></table>
    ${memberCards}
    ${tplDivider()}
    ${topHighlight}
    ${bottomHighlight}
    ${tplButton('View Full Reports →', `${appUrl}/reports`, '#4338ca')}
    <p style="text-align:center;font-size:11px;color:#9ca3af;margin:16px 0 0">This report was automatically generated</p>
  `;

  const subject = `📊 Daily Team Report — ${date} (${teamStats.length} members, ${totalCalls} calls${totalWon > 0 ? `, ${totalWon} won` : ''})`;

  await sgMail.send({
    to: toEmail,
    from: agencyFrom(opts.agency),
    subject,
    text: `Daily Team Report for ${date}. ${teamStats.length} members, ${totalCalls} calls, ${totalEmails} emails, ${totalWon} won, ${totalAssigned} assigned. View full report at ${appUrl}/reports`,
    html: buildEmail({
      headerColor: '#4338ca',
      headerIcon: '📊',
      headerTitle: 'Daily Team Report',
      headerSubtitle: `${date}`,
      body,
      agency: opts.agency,
    }),
  });
  return true;
}

// ─── Pre-PandaDoc Client Review Email ────────────────────────────────────────

/**
 * Send a review-only email to the client (no PandaDoc signing link).
 * Attaches the filled agreement as a read-only PDF (if provided) and all selected
 * default files so the client can review the terms before the formal signing step.
 */
export async function sendReviewEmailToClient(opts: {
  contactEmail: string;
  contactName: string | null;
  clientCompanyName: string;
  senderName: string;
  clientMessage?: string | null;
  agency?: AgencyBranding;
  /** Send-context agency id (phone fallback for neutral Super User signatures). */
  subCompanyId?: string | null;
  pdfBuffer?: Buffer;
  defaultFileAttachments?: { name: string; buffer: Buffer; mimeType: string }[];
  /** Optional per-user sender; falls back to the universal EMAIL_FROM identity. */
  from?: SenderIdentity;
  /** Lead owner / sender user — resolves Settings signature (logo, phone, title, personal sig). */
  fromUserId?: string;
  /** Inbound-parse reply-to address so client replies route back to the CRM. */
  replyTo?: { email: string; name?: string };
  /**
   * Optional document heading for Both-pair review emails
   * (e.g. "Temporary Staffing Agreement for Review").
   * When omitted, subject/body match the historical single-doc copy.
   */
  documentLabel?: string;
}): Promise<{ html: string }> {
  const { contactEmail, contactName, clientCompanyName, senderName, clientMessage, agency, pdfBuffer, defaultFileAttachments = [] } = opts;
  const sendFrom = opts.from?.email ? { email: opts.from.email, name: opts.from.name } : agencyFrom(agency);
  const documentLabel = opts.documentLabel?.trim() || 'Agreement for Review';
  const headerTitle = opts.documentLabel?.trim()
    ? `${opts.documentLabel.trim()}`
    : 'Agreement for Your Review';
  const cardTitle = opts.documentLabel?.trim()
    ? `📋 ${opts.documentLabel.trim()}`
    : '📋 Agreement for Review';
  const pdfFilename = opts.documentLabel?.toLowerCase().includes('direct')
    ? 'direct-placement-agreement-review.pdf'
    : opts.documentLabel?.toLowerCase().includes('temp')
      ? 'temporary-staffing-agreement-review.pdf'
      : 'agreement-review.pdf';

  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const displayName = contactName?.trim() || contactEmail;

  const sig = await resolveSenderSignatureBlock(
    opts.fromUserId ?? opts.from?.userId,
    senderName,
    agencyLabel,
    agency?.emailSignatureTemplate,
    {
      email: sendFrom.email || undefined,
      logoUrl: agency?.logoUrl,
      tagline: agency?.emailTagline,
      subCompanyId: opts.subCompanyId ?? null,
    },
  );

  const emailBody = `
    <p style="margin:0 0 14px">Dear <strong>${escapeHtml(displayName)}</strong>,</p>
    ${clientMessage
      ? `<div style="margin:0 0 14px">${sanitizeRichHtml(clientMessage)}</div>`
      : `<p style="margin:0 0 14px">We would like to share a preview of our proposed agreement for <strong>${escapeHtml(clientCompanyName)}</strong> for your review.</p>`
    }
    ${tplCard(cardTitle,
      `<p style="margin:0">The filled agreement document is attached as a PDF for your review. This is for informational purposes only — no action is required at this stage. If you have any questions or wish to proceed, please contact us directly.</p>`,
      '#eff6ff', '#3b82f6', '#1e3a8a'
    )}
    ${defaultFileAttachments.length > 0
      ? tplCard('📎 Supporting Documents',
          `<p style="margin:0">${defaultFileAttachments.length} supporting document${defaultFileAttachments.length !== 1 ? 's are' : ' is'} attached to this email for your reference.</p>`,
          '#f8fafc', '#64748b', '#334155'
        )
      : ''
    }
    <p style="margin:14px 0 0">If you have any questions, please reach out to us directly. We look forward to hearing from you.</p>
    ${sig.html}
  `;

  const html = buildEmail({
    headerColor: '#1e40af',
    headerIcon: '📄',
    headerTitle,
    headerSubtitle: `Prepared for ${escapeHtml(clientCompanyName)}`,
    body: emailBody,
    agency,
  });

  console.log(`[sendReviewEmailToClient] called → to=${contactEmail}, sendgridConfigured=${isSendGridConfigured()}, from=${JSON.stringify(sendFrom)}`);
  if (!isSendGridConfigured()) {
    console.warn('[sendReviewEmailToClient] SendGrid not configured — skipping send');
    return { html };
  }
  if (!sendFrom.email) {
    console.warn('[sendReviewEmailToClient] No From email configured — skipping send');
    return { html };
  }

  sgMail.setApiKey(env.SENDGRID_API_KEY!);

  const messageText = clientMessage ? htmlToPlainText(clientMessage) : `We would like to share a preview of our proposed agreement for ${clientCompanyName} for your review.`;
  const text = `Dear ${displayName},\n\n${messageText}\n\nThe agreement document (${documentLabel}) is attached as a PDF. This is for review purposes only — no signing is required at this stage. Please contact us with any questions.\n\n— ${senderName}, ${agencyLabel}`;

  const attachments: {
    content: string;
    filename: string;
    type: string;
    disposition: 'attachment' | 'inline';
    contentId?: string;
  }[] = [];

  if (pdfBuffer) {
    attachments.push({
      content: pdfBuffer.toString('base64'),
      filename: pdfFilename,
      type: 'application/pdf',
      disposition: 'attachment',
    });
  }

  for (const f of defaultFileAttachments) {
    attachments.push({
      content: f.buffer.toString('base64'),
      filename: f.name,
      type: f.mimeType,
      disposition: 'attachment',
    });
  }
  for (const a of sig.inlineAttachments) {
    attachments.push({
      content: a.content,
      filename: a.filename,
      type: a.type,
      disposition: a.disposition,
      contentId: a.contentId,
    });
  }

  const subject = `${documentLabel} — ${clientCompanyName}`;
  console.log(`[sendReviewEmailToClient] Sending via SendGrid → subject="${subject}", attachments=${attachments.length}`);
  await sgMail.send({
    to: contactEmail,
    from: sendFrom,
    subject,
    text,
    html,
    ...(opts.replyTo ? { replyTo: { email: opts.replyTo.email, name: opts.replyTo.name ?? opts.replyTo.email } } : {}),
    ...(attachments.length > 0
      ? {
          attachments: attachments.map((a) => ({
            content: a.content,
            filename: a.filename,
            type: a.type,
            disposition: a.disposition,
            ...(a.contentId ? { content_id: a.contentId } : {}),
          })),
        }
      : {}),
  } as any);
  console.log(`[sendReviewEmailToClient] SendGrid accepted the message`);
  return { html };
}

export interface OffboardingTransferCounts {
  emails: number;
  clients: number;
  pipeline: number;
  leads: number;
  tasks: number;
  meetings: number;
  followUps: number;
}

export async function sendOffboardingReceivedEmail(
  toEmail: string,
  toFirstName: string,
  departingName: string,
  counts: OffboardingTransferCounts,
  agency?: AgencyBranding,
): Promise<void> {
  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Offboarding email → ${toEmail}: received data from ${departingName}`);
    }
    return;
  }

  const rows: Array<{ label: string; count: number; icon: string }> = [
    { label: 'Emails', count: counts.emails, icon: '✉️' },
    { label: 'Won Clients', count: counts.clients, icon: '👥' },
    { label: 'Pipeline Leads', count: counts.pipeline, icon: '📈' },
    { label: 'Leads', count: counts.leads, icon: '🎯' },
    { label: 'Tasks', count: counts.tasks, icon: '✅' },
    { label: 'Meetings', count: counts.meetings, icon: '📅' },
    { label: 'Follow-Ups', count: counts.followUps, icon: '🔔' },
  ].filter((r) => r.count > 0);

  const totalItems = rows.reduce((s, r) => s + r.count, 0);

  const tableRows = rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:14px;color:#374151">${r.icon} ${escapeHtml(r.label)}</td>
          <td style="padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:700;color:#1e40af;text-align:right">${r.count}</td>
        </tr>`,
    )
    .join('');

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(toFirstName)}</strong>,</p>
    <p style="margin:0 0 16px">The following items have been transferred to you as part of <strong>${escapeHtml(departingName)}</strong>'s offboarding. Please review them at your earliest convenience.</p>
    <table cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;margin:0 0 20px">
      <thead>
        <tr style="background:#f8fafc">
          <th style="padding:10px 14px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Category</th>
          <th style="padding:10px 14px;text-align:right;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em">Items</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
      <tfoot>
        <tr style="background:#f8fafc">
          <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#374151">Total</td>
          <td style="padding:10px 14px;font-size:13px;font-weight:700;color:#1e40af;text-align:right">${totalItems}</td>
        </tr>
      </tfoot>
    </table>
    ${tplCard(
      '📌 What to do next',
      `<p style="margin:0">Log in to your CRM and check your Clients, Leads, Tasks, Meetings, and Follow-Ups. Items transferred from ${escapeHtml(departingName)} are marked with a <strong>"Forwarded from ${escapeHtml(departingName)}"</strong> badge so you can easily identify them.</p>`,
      '#eff6ff',
      '#3b82f6',
      '#1e3a5f',
    )}
    ${tplDivider()}
    ${tplSig(agency?.name ?? DEFAULT_BRAND_NAME, 'Automated · Please do not reply directly')}
  `;

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject: `You've received ${totalItems} items from ${departingName}'s offboarding`,
    text: `Hi ${toFirstName},\n\nYou have received ${totalItems} items from ${departingName}'s offboarding:\n${rows.map((r) => `- ${r.label}: ${r.count}`).join('\n')}\n\nLog in to the CRM to review them.`,
    html: buildEmail({
      headerColor: '#7c3aed',
      headerIcon: '📦',
      headerTitle: 'Items Transferred to You',
      headerSubtitle: `From ${escapeHtml(departingName)}'s offboarding · ${totalItems} total items`,
      body,
      agency,
    }),
  });
}

/** Email assignment / placement details to a candidate when assigned to a client/job.
 * Returns `{ delivered: true }` only when SendGrid accepted the message.
 * When SendGrid is not configured, returns `{ delivered: false }` without throwing.
 */
export async function sendEmployeeAssignmentDetailsEmail(options: {
  toEmail: string;
  candidateName: string;
  clientName: string;
  workLocation: string;
  positionTitle: string;
  payRate: string;
  shiftSchedule: string;
  expectedDuration?: string | null;
  supervisorInfo?: string | null;
  requiredPpe?: string | null;
  workplaceHazards?: string | null;
  /** @deprecated kept for callers; no longer shown in body (template is agency-signed). */
  sentByName?: string;
  agency?: AgencyBranding;
  /** Prefer CRM-resolved From (same as training emails). Falls back to agency / env. */
  from?: { email: string; name: string };
}): Promise<{ delivered: boolean }> {
  const {
    toEmail,
    clientName,
    workLocation,
    positionTitle,
    payRate,
    shiftSchedule,
    expectedDuration,
    supervisorInfo,
    requiredPpe,
    workplaceHazards,
    agency,
    from,
  } = options;

  const rows: Array<[string, string]> = [
    ['Client Name', clientName],
    ['Work Location', workLocation],
    ['Position Title', positionTitle],
    ['Pay Rate', payRate],
    ['Shift Schedule', shiftSchedule],
  ];
  if (expectedDuration?.trim()) {
    rows.push(['Expected Assignment Duration (if known)', expectedDuration.trim()]);
  }
  if (supervisorInfo?.trim()) {
    rows.push(['Supervisor Information', supervisorInfo.trim()]);
  }
  if (requiredPpe?.trim()) {
    rows.push(['Required PPE', requiredPpe.trim()]);
  }
  if (workplaceHazards?.trim()) {
    rows.push(['Special Workplace Hazards (if applicable)', workplaceHazards.trim()]);
  }

  const detailsHtml = rows
    .map(
      ([label, value]) =>
        `<div style="margin:0 0 10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#64748b;margin-bottom:2px">${escapeHtml(label)}</div><div style="white-space:pre-wrap">${escapeHtml(value)}</div></div>`,
    )
    .join('');

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(
        `[dev] Assignment details email would send to ${toEmail}: ${clientName} / ${positionTitle}`,
      );
    }
    return { delivered: false };
  }

  const fallbackFrom = agencyFrom(agency);
  const sendFrom = from?.email?.trim()
    ? { email: from.email.trim(), name: from.name?.trim() || fallbackFrom.name }
    : fallbackFrom;
  if (!sendFrom.email) {
    throw Object.assign(
      new Error(
        'No From address configured for assignment email. Set agency email From or EMAIL_FROM.',
      ),
      { status: 502 },
    );
  }

  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const body = `
    <p style="margin:0 0 14px">Hi,</p>
    <p style="margin:0 0 14px">You have been scheduled for the new assignment. Please review the details below carefully before reporting to work.</p>
    ${tplCard('Assignment Details', detailsHtml, '#f0fdfa', '#0d9488', '#134e4a')}
    <p style="margin:14px 0">We wish you a safe and successful assignment.</p>
    ${tplDivider()}
    <p style="margin:0 0 4px">Kind regards,</p>
    <p style="margin:0 0 0;font-weight:700;color:#111827">${escapeHtml(agencyLabel)}</p>
  `;

  const text = [
    'Hi,',
    '',
    'You have been scheduled for the new assignment. Please review the details below carefully before reporting to work.',
    '',
    'Assignment Details',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    '',
    'We wish you a safe and successful assignment.',
    '',
    'Kind regards,',
    agencyLabel,
  ].join('\n');

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  await sgMail.send({
    to: toEmail,
    from: sendFrom,
    subject: `Assignment details: ${positionTitle} at ${clientName}`,
    text,
    html: buildEmail({
      headerColor: '#0d9488',
      headerIcon: '📋',
      headerTitle: 'Your assignment details',
      headerSubtitle: `${escapeHtml(positionTitle)} · ${escapeHtml(clientName)}`,
      body,
      agency,
    }),
  });
  return { delivered: true };
}

/** Short one-line training message emailed to a candidate for a client placement. */
/** Subject + HTML actually delivered — used by CRM Sent mailbox recording. */
export type SentEmailContent = { subject: string; html: string };

export async function sendEmployeeTrainingMessageEmail(options: {
  toEmail: string;
  candidateName: string;
  clientName: string;
  message: string;
  sentByName: string;
  agency?: AgencyBranding;
}): Promise<SentEmailContent | null> {
  const { toEmail, candidateName, clientName, message, sentByName, agency } = options;

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Training email would send to ${toEmail}: ${message}`);
    }
    return null;
  }

  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const subject = `Training: ${clientName}`;
  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(candidateName)}</strong>,</p>
    <p style="margin:0 0 14px"><strong>${escapeHtml(sentByName)}</strong> has sent you a short training note for your placement at <strong>${escapeHtml(clientName)}</strong>.</p>
    ${tplCard('Training', `<p style="margin:0;white-space:pre-wrap">${escapeHtml(message)}</p>`, '#fefce8', '#ca8a04', '#713f12')}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = [
    `Hi ${candidateName},`,
    '',
    `${sentByName} has sent you a short training note for your placement at ${clientName}:`,
    '',
    message,
    '',
    `— ${agencyLabel}`,
  ].join('\n');

  const html = buildEmail({
    headerColor: '#ca8a04',
    headerIcon: '🎓',
    headerTitle: 'Training note',
    headerSubtitle: escapeHtml(clientName),
    body,
    agency,
  });

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  await sgMail.send({
    to: toEmail,
    from: agencyFrom(agency),
    subject,
    text,
    html,
  });
  return { subject, html };
}

/** Standalone employee training link (no client placement). */
export async function sendEmployeeStandaloneTrainingEmail(options: {
  toEmail: string;
  candidateName: string;
  url: string;
  sentByName: string;
  title?: string | null;
  agency?: AgencyBranding;
  /** When set (recruiter send-as), From is the acting user — same as other CRM outbound. */
  from?: { email: string; name: string };
}): Promise<SentEmailContent> {
  const { toEmail, candidateName, url, sentByName, title, agency, from } = options;

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(`[dev] Employee training email would send to ${toEmail}: ${url}`);
    }
    throw Object.assign(
      new Error('Email service is not configured (missing SENDGRID_API_KEY). Training email was not sent.'),
      { status: 502 },
    );
  }

  const rawFrom = from?.email?.trim()
    ? { email: from.email.trim(), name: from.name?.trim() || agencyFrom(agency).name }
    : agencyFrom(agency);
  if (!rawFrom.email) {
    throw Object.assign(
      new Error('No From address configured for training email (agency email or send-as).'),
      { status: 502 },
    );
  }
  const sendFrom = toSendGridFrom(rawFrom);

  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const label = title?.trim() || 'Training link';
  const subject = title?.trim() ? `Training: ${title.trim()}` : 'Your training link';
  const safeUrl = escapeHtml(url);
  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(candidateName)}</strong>,</p>
    <p style="margin:0 0 14px"><strong>${escapeHtml(sentByName)}</strong> has sent you a training link to complete.</p>
    ${tplCard(
      escapeHtml(label),
      `<p style="margin:0"><a href="${safeUrl}" style="color:#a16207;word-break:break-all">${safeUrl}</a></p>`,
      '#fefce8',
      '#ca8a04',
      '#713f12',
    )}
    ${tplButton('Open training', escapeHtml(url), '#ca8a04')}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = [
    `Hi ${candidateName},`,
    '',
    `${sentByName} has sent you a training link to complete${title?.trim() ? ` (${title.trim()})` : ''}:`,
    '',
    url,
    '',
    `— ${agencyLabel}`,
  ].join('\n');

  const html = buildEmail({
    headerColor: '#ca8a04',
    headerIcon: '🎓',
    headerTitle: 'Training link',
    headerSubtitle: escapeHtml(candidateName),
    body,
    agency,
  });

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  try {
    await sgMail.send({
      to: toEmail,
      from: sendFrom,
      subject,
      text,
      html,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown provider error';
    const sgErrors = (err as { response?: { body?: { errors?: Array<{ message?: string }> } } })
      ?.response?.body?.errors;
    const detail = Array.isArray(sgErrors)
      ? sgErrors.map((e) => e?.message).filter(Boolean).join('; ')
      : '';
    throw Object.assign(
      new Error(
        detail
          ? `Failed to send training email from ${sendFrom.email}: ${msg}: ${detail}`
          : `Failed to send training email from ${sendFrom.email}: ${msg}`,
      ),
      { status: 502, cause: err },
    );
  }
  return { subject, html };
}

/** Default onboarding trainings (Ontario 4 Steps + WHMIS) in one email. */
export async function sendEmployeeDefaultTrainingsEmail(options: {
  toEmail: string;
  candidateName: string;
  sentByName: string;
  trainings: Array<{ title: string; url: string }>;
  agency?: AgencyBranding;
  /** When set (recruiter send-as), From is the acting user — same as other CRM outbound. */
  from?: { email: string; name: string };
}): Promise<SentEmailContent> {
  const { toEmail, candidateName, sentByName, trainings, agency, from } = options;

  if (!isSendGridConfigured()) {
    if (env.NODE_ENV === 'development') {
      console.log(
        `[dev] Default training email would send to ${toEmail}:`,
        trainings.map((t) => t.url).join(', '),
      );
    }
    throw Object.assign(
      new Error('Email service is not configured (missing SENDGRID_API_KEY). Training email was not sent.'),
      { status: 502 },
    );
  }

  const rawFrom = from?.email?.trim()
    ? { email: from.email.trim(), name: from.name?.trim() || agencyFrom(agency).name }
    : agencyFrom(agency);
  if (!rawFrom.email) {
    throw Object.assign(
      new Error('No From address configured for training email (agency email or send-as).'),
      { status: 502 },
    );
  }
  const sendFrom = toSendGridFrom(rawFrom);

  const agencyLabel = agency?.name ?? DEFAULT_BRAND_NAME;
  const subject = 'Your required training courses';
  const cards = trainings
    .map((t) => {
      const safeUrl = escapeHtml(t.url);
      return `${tplCard(
        escapeHtml(t.title),
        `<p style="margin:0 0 10px"><a href="${safeUrl}" style="color:#a16207;word-break:break-all">${safeUrl}</a></p>
         <p style="margin:0"><a href="${safeUrl}" style="display:inline-block;background:#ca8a04;color:#fff;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600">Open ${escapeHtml(t.title)}</a></p>`,
        '#fefce8',
        '#ca8a04',
        '#713f12',
      )}`;
    })
    .join('<div style="height:12px"></div>');

  const body = `
    <p style="margin:0 0 14px">Hi <strong>${escapeHtml(candidateName)}</strong>,</p>
    <p style="margin:0 0 14px"><strong>${escapeHtml(sentByName)}</strong> has sent required training courses for you to complete before starting work.</p>
    ${cards}
    ${tplDivider()}
    ${tplSig(agencyLabel, 'Automated · Please do not reply directly')}
  `;

  const text = [
    `Hi ${candidateName},`,
    '',
    `${sentByName} has sent required training courses for you to complete:`,
    '',
    ...trainings.flatMap((t) => [t.title, t.url, '']),
    `— ${agencyLabel}`,
  ].join('\n');

  const html = buildEmail({
    headerColor: '#ca8a04',
    headerIcon: '🎓',
    headerTitle: 'Required training',
    headerSubtitle: escapeHtml(candidateName),
    body,
    agency,
  });

  sgMail.setApiKey(env.SENDGRID_API_KEY!);
  try {
    await sgMail.send({
      to: toEmail,
      from: sendFrom,
      subject,
      text,
      html,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown provider error';
    const sgErrors = (err as { response?: { body?: { errors?: Array<{ message?: string }> } } })
      ?.response?.body?.errors;
    const detail = Array.isArray(sgErrors)
      ? sgErrors.map((e) => e?.message).filter(Boolean).join('; ')
      : '';
    throw Object.assign(
      new Error(
        detail
          ? `Failed to send training email from ${sendFrom.email}: ${msg}: ${detail}`
          : `Failed to send training email from ${sendFrom.email}: ${msg}`,
      ),
      { status: 502, cause: err },
    );
  }
  return { subject, html };
}

export { buildSettingsRequestHtml, buildSettingsApprovedHtml, buildSettingsRejectedHtml, buildEmail, tplCard, tplButton, tplDivider, tplSig };
