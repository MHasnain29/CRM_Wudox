/**
 * Outlook-safe agency signature HTML builder (v3.2).
 * Mirrors backend `buildSignatureHtmlFromConfig` — keep in sync.
 *
 * CRITICAL: Never put align="left|right" on nested contact/website tables.
 * One wrapper table around the entire details block handles L/C/R.
 */

import {
  type SignatureConfig,
  type SignatureFieldKey,
  normalizeWebsiteUrl,
} from '@/types/signatureConfig';

export interface SignaturePreviewSample {
  sender_name: string;
  sender_title: string;
  sender_phone: string;
  sender_email: string;
  agency_name: string;
  agency_tagline: string;
  agency_logo?: string | null;
}

export const DEFAULT_SIGNATURE_SAMPLE: SignaturePreviewSample = {
  sender_name: 'David Caldwell',
  sender_title: 'Business Development Manager',
  sender_phone: '647-901-5000 Ext. 1032',
  sender_email: 'david@hrglobal.ca',
  agency_name: 'GLOBAL HR',
  agency_tagline: 'YOUR REQUIREMENT, OUR COMMITMENT',
  agency_logo: null,
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const f = config.fields.find((x) => x.key === key);
  if (key === 'name') return true;
  return f?.enabled !== false;
}

function logoPlaceholder(color: string, size: number): string {
  return (
    '<div style="width:' +
    size +
    'px;height:' +
    size +
    'px;background-color:' +
    color +
    ';border-radius:4px;margin:0 auto;line-height:' +
    size +
    'px;text-align:center;color:#fff;font-size:' +
    Math.round(size * 0.28) +
    'px;font-weight:700;font-family:Arial,Helvetica,sans-serif">LOGO</div>'
  );
}

export interface BuildSignatureHtmlOptions {
  /** When true, emit {{placeholders}} instead of sample values (except website host baked). */
  placeholders?: boolean;
  sample?: SignaturePreviewSample;
  /** Preview-only logo URL override (real agency logo). */
  logoUrl?: string | null;
}

/**
 * Build machine-generated signature HTML from config.
 * Website host is baked into the HTML (https href); other sender fields stay as placeholders when `placeholders` is true.
 */
export function buildSignatureHtmlFromConfig(
  config: SignatureConfig,
  opts: BuildSignatureHtmlOptions = {},
): string {
  const placeholders = opts.placeholders === true;
  const sample = opts.sample ?? DEFAULT_SIGNATURE_SAMPLE;
  const v = (key: keyof SignaturePreviewSample): string => {
    if (placeholders) {
      if (key === 'agency_logo') return '{{agency_logo}}';
      return `{{${key}}}`;
    }
    return String(sample[key] ?? '');
  };

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

  const logoSrc = placeholders
    ? '{{agency_logo}}'
    : (opts.logoUrl?.trim() || sample.agency_logo?.trim() || '');

  let logoInner: string;
  if (logoSrc) {
    logoInner =
      '<img src="' +
      esc(logoSrc) +
      '" width="' +
      logoSize +
      '" alt="' +
      // Avoid "Agency / Agency" when logo fails to load and label is also shown.
      esc(showLogoLabel ? '' : placeholders ? '{{agency_name}}' : sample.agency_name) +
      '" style="display:block;margin:0 auto;width:' +
      logoSize +
      'px;max-width:' +
      logoSize +
      'px;height:auto">';
  } else {
    logoInner = logoPlaceholder(color, logoSize);
  }

  if (showLogoLabel) {
    logoInner +=
      '<div style="font-size:9.5px;font-weight:800;color:' +
      esc(config.logoLabelColor) +
      ';margin-top:6px;letter-spacing:0.08em;line-height:1.15;font-family:Georgia,\'Times New Roman\',serif">' +
      esc(v('agency_name')) +
      '</div>';
  }
  if (showTagline) {
    logoInner +=
      '<div style="font-size:7px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:0.06em;' +
      'line-height:1.2;font-family:Arial,Helvetica,sans-serif;max-width:' +
      colW +
      'px">' +
      esc(v('agency_tagline')) +
      '</div>';
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
    ';margin:0 0 3px;line-height:1.15;letter-spacing:-0.02em;text-align:left">' +
    esc(v('sender_name')) +
    '</div>';

  const underline = showUnderline
    ? '<div style="height:1.5px;width:148px;max-width:100%;background-color:' +
      color +
      ';margin:0 0 7px;text-align:left"></div>'
    : '';

  const titleHtml = showTitle
    ? '<div style="font-size:11.5px;color:' +
      esc(config.detailColor) +
      ';margin:0 0 8px;line-height:1.25;text-align:left">' +
      esc(v('sender_title')) +
      '</div>'
    : '';

  const agencyFieldHtml = showAgencyField
    ? '<div style="font-size:11px;color:#6b7280;margin:0 0 6px;text-align:left">' +
      esc(v('agency_name')) +
      '</div>'
    : '';

  const phoneCell =
    '<td style="padding-right:14px;vertical-align:middle;white-space:nowrap;font-size:11px;color:#374151">' +
    (showContactIcons ? iconTile(color, '☎') : '') +
    '<span style="vertical-align:middle">' +
    esc(v('sender_phone')) +
    '</span></td>';

  const emailCell =
    '<td style="vertical-align:middle;white-space:nowrap;font-size:11px;color:#374151">' +
    (showContactIcons ? iconTile(color, '✉') : '') +
    '<span style="vertical-align:middle">' +
    esc(v('sender_email')) +
    '</span></td>';

  // Contact + website: NO float align — stack inside the block wrapper
  const contactTable = showContactRow
    ? '<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse"><tr>' +
      phoneCell +
      emailCell +
      '</tr></table>'
    : '';

  const stackedPhone = showStackedPhone
    ? '<div style="font-size:11px;color:#374151;margin:4px 0 0;text-align:left">' +
      esc(v('sender_phone')) +
      '</div>'
    : '';
  const stackedEmail = showStackedEmail
    ? '<div style="font-size:11px;color:#374151;margin:4px 0 0;text-align:left">' +
      esc(v('sender_email')) +
      '</div>'
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
    (placeholders ? '{{sender_signature}}' : '') +
    '</div>'
  );
}
