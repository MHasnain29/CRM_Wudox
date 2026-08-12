/**
 * Agency email signature HTML builder + v1→v2 config migration.
 * Keep in sync with frontend/src/lib/signatureHtmlBuilder.ts and signatureConfig.ts.
 */

export type SignatureFieldKey =
  | 'name'
  | 'title'
  | 'agency'
  | 'phone'
  | 'email'
  | 'contact_row'
  | 'website_bar'
  | 'divider';

export type LogoLayout = 'logo-left' | 'logo-right' | 'no-logo';
export type TextVAlign = 'top' | 'middle' | 'bottom';
export type TextHAlign = 'left' | 'center' | 'right';
export type SignaturePreset = 'executive' | 'compact' | 'minimal';
export type LogoSize = 40 | 48 | 56 | 64;

export interface SignatureTextPosition {
  verticalAlign: TextVAlign;
  horizontalAlign: TextHAlign;
  logoGap: 8 | 12 | 16 | 20 | 24;
  paddingTop: 0 | 4 | 8 | 12 | 16 | 24;
  paddingBottom: 0 | 4 | 8 | 12 | 16 | 24;
  paddingInline: 12 | 16 | 18 | 20 | 24;
}

export interface SignatureFieldConfig {
  key: SignatureFieldKey;
  enabled: boolean;
  order: number;
  bold?: boolean;
  fontSize?: number;
  color?: string | null;
}

export interface SignatureConfig {
  version: 2;
  layout: LogoLayout;
  preset?: SignaturePreset;
  agencyColor: string;
  nameColor: string | null;
  detailColor: string;
  logoLabelColor: string;
  logoSize: LogoSize;
  showLogoLabel: boolean;
  showTagline: boolean;
  showVerticalDivider: boolean;
  showNameUnderline: boolean;
  showWebsiteBar: boolean;
  showTopRule: boolean;
  showContactIcons: boolean;
  websiteUrl: string | null;
  textPosition: SignatureTextPosition;
  fields: SignatureFieldConfig[];
}

export const DEFAULT_SIGNATURE_CONFIG: SignatureConfig = {
  version: 2,
  layout: 'logo-left',
  preset: 'executive',
  agencyColor: '#B81D5A',
  nameColor: null,
  detailColor: '#4b5563',
  logoLabelColor: '#0c1222',
  logoSize: 48,
  showLogoLabel: true,
  showTagline: false,
  showVerticalDivider: true,
  showNameUnderline: true,
  showWebsiteBar: true,
  showTopRule: true,
  showContactIcons: true,
  websiteUrl: null,
  textPosition: {
    verticalAlign: 'middle',
    horizontalAlign: 'left',
    logoGap: 12,
    paddingTop: 0,
    paddingBottom: 0,
    paddingInline: 12,
  },
  fields: [
    { key: 'name', enabled: true, order: 0, bold: true, fontSize: 15 },
    { key: 'title', enabled: true, order: 1, bold: false, fontSize: 12 },
    { key: 'contact_row', enabled: true, order: 2, bold: false, fontSize: 11 },
    { key: 'website_bar', enabled: true, order: 3 },
    { key: 'phone', enabled: false, order: 4, bold: false, fontSize: 11 },
    { key: 'email', enabled: false, order: 5, bold: false, fontSize: 11 },
    { key: 'agency', enabled: false, order: 6, bold: false, fontSize: 11 },
  ],
};

/**
 * Clean signature for elevated users with no home agency (e.g. Super Admin):
 * name + title + phone + email only — no agency logo / brand column.
 */
