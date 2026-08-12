/** Agency email signature visual config (v2 — compact branded design). */

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
export type LogoGap = 8 | 12 | 16 | 20 | 24;
export type SigPadding = 0 | 4 | 8 | 12 | 16 | 24;
export type SigInlinePadding = 12 | 16 | 18 | 20 | 24;

export interface SignatureTextPosition {
  verticalAlign: TextVAlign;
  horizontalAlign: TextHAlign;
  logoGap: LogoGap;
  paddingTop: SigPadding;
  paddingBottom: SigPadding;
  paddingInline: SigInlinePadding;
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

const HEX = /^#[0-9a-fA-F]{6}$/;
const LOGO_SIZES: LogoSize[] = [40, 48, 56, 64];
const LOGO_GAPS: LogoGap[] = [8, 12, 16, 20, 24];
const PADDINGS: SigPadding[] = [0, 4, 8, 12, 16, 24];
const INLINE_PADS: SigInlinePadding[] = [12, 16, 18, 20, 24];

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
  // v1 mapped 32→40, 48→48, 64→64, else→64 (cap)
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
        fontSize: typeof r.fontSize === 'number' ? Math.min(20, Math.max(11, Math.round(r.fontSize))) : base.fontSize,
        color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : base.color ?? null,
      });
    }
  }
  // Ensure contact_row / website_bar exist
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

/**
 * Migrate any stored JSON (v1 or partial) into a safe v2 SignatureConfig.
 * Never throws — always returns a valid config.
 */
export function migrateSignatureConfigToV2(raw: unknown): SignatureConfig {
  const d = DEFAULT_SIGNATURE_CONFIG;
  const r = asRecord(raw) ?? {};

  const agencyColor = pickHex(
    r.agencyColor ?? r.accentColor,
    d.agencyColor,
  );

  const tpRaw = asRecord(r.textPosition) ?? {};
  const textPosition: SignatureTextPosition = {
    verticalAlign: pickEnum(tpRaw.verticalAlign, ['top', 'middle', 'bottom'] as const, d.textPosition.verticalAlign),
    horizontalAlign: pickEnum(tpRaw.horizontalAlign, ['left', 'center', 'right'] as const, d.textPosition.horizontalAlign),
    logoGap: pickNumEnum(tpRaw.logoGap, LOGO_GAPS, d.textPosition.logoGap),
    paddingTop: pickNumEnum(tpRaw.paddingTop, PADDINGS, d.textPosition.paddingTop),
    paddingBottom: pickNumEnum(tpRaw.paddingBottom, PADDINGS, d.textPosition.paddingBottom),
    paddingInline: pickNumEnum(tpRaw.paddingInline, INLINE_PADS, d.textPosition.paddingInline),
  };

  const websiteUrl =
    typeof r.websiteUrl === 'string'
      ? r.websiteUrl
      : typeof r.agencyWebsite === 'string'
        ? r.agencyWebsite
        : null;

  const showWebsiteBar = pickBool(
    r.showWebsiteBar ?? r.showWebsiteBanner,
    d.showWebsiteBar,
  );

  return {
    version: 2,
    layout: pickEnum(r.layout, ['logo-left', 'logo-right', 'no-logo'] as const, d.layout),
    preset: pickEnum(r.preset, ['executive', 'compact', 'minimal'] as const, d.preset ?? 'executive'),
    agencyColor,
    nameColor:
      typeof r.nameColor === 'string' && HEX.test(r.nameColor) ? r.nameColor : null,
    detailColor: pickHex(r.detailColor, d.detailColor),
    logoLabelColor: pickHex(r.logoLabelColor, d.logoLabelColor),
    logoSize: LOGO_SIZES.includes(r.logoSize as LogoSize) ? (r.logoSize as LogoSize) : nearestLogoSize(r.logoSize),
    showLogoLabel: pickBool(r.showLogoLabel, d.showLogoLabel),
    showTagline: pickBool(r.showTagline, false),
    showVerticalDivider: pickBool(r.showVerticalDivider ?? r.showInlineDivider, d.showVerticalDivider),
    showNameUnderline: pickBool(r.showNameUnderline, d.showNameUnderline),
    showWebsiteBar,
    showTopRule: pickBool(r.showTopRule, true),
    showContactIcons: pickBool(r.showContactIcons, true),
    websiteUrl: websiteUrl?.trim() ? websiteUrl.trim() : null,
    textPosition,
    fields: migrateFields(r.fields),
  };
}

/** Apply a named preset on top of the current config (preserves agencyColor / websiteUrl / layout). */
export function applySignaturePreset(
  config: SignatureConfig,
  preset: SignaturePreset,
): SignatureConfig {
  const base = { ...config, preset };
  if (preset === 'executive') {
    return {
      ...base,
      logoSize: 48,
      showLogoLabel: true,
      showTagline: false,
      showVerticalDivider: true,
      showNameUnderline: true,
      showWebsiteBar: true,
      showTopRule: true,
      showContactIcons: true,
      fields: config.fields.map((f) => {
        if (f.key === 'name' || f.key === 'title' || f.key === 'contact_row' || f.key === 'website_bar') {
          return { ...f, enabled: true };
        }
        return { ...f, enabled: false };
      }),
    };
  }
  if (preset === 'compact') {
    return {
      ...base,
      logoSize: 40,
      showLogoLabel: false,
      showTagline: false,
      showVerticalDivider: true,
      showNameUnderline: true,
      showWebsiteBar: false,
      showTopRule: true,
      showContactIcons: true,
      fields: config.fields.map((f) => {
        if (f.key === 'website_bar') return { ...f, enabled: false };
        if (f.key === 'name' || f.key === 'title' || f.key === 'contact_row') return { ...f, enabled: true };
        return { ...f, enabled: false };
      }),
    };
  }
  // minimal
  return {
    ...base,
    logoSize: 40,
    showLogoLabel: false,
    showTagline: false,
    showVerticalDivider: false,
    showNameUnderline: false,
    showWebsiteBar: false,
    showTopRule: true,
    showContactIcons: false,
    fields: config.fields.map((f) => {
      if (f.key === 'name' || f.key === 'title' || f.key === 'contact_row') return { ...f, enabled: true };
      return { ...f, enabled: f.key === 'name' };
    }),
  };
}

/** Normalize website for storage/display. Rejects javascript:. Returns host + https href. */
export function normalizeWebsiteUrl(raw: string | null | undefined): { host: string; href: string } | null {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  if (/^\s*javascript:/i.test(trimmed)) return null;
  const host = trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (!host || /[<>"']/.test(host)) return null;
  // basic host sanity
  if (host.includes(' ')) return null;
  return { host, href: `https://${host}` };
}
