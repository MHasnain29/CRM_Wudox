/**
 * Settings → Recruitment Agreement
 * Per-agency PandaDoc mapping for employee onboarding (Client Training = future).
 * Reuses existing proposal-type-templates API — does not touch proposal Temp/Direct sends.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fetchProposalTypeTemplates,
  updateProposalTypeTemplates,
  pandaDocGetTemplates,
  type ProposalTypeTemplates,
} from '@/lib/api';
import { useStore } from '@/lib/store';

type Props = {
  isActive: boolean;
};

export function SettingsRecruitmentAgreementTab({ isActive }: Props) {
  const { subCompanies, currentSubCompany } = useStore();
  const [agencyId, setAgencyId] = useState('');
  const [mapping, setMapping] = useState<ProposalTypeTemplates | null>(null);
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [onboardingId, setOnboardingId] = useState<string>('__none__');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Default agency once when tab opens
  useEffect(() => {
    if (!isActive) return;
    if (agencyId) return;
    const preferred = currentSubCompany?.id;
    const fallback = subCompanies[0]?.id ?? '';
    setAgencyId(preferred && subCompanies.some((s) => s.id === preferred) ? preferred : fallback);
  }, [isActive, agencyId, currentSubCompany?.id, subCompanies]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    try {
      const [m, list] = await Promise.all([
        fetchProposalTypeTemplates(id),
        pandaDocGetTemplates({ catalog: true }),
      ]);
      setMapping(m);
      setTemplates(list);
      setOnboardingId(m.employeeOnboardingTemplateId ?? '__none__');
    } catch {
      toast.error('Failed to load recruitment agreement settings');
      setMapping(null);
      setTemplates([]);
      setOnboardingId('__none__');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive || !agencyId) return;
    void load(agencyId);
  }, [isActive, agencyId, load]);

  const handleSave = async () => {
    if (!agencyId || !mapping) return;
    setSaving(true);
    try {
      // Preserve Temp / Direct / Both — only update onboarding fields.
      const next: ProposalTypeTemplates = {
        ...mapping,
        employeeOnboardingTemplateId: onboardingId === '__none__' ? null : onboardingId,
        employeeOnboardingTemplateName:
          onboardingId === '__none__'
            ? null
            : (templates.find((t) => t.id === onboardingId)?.name ??
              mapping.employeeOnboardingTemplateName),
      };
      const saved = await updateProposalTypeTemplates(next, agencyId);
      setMapping(saved);
      setOnboardingId(saved.employeeOnboardingTemplateId ?? '__none__');
      toast.success('Recruitment agreement settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!isActive) return null;

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Recruitment Agreement</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose the PandaDoc template used when sending employee onboarding for e-signature.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Templates
          </CardTitle>
          <CardDescription>
            Per agency. Employee onboarding is used on Confirm &amp; send.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Agency</Label>
            <Select
              value={agencyId || undefined}
              onValueChange={(v) => {
                setAgencyId(v);
                setMapping(null);
              }}
              disabled={loading || subCompanies.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select agency…" />
              </SelectTrigger>
              <SelectContent>
                {subCompanies.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Loading templates…
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Employee Onboarding</Label>
                <Select
                  value={onboardingId}
                  onValueChange={setOnboardingId}
                  disabled={!agencyId || saving}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a PandaDoc template…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— No template —</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Required for Confirm &amp; send to email the fillable onboarding package.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Client Training</Label>
                <Select value="__none__" disabled>
                  <SelectTrigger>
                    <SelectValue placeholder="Coming soon" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Coming soon</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Reserved for a future release.</p>
              </div>

              <Button onClick={() => void handleSave()} disabled={!agencyId || !mapping || saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