export const NEUTRAL_SIGNATURE_CONFIG: SignatureConfig = {
  ...DEFAULT_SIGNATURE_CONFIG,
  layout: 'no-logo',
  preset: 'minimal',
  agencyColor: '#9D174D',
  nameColor: '#9D174D',
  detailColor: '#64748b',
  showLogoLabel: false,
  showTagline: false,
  showVerticalDivider: false,
  showWebsiteBar: false,
  showTopRule: true,
  showNameUnderline: true,
  websiteUrl: null,
  fields: DEFAULT_SIGNATURE_CONFIG.fields.map((f) =>
    f.key === 'website_bar' || f.key === 'agency' ? { ...f, enabled: false } : f,
  ),
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO_SIZES: LogoSize[] = [40, 48, 56, 64];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickHex(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v) ? v : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function nearestLogoSize(n: unknown): LogoSize {
  const num = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(num)) return 48;
  if (num <= 36) return 40;
  if (num <= 52) return 48;
  if (num <= 60) return 56;
  return 64;
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pickNumEnum<T extends number>(v: unknown, allowed: readonly T[], fallback: T): T {
  const n = typeof v === 'number' ? v : Number(v);
  return (allowed as readonly number[]).includes(n) ? (n as T) : fallback;
}

function migrateFields(raw: unknown): SignatureFieldConfig[] {
  const defaults = DEFAULT_SIGNATURE_CONFIG.fields;
  const byKey = new Map(defaults.map((f) => [f.key, { ...f }]));
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const r = asRecord(item);
      if (!r || typeof r.key !== 'string') continue;
      const key = r.key as SignatureFieldKey;
      if (!byKey.has(key)) continue;
      const base = byKey.get(key)!;
      byKey.set(key, {
        ...base,
        enabled: key === 'name' ? true : pickBool(r.enabled, base.enabled),
        order: typeof r.order === 'number' ? r.order : base.order,
        bold: typeof r.bold === 'boolean' ? r.bold : base.bold,
        fontSize:
          typeof r.fontSize === 'number' ? Math.min(20, Math.max(11, Math.round(r.fontSize))) : base.fontSize,
        color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : (base.color ?? null),
      });
    }
  }
  if (!byKey.has('contact_row')) byKey.set('contact_row', { ...defaults.find((f) => f.key === 'contact_row')! });
  if (!byKey.has('website_bar')) byKey.set('website_bar', { ...defaults.find((f) => f.key === 'website_bar')! });

  // Prefer contact_row over legacy stacked phone/email (avoids duplicate lines).
  const contactRow = byKey.get('contact_row');
  if (contactRow?.enabled) {
    const phone = byKey.get('phone');
    const email = byKey.get('email');
    if (phone) byKey.set('phone', { ...phone, enabled: false });
    if (email) byKey.set('email', { ...email, enabled: false });
  }

  return Array.from(byKey.values()).sort((a, b) => a.order - b.order);
}

/** Never throws — always returns a valid v2 config. */
export function migrateSignatureConfigToV2(raw: unknown): SignatureConfig {
  const d = DEFAULT_SIGNATURE_CONFIG;
  const r = asRecord(raw) ?? {};

  const agencyColor = pickHex(r.agencyColor ?? r.accentColor, d.agencyColor);
  const tpRaw = asRecord(r.textPosition) ?? {};
  const textPosition: SignatureTextPosition = {
    verticalAlign: pickEnum(tpRaw.verticalAlign, ['top', 'middle', 'bottom'] as const, d.textPosition.verticalAlign),
    horizontalAlign: pickEnum(
      tpRaw.horizontalAlign,
      ['left', 'center', 'right'] as const,
      d.textPosition.horizontalAlign,
    ),
    logoGap: pickNumEnum(tpRaw.logoGap, [8, 12, 16, 20, 24] as const, d.textPosition.logoGap),
    paddingTop: pickNumEnum(tpRaw.paddingTop, [0, 4, 8, 12, 16, 24] as const, d.textPosition.paddingTop),
    paddingBottom: pickNumEnum(tpRaw.paddingBottom, [0, 4, 8, 12, 16, 24] as const, d.textPosition.paddingBottom),
    paddingInline: pickNumEnum(tpRaw.paddingInline, [12, 16, 18, 20, 24] as const, d.textPosition.paddingInline),
  };

  const websiteUrl =
    typeof r.websiteUrl === 'string'
      ? r.websiteUrl
      : typeof r.agencyWebsite === 'string'
        ? r.agencyWebsite
        : null;

  return {
    version: 2,
    layout: pickEnum(r.layout, ['logo-left', 'logo-right', 'no-logo'] as const, d.layout),
    preset: pickEnum(r.preset, ['executive', 'compact', 'minimal'] as const, d.preset ?? 'executive'),
    agencyColor,
    nameColor:
      typeof r.nameColor === 'string' && HEX.test(r.nameColor) ? r.nameColor : r.nameColor === null ? null : null,
    detailColor: pickHex(r.detailColor, d.detailColor),
    logoLabelColor: pickHex(r.logoLabelColor, d.logoLabelColor),
    logoSize: LOGO_SIZES.includes(r.logoSize as LogoSize) ? (r.logoSize as LogoSize) : nearestLogoSize(r.logoSize),
    showLogoLabel: pickBool(r.showLogoLabel, d.showLogoLabel),
    showTagline: pickBool(r.showTagline, false),
    showVerticalDivider: pickBool(r.showVerticalDivider ?? r.showInlineDivider, d.showVerticalDivider),
    showNameUnderline: pickBool(r.showNameUnderline, d.showNameUnderline),
    showWebsiteBar: pickBool(r.showWebsiteBar ?? r.showWebsiteBanner, d.showWebsiteBar),
    showTopRule: pickBool(r.showTopRule, true),
    showContactIcons: pickBool(r.showContactIcons, true),
    websiteUrl: websiteUrl?.trim() ? websiteUrl.trim() : null,
    textPosition,
    fields: migrateFields(r.fields),
  };
}

