import prisma from '../config/database';
import { env } from '../config/env';
import { getUserRoleTitleSync } from './rbac';
import { getFromR2, getR2SignedUrl } from './r2Storage';
import { buildSignatureHtmlFromConfig, DEFAULT_SIGNATURE_CONFIG, NEUTRAL_SIGNATURE_CONFIG } from './signatureHtml';
import { isGlobalSendAsUser } from './globalSendAsEligibility';
import { SenderDomainNotConfiguredError } from './senderDomainErrors';

/**
 * Agency visual signature when none is saved in DB.
 * Ensures every agency still gets the branded Executive signature on send.
 */
export function resolveAgencySignatureTemplate(template?: string | null): string {
  const trimmed = typeof template === 'string' ? template.trim() : '';
  if (trimmed) return trimmed;
  return buildSignatureHtmlFromConfig(DEFAULT_SIGNATURE_CONFIG);
}

/**
 * Sender identity for an outbound email. `userId` is set only when the sender
 * resolves to a real user (vs the agency system sender); useful for audit/log fields.
 */
export interface SenderIdentity {
  email: string;
  name: string;
  userId?: string;
}

/**
 * Subset of User fields needed to resolve a sender. Every callsite that loads
 * the acting user must include these fields in its `select`.
 */
export interface SenderUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  sendAsEmail: string | null;
  sendAsDisabled: boolean;
}

function displayName(u: SenderUser): string {
  const n = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return n || 'Staff';
}

/**
 * Normalize SendGrid `from` so inboxes get a person/company name, not a bare address.
 * Strips header-breaking characters; never leaves name empty or equal to the email.
 */
