import { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ColorSwatchPicker } from '@/components/ColorSwatchPicker';
import { cn } from '@/lib/utils';
import { resolveAgencyLogoSrc } from '@/lib/branding';
import { buildSignatureHtmlFromConfig } from '@/lib/signatureHtmlBuilder';
import {
  applySignaturePreset,
  type LogoLayout,
  type LogoSize,
  type SignatureConfig,
  type SignatureFieldKey,
  type SignaturePreset,
  type TextHAlign,
  type TextVAlign,
} from '@/types/signatureConfig';

const FIELD_LABELS: Record<SignatureFieldKey, string> = {
  name: 'Name',
  title: 'Title',
  contact_row: 'Contact row',
  website_bar: 'Website',
  phone: 'Phone (stacked)',
  email: 'Email (stacked)',
  agency: 'Agency name',
  divider: 'Divider',
};

const PRIMARY_FIELDS: SignatureFieldKey[] = ['name', 'title', 'contact_row', 'website_bar'];

interface SignatureBuilderProps {
  config: SignatureConfig;
  onChange: (next: SignatureConfig) => void;
  disabled?: boolean;
  agencyId?: string;
  agencyLogoUrl?: string | null;
  agencyName?: string;
}

function SegButton<T extends string>({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1.5 text-xs font-medium transition border',
        active
          ? 'bg-foreground text-background border-foreground'
          : 'bg-background text-muted-foreground border-border hover:bg-muted',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      {label}
    </button>
  );
}