export function normalizeWebsiteUrl(raw: string | null | undefined): { host: string; href: string } | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (/^\s*javascript:/i.test(trimmed)) return null;
  const host = trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!host || /[<>"'\s]/.test(host)) return null;
  return { host, href: `https://${host}` };
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function iconTile(color: string, glyph: string): string {
  return (
    '<span style="display:inline-block;width:13px;height:13px;background-color:' +
    color +
    ';border-radius:2px;color:#fff;font-size:8px;line-height:13px;text-align:center;' +
    'vertical-align:middle;margin-right:6px">' +
    glyph +
    '</span>'
  );
}

function fieldEnabled(config: SignatureConfig, key: SignatureFieldKey): boolean {
  if (key === 'name') return true;
  return config.fields.find((x) => x.key === key)?.enabled !== false;
}

/** Machine-generated signature HTML. Do NOT run sanitizeRichHtml on the result. */
export function buildSignatureHtmlFromConfig(config: SignatureConfig): string {
  const layout = config.layout;
  const color = config.agencyColor;
  const nameColor = config.nameColor || color;
  const logoSize = config.logoSize;
  const showLogoLabel = config.showLogoLabel;
  const showTagline = config.showTagline;
  const showDivider = config.showVerticalDivider && layout !== 'no-logo';
  const showUnderline = config.showNameUnderline;
  const showWebsite = config.showWebsiteBar && fieldEnabled(config, 'website_bar');
  const showTopRule = config.showTopRule;
  const showContactIcons = config.showContactIcons;
  const showTitle = fieldEnabled(config, 'title');
  const showContactRow = fieldEnabled(config, 'contact_row');
  // Stacked phone/email are legacy; never render alongside contact_row (causes duplicate).
  const showStackedPhone = !showContactRow && fieldEnabled(config, 'phone');
  const showStackedEmail = !showContactRow && fieldEnabled(config, 'email');
  // Agency under logo already covers this — don't double it in the details column.
  const showAgencyField = !showLogoLabel && fieldEnabled(config, 'agency');

  const { verticalAlign: vAlign, horizontalAlign: hAlign, logoGap, paddingTop } = config.textPosition;

  const wrapAlignAttr = hAlign === 'center' || hAlign === 'right' ? ` align="${hAlign}"` : '';
  const wrapMargin =
    hAlign === 'center'
      ? 'margin-left:auto;margin-right:auto;'
      : hAlign === 'right'
        ? 'margin-left:auto;'
        : '';
  const tickMargin =
    hAlign === 'center'
      ? ';margin-left:auto;margin-right:auto'
      : hAlign === 'right'
        ? ';margin-left:auto'
        : '';

  const colW = showLogoLabel || showTagline ? Math.max(logoSize + 10, 70) : logoSize + 2;
  const padSide = layout === 'logo-left' ? 'right' : 'left';

  let logoInner =
    '<img src="{{agency_logo}}" width="' +
    logoSize +
    '" alt="' +
    (showLogoLabel ? '' : '{{agency_name}}') +
    '" style="display:block;margin:0 auto;width:' +
    logoSize +
    'px;max-width:' +
    logoSize +
    'px;height:auto">';

  if (showLogoLabel) {
    logoInner +=
      '<div style="font-size:9.5px;font-weight:800;color:' +
      esc(config.logoLabelColor) +
      ';margin-top:6px;letter-spacing:0.08em;line-height:1.15;font-family:Georgia,\'Times New Roman\',serif">{{agency_name}}</div>';
  }
  if (showTagline) {
    logoInner +=
      '<div style="font-size:7px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:0.06em;' +
      'line-height:1.2;font-family:Arial,Helvetica,sans-serif;max-width:' +
      colW +
      'px">{{agency_tagline}}</div>';
  }

  const logoTd =
    '<td width="' +
    colW +
    '" style="width:' +
    colW +
    'px;vertical-align:' +
    vAlign +
    ';text-align:center;padding-' +
    padSide +
    ':' +
    logoGap +
    'px">' +
    logoInner +
    '</td>';

  const dividerTd = showDivider
    ? '<td width="1" style="width:1px;border-left:1.5px solid ' +
      color +
      ';font-size:0;line-height:0;padding:0">&nbsp;</td>'
    : '';

  let detailsPad =
    'vertical-align:' +
    vAlign +
    ';padding-top:' +
    paddingTop +
    'px;font-family:Arial,Helvetica,sans-serif;line-height:1.3';
  detailsPad +=
    layout === 'logo-left' ? ';padding-left:13px' : layout === 'logo-right' ? ';padding-right:13px' : '';

  const nameHtml =
    '<div style="font-size:15px;font-weight:700;color:' +
    nameColor +
    ';margin:0 0 3px;line-height:1.15;letter-spacing:-0.02em;text-align:left">{{sender_name}}</div>';

  const underline = showUnderline
    ? '<div style="height:1.5px;width:148px;max-width:100%;background-color:' +
      color +
      ';margin:0 0 7px;text-align:left"></div>'
    : '';

  const titleHtml = showTitle
    ? '<div style="font-size:11.5px;color:' +
      esc(config.detailColor) +
      ';margin:0 0 8px;line-height:1.25;text-align:left">{{sender_title}}</div>'
    : '';

  const agencyFieldHtml = showAgencyField
    ? '<div style="font-size:11px;color:#6b7280;margin:0 0 6px;text-align:left">{{agency_name}}</div>'
    : '';

  const phoneCell =
    '<td style="padding-right:14px;vertical-align:middle;white-space:nowrap;font-size:11px;color:#374151">' +
    (showContactIcons ? iconTile(color, '☎') : '') +
    '<span style="vertical-align:middle">{{sender_phone}}</span></td>';

  const emailCell =
    '<td style="vertical-align:middle;white-space:nowrap;font-size:11px;color:#374151">' +
    (showContactIcons ? iconTile(color, '✉') : '') +
    '<span style="vertical-align:middle">{{sender_email}}</span></td>';

  const contactTable = showContactRow
    ? '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse"><tr>' +
      phoneCell +
      emailCell +
      '</tr></table>'
    : '';

  const stackedPhone = showStackedPhone
    ? '<div style="font-size:11px;color:#374151;margin:4px 0 0;text-align:left">{{sender_phone}}</div>'
    : '';
  const stackedEmail = showStackedEmail
    ? '<div style="font-size:11px;color:#374151;margin:4px 0 0;text-align:left">{{sender_email}}</div>'
    : '';

  const website = normalizeWebsiteUrl(config.websiteUrl);
  const websiteBar =
    showWebsite && website
      ? '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-top:8px"><tr>' +
        '<td bgcolor="' +
        color +
        '" style="background-color:' +
        color +
        ';padding:5px 11px 5px 9px;line-height:1">' +
        '<span style="display:inline-block;width:11px;height:11px;background:#fff;border-radius:2px;color:' +
        color +
        ';font-size:7px;line-height:11px;text-align:center;vertical-align:middle;margin-right:6px">⌂</span>' +
        '<a href="' +
        esc(website.href) +
        '" style="font-size:10.5px;color:#ffffff;text-decoration:none;' +
        'font-family:Arial,Helvetica,sans-serif;vertical-align:middle;letter-spacing:0.01em">' +
        esc(website.host) +
        '</a></td></tr></table>'
      : '';

  const blockInner =
    nameHtml + underline + titleHtml + agencyFieldHtml + contactTable + stackedPhone + stackedEmail + websiteBar;
  const blockWrapped =
    '<table' +
    wrapAlignAttr +
    ' cellpadding="0" cellspacing="0" border="0" role="presentation" ' +
    'style="border-collapse:collapse;' +
    wrapMargin +
    '">' +
    '<tr><td style="text-align:left;vertical-align:top">' +
    blockInner +
    '</td></tr></table>';

  const detailsTd = '<td style="' + detailsPad + '">' + blockWrapped + '</td>';

  let row: string;
  if (layout === 'no-logo') row = '<tr>' + detailsTd + '</tr>';
  else if (layout === 'logo-right') row = '<tr>' + detailsTd + dividerTd + logoTd + '</tr>';
  else row = '<tr>' + logoTd + dividerTd + detailsTd + '</tr>';

  const dualRuleHtml = showTopRule
    ? '<table cellpadding="0" cellspacing="0" border="0" width="480" role="presentation" style="border-collapse:collapse;width:480px;max-width:100%;margin-bottom:11px">' +
      '<tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;height:1px">&nbsp;</td></tr>' +
      '<tr><td style="padding-top:0">' +
      '<div style="width:42px;height:2px;background:' +
      color +
      ';margin-top:-1px;line-height:0;font-size:0' +
      tickMargin +
      '">&nbsp;</div></td></tr></table>'
    : '';

  return (
    '<!-- v3.2 · single-color · ONE details wrapper (stable L/C/R) · no social -->' +
    '<div style="margin-top:2px;font-family:Arial,Helvetica,sans-serif">' +
    dualRuleHtml +
    '<table cellpadding="0" cellspacing="0" border="0" width="480" role="presentation" ' +
    'style="border-collapse:collapse;width:480px;max-width:100%">' +
    row +
    '</table>' +
    '{{sender_signature}}' +
    '</div>'
  );
}