export function toSendGridFrom(from: { email: string; name?: string | null }): { email: string; name: string } {
  const email = (from.email || '').trim();
  let name = (from.name || '').trim().replace(/\s+/g, ' ');
  const emailLower = email.toLowerCase();
  if (!name || name.toLowerCase() === emailLower) {
    const local = (email.split('@')[0] || '')
      .replace(/[._+-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    name = local || 'Staff';
  }
  // Quotes / angle brackets / newlines break From display in some clients.
  name = name.replace(/[\r\n"<>]/g, '').trim() || 'Staff';
  return { email, name };
}

export type ResolveUserSenderOptions = {
  /** Extra domains allowed beyond agency.emailSendAsDomain (e.g. SendGrid authenticated). */
  extraAllowedDomains?: string[];
  /** When true, throw instead of falling back to agency system From if candidate not allowed. */
  requireAllowedDomain?: boolean;
};

/**
 * CRM outbound From for associate-driven email.
 * Prefer resolveOutboundUserSender / resolveEmailSender from routes — keeps OM,
 * eligibility, and logging in one place. This pure helper is for the choke point + tests.
 *
 * Returns `agencySystemSender` in any of these cases (when requireAllowedDomain is false):
 *  - user is null / undefined
 *  - user.sendAsDisabled is true
 *  - allowedDomain is null and no extraAllowedDomains match
 *  - user has no usable email
 *  - user's send-as domain doesn't match allowedDomain / extras
 *
 * Otherwise returns { email: user's send-as email, name: "First Last", userId }.
 * If SEND_AS_OVERRIDE_EMAIL is set (dev/staging), the email is replaced with
 * that sink while keeping the user's display name and id.
 */
export function resolveUserSender(
  user: SenderUser | null | undefined,
  allowedDomain: string | null,
  agencySystemSender: SenderIdentity,
  overrideEmail?: string,
  options?: ResolveUserSenderOptions,
): SenderIdentity {
  const extra = (options?.extraAllowedDomains ?? [])
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  const requireAllowed = options?.requireAllowedDomain === true;

  if (!user) {
    if (requireAllowed) {
      throw new SenderDomainNotConfiguredError();
    }
    return agencySystemSender;
  }
  if (user.sendAsDisabled) return agencySystemSender;

  const candidate = (user.sendAsEmail || user.email || '').toLowerCase().trim();
  if (!candidate) {
    if (requireAllowed) throw new SenderDomainNotConfiguredError();
    return agencySystemSender;
  }
  const domain = candidate.split('@')[1]?.toLowerCase();
  const agencyOk = Boolean(allowedDomain && domain === allowedDomain.toLowerCase());
  const extraOk = Boolean(domain && extra.includes(domain));

  // Preserve legacy early return when no extras/require and agency domain unset.
  if (!allowedDomain && extra.length === 0 && !requireAllowed) {
    return agencySystemSender;
  }

  if (!domain || (!agencyOk && !extraOk)) {
    if (requireAllowed) throw new SenderDomainNotConfiguredError(domain);
    return agencySystemSender;
  }

  const name = displayName(user);
  if (overrideEmail) {
    return { email: overrideEmail, name, userId: user.id };
  }
  return { email: candidate, name, userId: user.id };
}

/** Fields to spread into Prisma User `select` for any callsite that resolves a sender. */
export const senderUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  sendAsEmail: true,
  sendAsDisabled: true,
} as const;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Sanitize user personal signature HTML (keep in sync with email.sanitizeRichHtml). */
function sanitizePersonalSignatureHtml(input: string | null | undefined): string {
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
 * Turn a stored agency logo into a *remote* URL email clients can fetch.
 * Never returns data: URIs — those bloat HTML and trigger Gmail "[Message clipped]".
 *
 * Accepts: full http(s) URL, `/api/...` path, or (with R2_PUBLIC_URL) raw R2 key.
 * Raw private R2 keys without a public CDN return null — use CID attachment instead.
 */
export function resolveAgencyLogoUrlForEmail(
  logoUrl: string | null | undefined,
  subCompanyId?: string | null,
): string | null {
  const raw = logoUrl?.trim();
  if (!raw) return null;
  // Reject data URIs — they caused Gmail clipping (~390KB HTML).
  if (raw.startsWith('data:')) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const appBase = env.APP_URL.replace(/\/$/, '');
  // Only use app proxy when APP_URL is publicly reachable (not localhost).
  const appIsPublic = /^https:\/\//i.test(appBase) && !/localhost|127\.0\.0\.1/i.test(appBase);
  if (raw.startsWith('/api/') || raw.startsWith('api/')) {
    if (!appIsPublic) return null;
    return raw.startsWith('/') ? `${appBase}${raw}` : `${appBase}/${raw}`;
  }

  const r2Base = env.R2_PUBLIC_URL?.replace(/\/$/, '');
  if (r2Base) return `${r2Base}/${raw.replace(/^\//, '')}`;

  if (subCompanyId && appIsPublic) {
    return `${appBase}/api/v1/users/sub-companies/${subCompanyId}/logo`;
  }
  return null;
}

export const AGENCY_LOGO_CID = 'agency-logo';

export type SignatureInlineAttachment = {
  content: string;
  filename: string;
  type: string;
  disposition: 'inline';
  contentId: string;
};

export type ResolvedSenderSignature = {
  html: string;
  inlineAttachments: SignatureInlineAttachment[];
};

/**
 * Resolve a logo for outbound email.
 *
 * Prefer a remote https URL (public CDN or signed R2 URL) so Gmail does NOT show
 * an inbox "attachment" chip. CID attachments work for rendering but Gmail lists
 * them as agency-logo.png in the inbox — avoid when possible.
 */
export async function prepareAgencyLogoForEmail(
  logoUrl: string | null | undefined,
  subCompanyId?: string | null,
): Promise<{ src: string | null; inlineAttachment: SignatureInlineAttachment | null }> {
  const publicUrl = resolveAgencyLogoUrlForEmail(logoUrl, subCompanyId);
  if (publicUrl) return { src: publicUrl, inlineAttachment: null };

  const raw = logoUrl?.trim();
  if (!raw || raw.startsWith('data:') || /^https?:\/\//i.test(raw) || raw.startsWith('/api/') || raw.startsWith('api/')) {
    return { src: null, inlineAttachment: null };
  }

  const key = raw.replace(/^\//, '');

  // Signed HTTPS URL — shows as normal remote image, no inbox attachment chip.
  try {
    const signed = await getR2SignedUrl(key);
    if (signed) return { src: signed, inlineAttachment: null };
  } catch (err) {
    console.warn('[signature] R2 signed URL failed, falling back', err);
  }

  // Last resort: CID (Gmail will show an image chip in the inbox list).
  try {
    const obj = await getFromR2(key);
    if (!obj?.body?.length) return { src: null, inlineAttachment: null };
    if (obj.body.length > 1_500_000) {
      console.warn('[signature] agency logo too large for inline CID, skipping', obj.body.length);
      return { src: null, inlineAttachment: null };
    }
    const mime = obj.contentType?.startsWith('image/') ? obj.contentType : 'image/png';
    const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg'
      : mime.includes('webp') ? 'webp'
        : mime.includes('gif') ? 'gif'
          : 'png';
    return {
      src: `cid:${AGENCY_LOGO_CID}`,
      inlineAttachment: {
        content: obj.body.toString('base64'),
        filename: `agency-logo.${ext}`,
        type: mime,
        disposition: 'inline',
        contentId: AGENCY_LOGO_CID,
      },
    };
  } catch (err) {
    console.warn('[signature] failed to load agency logo for CID', err);
    return { src: null, inlineAttachment: null };
  }
}

export type SenderSignatureContext = {
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  logoUrl?: string | null;
  tagline?: string | null;
  /** Needed to build public proxy URL when logo is a raw R2 key. */
  subCompanyId?: string | null;
};

/**
 * Titles shown under the name on client emails.
 * Prefer custom userType; never show internal CRM labels (e.g. "Super Admin")
 * even when that string was saved as userType — keeps Super User signatures
 * aligned with associates (name + phone + email under the agency logo).
 */
const INTERNAL_CLIENT_TITLE_ROLES = new Set([
  'super_admin',
  'database_manager',
  'dev_team',
]);

const INTERNAL_CLIENT_TITLE_LABELS = new Set([
  'super admin',
  'database manager',
  'dev team',
]);

export function resolveClientFacingSenderTitle(user: {
  role: string;
  userType?: string | null;
} | null | undefined): string | null {
  if (!user) return null;
  const custom = user.userType?.trim();
  let candidate: string | null = null;
  if (custom) {
    candidate = custom;
  } else if (!INTERNAL_CLIENT_TITLE_ROLES.has(user.role)) {
    candidate = getUserRoleTitleSync({ role: user.role, userType: user.userType }).trim() || null;
  }
  if (!candidate) return null;
  if (INTERNAL_CLIENT_TITLE_LABELS.has(candidate.toLowerCase())) return null;
  return candidate;
}

/**
 * Elevated users with no home agency (Super Admin, Director, OM, DB manager, …)
 * get a neutral signature — name / phone / email only, no agency logo.
 * Agency-tied elevated users (e.g. Company Director) keep agency branding.
 */
export function shouldUseNeutralSenderSignature(user: {
  role: string;
  subCompanyId?: string | null;
} | null | undefined): boolean {
  if (!user) return false;
  return isGlobalSendAsUser(user.role) && !user.subCompanyId;
}

/**
 * Build the universal "Best regards, [name]" HTML footer block.
 *
 * Every client-facing outbound email MUST end with this block:
 *  - Compose emails (routes/emails.ts send path)
 *  - Proposal emails  (services/email.ts → buildClientProposalEmailHtml)
 *  - Review emails    (services/email.ts → sendReviewEmailToClient)
 *  - Signed doc emails (services/email.ts → sendSignedDocumentConfirmationEmail)
 *  - Meeting emails   (services/email.ts → sendMeetingScheduledEmail)
 *
 * @param senderName             Display name of the sender (will be HTML-escaped).
 * @param agencyName             Agency / sub-company name shown below the name.
 * @param signatureHtml          Optional user personal signature HTML — sanitized by resolveSenderSignatureBlock.
 * @param agencySignatureTemplate Optional agency-configured template. Supports placeholders:
 *                               {{sender_name}}, {{sender_title}}, {{sender_phone}},
 *                               {{sender_email}}, {{agency_name}}, {{agency_logo}},
 *                               {{agency_tagline}}, {{sender_signature}}.
 *                               When provided, replaces the default "Best regards" block.
 * @param senderContext          Extra sender fields for placeholder substitution.
 */
export function buildSenderSignatureBlock(
  senderName: string,
  agencyName: string,
  signatureHtml?: string | null,
  agencySignatureTemplate?: string | null,
  senderContext?: SenderSignatureContext,
): string {
  const sigPart = signatureHtml
    ? `<div style="margin-top:6px">${signatureHtml}</div>`
    : '';

  // Always use branded agency template — fall back to universal default when unset.
  const agencyTemplate = resolveAgencySignatureTemplate(agencySignatureTemplate);
  const personalSigHtml = signatureHtml
    ? `<div style="margin-top:6px;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;line-height:1.3;">${signatureHtml}</div>`
    : '';
  const alreadyInjected = agencyTemplate.includes('{{sender_signature}}');
  // Agency logo removed from all outbound emails — always render signatures with no logo.
  // The empty `{{agency_logo}}` leaves an `<img src="">` which the cleanup pass below strips.
  const safeLogo = '';
  let rendered = agencyTemplate
    .replace(/\{\{sender_name\}\}/g, esc(senderName))
    .replace(/\{\{agency_name\}\}/g, esc(agencyName))
    .replace(/\{\{sender_title\}\}/g, esc(senderContext?.title ?? ''))
    .replace(/\{\{sender_phone\}\}/g, esc(senderContext?.phone ?? ''))
    .replace(/\{\{sender_email\}\}/g, esc(senderContext?.email ?? ''))
    .replace(/\{\{agency_logo\}\}/g, safeLogo)
    .replace(/\{\{agency_tagline\}\}/g, esc(senderContext?.tagline ?? ''))
    .replace(/\{\{sender_signature\}\}/g, personalSigHtml);

  // Drop empty structural leftovers after placeholder fill
  rendered = rendered
    .replace(/<img\b[^>]*\bsrc=(["'])\s*\1[^>]*>/gi, '')
    .replace(/<p[^>]*>\s*<\/p>/gi, '')
    .replace(/<div[^>]*>\s*<\/div>/gi, '')
    .replace(/<span[^>]*>\s*<\/span>/gi, '');

  // Agency visual signatures already include their own dual top rule.
  // Extra border-top here stacks two separators and looks broken in Gmail.
  const mainBlock = `<div style="margin-top:28px;padding-top:0;">${rendered}</div>`;
  return mainBlock + (alreadyInjected ? '' : sigPart);
}

/** Find the `</table>` that closes the `<table` starting at `tableOpenIdx`. */
function findMatchingTableClose(html: string, tableOpenIdx: number): number {
  let depth = 0;
  let i = tableOpenIdx;
  while (i < html.length) {
    const rest = html.slice(i);
    const openRel = rest.search(/<table\b/i);
    const closeRel = rest.search(/<\/table>/i);
    if (closeRel < 0) return -1;
    if (openRel >= 0 && openRel < closeRel) {
      depth += 1;
      i += openRel + 6;
    } else {
      depth -= 1;
      if (depth === 0) return i + closeRel;
      i += closeRel + 8;
    }
  }
  return -1;
}

/**
 * Inject the sender signature block into the correct position inside an HTML email:
 *
 * 1. Before `<!-- FOOTER -->` — buildEmail() card templates.
 * 2. Inside the white content cell, immediately before the seed `#f8fafc` footer
 *    (same place associates land — continuous white card).
 * 3. As a white `<tr>` before the seed footer / before the 600px card `</table>`
 *    when the content-cell anchor is missing.
 * 4. Never a bare `<tr>` before `</body>` — that renders as a detached box on gray.
 */
export function injectSenderSignature(html: string, sigBlock: string): string {
  const cardRow = `<tr><td style="padding:8px 32px 24px;background:#ffffff">${sigBlock}</td></tr>\n`;
  const wrappedCard = `<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;"><tr><td align="center"><table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;"><tr><td style="padding:8px 32px 24px;background:#ffffff">${sigBlock}</td></tr></table></td></tr></table>`;

  // buildEmail() card template (automated emails: proposals, meetings, review, signed doc)
  const buildEmailFooter = '<!-- FOOTER -->';
  const buildEmailIdx = html.indexOf(buildEmailFooter);
  if (buildEmailIdx !== -1) {
    return html.slice(0, buildEmailIdx) + sigBlock + '\n        ' + html.slice(buildEmailIdx);
  }

  // Associate-identical placement: inside the content cell, right before the gray footer row.
  // Lookahead requires the next row to be the seed footer — nested CTA `</td></tr>` does not match.
  const insideContentBeforeFooter =
    /(<\/td>\s*<\/tr>)\s*(?=<tr>\s*<td[^>]*background\s*:\s*#f8fafc)/i;
  const contentMatch = insideContentBeforeFooter.exec(html);
  if (contentMatch && contentMatch.index >= 0) {
    return html.slice(0, contentMatch.index) + `\n${sigBlock}\n` + html.slice(contentMatch.index);
  }

  // Fallback: dedicated white row before the gray footer (still inside the 600px card).
  const seedFooterRe = /<tr>\s*<td[^>]*background\s*:\s*#f8fafc[^>]*>/i;
  const seedMatch = seedFooterRe.exec(html);
  if (seedMatch && seedMatch.index >= 0) {
    return html.slice(0, seedMatch.index) + cardRow + html.slice(seedMatch.index);
  }

  // Legacy exact footer string (older stored templates)
  const seedFooter = '<tr><td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">';
  const seedFooterIdx = html.indexOf(seedFooter);
  if (seedFooterIdx !== -1) {
    return html.slice(0, seedFooterIdx) + cardRow + html.slice(seedFooterIdx);
  }

  // Footer row was stripped (empty agency_footer) — still land inside the 600px white card.
  const cardOpen = /<table[^>]*width\s*=\s*["']?600["']?[^>]*>/i.exec(html);
  if (cardOpen) {
    const closeIdx = findMatchingTableClose(html, cardOpen.index);
    if (closeIdx >= 0) {
      return html.slice(0, closeIdx) + cardRow + html.slice(closeIdx);
    }
  }

  // Full HTML doc without a recognizable card — wrap signature (never bare <tr>).
  const bodyIdx = html.lastIndexOf('</body>');
  if (bodyIdx !== -1) {
    return html.slice(0, bodyIdx) + wrappedCard + html.slice(bodyIdx);
  }

  // Plain HTML fragment (compose from scratch)
  return html + `<div style="padding:8px 0;background:#ffffff">${sigBlock}</div>`;
}

/**
 * Fetch the sender's default personal signature + phone from DB, build the
 * signature block, and return HTML + optional CID logo attachment.
 *
 * Use this everywhere an email is sent to a real person so signature injection
 * is consistent across compose, campaigns, proposals, meetings, etc.
 *
 * IMPORTANT: Do not embed logos as data: URIs — that exceeds Gmail's ~102KB HTML
 * clip limit. Private R2 logos are attached as CID (inline) MIME parts instead.
 *
 * Never throws — on DB/R2 failure returns a template-only fallback so outbound
 * mail is never blocked by signature resolution.
 */
export async function resolveSenderSignatureBlock(
  userId: string | null | undefined,
  senderName: string,
  agencyName: string,
  agencySignatureTemplate: string | null | undefined,
  senderContext?: SenderSignatureContext,
): Promise<ResolvedSenderSignature> {
  try {
    const [personalSig, senderUser] = userId
      ? await Promise.all([
          prisma.emailSignature.findFirst({
            where: { userId, isDefault: true },
            select: { content: true },
          }),
          prisma.user.findUnique({
            where: { id: userId },
            select: { phone: true, role: true, userType: true, subCompanyId: true },
          }),
        ])
      : [null, null];

    const title =
      senderContext?.title?.trim() ||
      (senderUser ? resolveClientFacingSenderTitle(senderUser) : null) ||
      null;

    const useNeutral = shouldUseNeutralSenderSignature(senderUser);
    // Neutral: ignore send-context agency branding. Branded: prefer send-context agency, else home.
    const subCompanyId = useNeutral
      ? null
      : senderContext?.subCompanyId ?? senderUser?.subCompanyId ?? null;

    const userPhone = (senderContext?.phone ?? senderUser?.phone ?? '').trim();
    let phone = userPhone || null;
    if (!phone && !useNeutral && subCompanyId) {
      const agency = await prisma.subCompany.findUnique({
        where: { id: subCompanyId },
        select: { agencyPhone: true },
      });
      phone = agency?.agencyPhone?.trim() || null;
    }
    // Neutral Super Users with no personal phone: still allow send-context agency phone
    // so the contact row is not empty (logo/brand stay off).
    if (!phone && useNeutral && senderContext?.subCompanyId) {
      const agency = await prisma.subCompany.findUnique({
        where: { id: senderContext.subCompanyId },
        select: { agencyPhone: true },
      });
      phone = agency?.agencyPhone?.trim() || null;
    }

    if (useNeutral) {
      const html = buildSenderSignatureBlock(
        senderName,
        '',
        personalSig?.content ?? null,
        buildSignatureHtmlFromConfig(NEUTRAL_SIGNATURE_CONFIG),
        {
          title,
          phone,
          email: senderContext?.email ?? null,
          logoUrl: null,
          tagline: null,
          subCompanyId: null,
        },
      );
      return { html, inlineAttachments: [] };
    }

    // Agency logo removed from all outbound emails — no logo src, no inline attachment.
    const logoSrc = '';
    const inlineAttachment = null;

    const personalHtml = personalSig?.content
      ? sanitizePersonalSignatureHtml(personalSig.content)
      : null;

    const html = buildSenderSignatureBlock(
      senderName,
      agencyName,
      personalHtml,
      agencySignatureTemplate ?? null,
      {
        ...senderContext,
        title,
        phone,
        email: senderContext?.email ?? undefined,
        subCompanyId,
        logoUrl: logoSrc,
      },
    );

    return {
      html,
      inlineAttachments: inlineAttachment ? [inlineAttachment] : [],
    };
  } catch (err) {
    console.warn('[signature] resolveSenderSignatureBlock failed — using template fallback:', err);
    return {
      html: buildSenderSignatureBlock(
        senderName,
        agencyName,
        null,
        agencySignatureTemplate ?? null,
        senderContext,
      ),
      inlineAttachments: [],
    };
  }
}