export function SignatureBuilder({
  config,
  onChange,
  disabled,
  agencyId,
  agencyLogoUrl,
  agencyName,
}: SignatureBuilderProps) {
  const logoSrc = agencyId ? resolveAgencyLogoSrc(agencyLogoUrl, agencyId) : agencyLogoUrl ?? null;

  const previewHtml = useMemo(
    () =>
      buildSignatureHtmlFromConfig(config, {
        placeholders: false,
        logoUrl: logoSrc,
        sample: {
          sender_name: 'David Caldwell',
          sender_title: 'Business Development Manager',
          sender_phone: '647-901-5000 Ext. 1032',
          sender_email: 'david@hrglobal.ca',
          agency_name: agencyName?.trim() || 'GLOBAL HR',
          agency_tagline: 'YOUR REQUIREMENT, OUR COMMITMENT',
          agency_logo: logoSrc,
        },
      }),
    [config, logoSrc, agencyName],
  );

  const patch = (partial: Partial<SignatureConfig>) => onChange({ ...config, ...partial });
  const patchPos = (partial: Partial<SignatureConfig['textPosition']>) =>
    onChange({ ...config, textPosition: { ...config.textPosition, ...partial } });

  const setFieldEnabled = (key: SignatureFieldKey, enabled: boolean) => {
    if (key === 'name') return;
    onChange({
      ...config,
      fields: config.fields.map((f) => (f.key === key ? { ...f, enabled } : f)),
      ...(key === 'website_bar' ? { showWebsiteBar: enabled } : {}),
    });
  };

  const applyPreset = (preset: SignaturePreset) => {
    onChange(applySignaturePreset(config, preset));
  };

  return (
    <div className={cn('grid gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]', disabled && 'opacity-60 pointer-events-none')}>
      <aside className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
        {/* Presets */}
        <section className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Style preset</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['executive', 'Executive'],
              ['compact', 'Compact'],
              ['minimal', 'Minimal'],
            ] as const).map(([id, label]) => (
              <SegButton
                key={id}
                active={(config.preset ?? 'executive') === id}
                label={label}
                disabled={disabled}
                onClick={() => applyPreset(id)}
              />
            ))}
          </div>
        </section>

        {/* Layout */}
        <section className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Layout</div>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['logo-left', 'Logo left'],
              ['logo-right', 'Logo right'],
              ['no-logo', 'No logo'],
            ] as const).map(([id, label]) => (
              <SegButton
                key={id}
                active={config.layout === id}
                label={label}
                disabled={disabled}
                onClick={() => patch({ layout: id as LogoLayout })}
              />
            ))}
          </div>
        </section>

        {/* Agency color */}
        <section className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Agency color</div>
          <ColorSwatchPicker
            value={config.agencyColor}
            disabled={disabled}
            onChange={(agencyColor) => patch({ agencyColor })}
          />
        </section>

        {/* Logo + chrome toggles */}
        <section className="rounded-lg border bg-card p-3 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Logo & chrome</div>
          <div className="flex flex-wrap gap-1.5">
            {([40, 48, 56, 64] as LogoSize[]).map((s, i) => (
              <SegButton
                key={s}
                active={config.logoSize === s}
                label={(['S', 'M', 'L', 'XL'] as const)[i]}
                disabled={disabled}
                onClick={() => patch({ logoSize: s })}
              />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {(
              [
                ['showLogoLabel', 'Name under logo'],
                ['showTagline', 'Tagline'],
                ['showVerticalDivider', 'Divider'],
                ['showNameUnderline', 'Name line'],
                ['showWebsiteBar', 'Website'],
                ['showTopRule', 'Top rule'],
                ['showContactIcons', 'Contact icons'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs cursor-pointer">
                <Checkbox
                  checked={config[key]}
                  disabled={disabled}
                  onCheckedChange={(c) => {
                    const on = c === true;
                    if (key === 'showWebsiteBar') {
                      onChange({
                        ...config,
                        showWebsiteBar: on,
                        fields: config.fields.map((f) =>
                          f.key === 'website_bar' ? { ...f, enabled: on } : f,
                        ),
                      });
                    } else {
                      patch({ [key]: on });
                    }
                  }}
                />
                {label}
              </label>
            ))}
          </div>
          {config.showWebsiteBar && (
            <div className="space-y-1">
              <Label className="text-xs">Website URL</Label>
              <Input
                value={config.websiteUrl ?? ''}
                disabled={disabled}
                placeholder="www.example.com"
                className="h-8 text-xs"
                onChange={(e) => patch({ websiteUrl: e.target.value.trim() || null })}
              />
            </div>
          )}
        </section>

        {/* Text position */}
        <section className="rounded-lg border bg-card p-3 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Text position</div>
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground">Vertical align</div>
            <div className="flex flex-wrap gap-1.5">
              {(['top', 'middle', 'bottom'] as TextVAlign[]).map((v) => (
                <SegButton
                  key={v}
                  active={config.textPosition.verticalAlign === v}
                  label={v[0].toUpperCase() + v.slice(1)}
                  disabled={disabled}
                  onClick={() => patchPos({ verticalAlign: v })}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[10px] text-muted-foreground">Horizontal align</div>
            <div className="flex flex-wrap gap-1.5">
              {(['left', 'center', 'right'] as TextHAlign[]).map((h) => (
                <SegButton
                  key={h}
                  active={config.textPosition.horizontalAlign === h}
                  label={h[0].toUpperCase() + h.slice(1)}
                  disabled={disabled}
                  onClick={() => patchPos({ horizontalAlign: h })}
                />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Logo gap</Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={config.textPosition.logoGap}
                disabled={disabled}
                onChange={(e) => patchPos({ logoGap: Number(e.target.value) as SignatureConfig['textPosition']['logoGap'] })}
              >
                {[8, 12, 16, 20, 24].map((n) => (
                  <option key={n} value={n}>{n}px</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Padding top</Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={config.textPosition.paddingTop}
                disabled={disabled}
                onChange={(e) => patchPos({ paddingTop: Number(e.target.value) as SignatureConfig['textPosition']['paddingTop'] })}
              >
                {[0, 4, 8, 12, 16, 24].map((n) => (
                  <option key={n} value={n}>{n}px</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Fields */}
        <section className="rounded-lg border bg-card p-3 space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Fields</div>
          <div className="space-y-1.5">
            {PRIMARY_FIELDS.map((key) => {
              const f = config.fields.find((x) => x.key === key);
              const locked = key === 'name';
              const enabled = locked || f?.enabled !== false;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium">{FIELD_LABELS[key]}</span>
                  {locked ? (
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Locked</span>
                  ) : (
                    <Checkbox
                      checked={enabled}
                      disabled={disabled}
                      onCheckedChange={(c) => setFieldEnabled(key, c === true)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </aside>

      {/* Live preview */}
      <div className="rounded-lg border bg-muted/40 overflow-hidden min-h-[320px] flex flex-col">
        <div className="flex items-center justify-between border-b bg-background px-3 py-2">
          <strong className="text-sm">Live preview</strong>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
            {(config.preset ?? 'executive')} · {config.layout}
          </span>
        </div>
        <div className="flex-1 p-4 overflow-auto">
          <div className="mx-auto max-w-[560px] rounded-md border bg-white shadow-sm overflow-hidden">
            <div className="border-b bg-slate-50 px-4 py-2 text-[11px] text-slate-600 space-y-0.5">
              <div><b className="text-slate-800">To</b> · hiring@acme.com</div>
              <div><b className="text-slate-800">Subject</b> · Candidates for Warehouse Supervisor</div>
            </div>
            <div className="px-5 py-4 text-[13px] text-slate-800 leading-relaxed">
              <p className="mb-3">Hi Sarah,</p>
              <p className="mb-3">
                Please find the shortlisted candidates attached. Happy to walk through them on a quick call.
              </p>
              <p className="mb-0">Best,</p>
              <div
                className="mt-3.5"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
