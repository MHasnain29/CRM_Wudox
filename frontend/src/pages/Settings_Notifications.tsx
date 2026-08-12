import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Loader2, RotateCcw, Save, ChevronDown, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchNotificationRules,
  previewNotificationRule,
  updateNotificationRules,
  type ApiNotificationRule,
  type NotificationCategory,
} from '@/lib/api';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  leads: 'Leads',
  clients: 'Clients',
  tasks: 'Tasks',
  follow_ups: 'Follow-ups',
  meetings: 'Meetings',
  proposals: 'Proposals',
  approvals: 'Approvals',
  settings: 'Settings',
  bugs: 'Bug reports',
  jobs: 'Jobs',
};

type EditedRule = {
  enabled: boolean;
  titleTemplate: string;
  bodyTemplate: string;
  dirty: boolean;
};

function PlaceholderChips({
  placeholders,
  onInsert,
}: {
  placeholders: string[];
  onInsert: (token: string) => void;
}) {
  if (placeholders.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {placeholders.map((p) => (
        <button
          key={p}
          type="button"
          className="text-xs rounded-md border px-2 py-0.5 bg-muted hover:bg-muted/80 font-mono"
          onClick={() => onInsert(`{{${p}}}`)}
        >
          {`{{${p}}}`}
        </button>
      ))}
    </div>
  );
}

function AdminRuleEditor({
  rule,
  edited,
  onChange,
  onReset,
  onSave,
  saving,
}: {
  rule: ApiNotificationRule;
  edited: EditedRule;
  onChange: (patch: Partial<EditedRule>) => void;
  onReset: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const titleValue = edited.titleTemplate || rule.defaultTitle;
  const bodyValue = edited.bodyTemplate || rule.defaultBody;

  const runPreview = useCallback(async () => {
    setPreviewLoading(true);
    try {
      const result = await previewNotificationRule({
        eventKey: rule.eventKey,
        titleTemplate: edited.titleTemplate.trim() || null,
        bodyTemplate: edited.bodyTemplate.trim() || null,
        context: rule.sampleContext,
      });
      setPreview(result);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  }, [rule, edited.titleTemplate, edited.bodyTemplate]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border rounded-lg">
      <div className="flex items-center gap-3 p-3">
        <Switch
          checked={edited.enabled}
          onCheckedChange={(enabled) => onChange({ enabled, dirty: true })}
        />
        <CollapsibleTrigger className="flex-1 text-left flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{rule.label}</p>
            <p className="text-xs text-muted-foreground truncate">{rule.description}</p>
            <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-0.5">{rule.eventKey}</p>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
        {edited.dirty && <Badge variant="secondary">Unsaved</Badge>}
      </div>
      <CollapsibleContent className="px-3 pb-3 space-y-3 border-t pt-3">
        <div className="space-y-1.5">
          <Label>Title</Label>
          <Input
            value={titleValue}
            onChange={(e) =>
              onChange({
                titleTemplate: e.target.value === rule.defaultTitle ? '' : e.target.value,
                dirty: true,
              })
            }
          />
          <PlaceholderChips
            placeholders={rule.placeholders}
            onInsert={(token) =>
              onChange({
                titleTemplate: `${titleValue}${token}`,
                dirty: true,
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Body</Label>
          <Textarea
            rows={3}
            value={bodyValue}
            onChange={(e) =>
              onChange({
                bodyTemplate: e.target.value === rule.defaultBody ? '' : e.target.value,
                dirty: true,
              })
            }
          />
          <PlaceholderChips
            placeholders={rule.placeholders}
            onInsert={(token) =>
              onChange({
                bodyTemplate: `${bodyValue}${token}`,
                dirty: true,
              })
            }
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={runPreview} disabled={previewLoading}>
            {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Preview'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving || !edited.dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Save
          </Button>
        </div>
        {preview && (
          <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
            <p className="font-medium">{preview.title}</p>
            <p className="text-muted-foreground">{preview.body}</p>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function NotificationsSection({ canManageRules }: { canManageRules: boolean }) {
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const [category, setCategory] = useState<NotificationCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [rules, setRules] = useState<ApiNotificationRule[]>([]);
  const [editedRules, setEditedRules] = useState<Record<string, EditedRule>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const load = useCallback(async () => {
    if (!canManageRules) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rulesData = await fetchNotificationRules({ subCompanyId: currentSubCompany?.id });
      setRules(rulesData);
      const nextEdited: Record<string, EditedRule> = {};
      for (const r of rulesData) {
        nextEdited[r.eventKey] = {
          enabled: r.enabled,
          titleTemplate: r.titleTemplate ?? '',
          bodyTemplate: r.bodyTemplate ?? '',
          dirty: false,
        };
      }
      setEditedRules(nextEdited);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load notification settings');
    } finally {
      setLoading(false);
    }
  }, [canManageRules, currentSubCompany?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRules = useMemo(() => {
    return rules.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.label.toLowerCase().includes(q) ||
        r.eventKey.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [rules, category, search]);

  const dirtyCount = useMemo(
    () => Object.values(editedRules).filter((r) => r.dirty).length,
    [editedRules],
  );

  const saveAllDirty = async () => {
    const dirtyKeys = Object.entries(editedRules)
      .filter(([, v]) => v.dirty)
      .map(([k]) => k);
    if (dirtyKeys.length === 0) return;
    setSavingAll(true);
    try {
      await updateNotificationRules({
        subCompanyId: currentSubCompany?.id,
        rules: dirtyKeys.map((eventKey) => {
          const edited = editedRules[eventKey]!;
          return {
            eventKey,
            enabled: edited.enabled,
            titleTemplate: edited.titleTemplate.trim() || null,
            bodyTemplate: edited.bodyTemplate.trim() || null,
          };
        }),
      });
      toast.success(`Saved ${dirtyKeys.length} notification rule(s)`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingAll(false);
    }
  };

  const saveRule = async (eventKey: string) => {
    const edited = editedRules[eventKey];
    if (!edited) return;
    setSavingKey(eventKey);
    try {
      await updateNotificationRules({
        subCompanyId: currentSubCompany?.id,
        rules: [
          {
            eventKey,
            enabled: edited.enabled,
            titleTemplate: edited.titleTemplate.trim() || null,
            bodyTemplate: edited.bodyTemplate.trim() || null,
          },
        ],
      });
      toast.success('Notification rule saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSavingKey(null);
    }
  };

  const resetRule = (rule: ApiNotificationRule) => {
    setEditedRules((prev) => ({
      ...prev,
      [rule.eventKey]: {
        enabled: rule.defaultEnabled,
        titleTemplate: '',
        bodyTemplate: '',
        dirty: true,
      },
    }));
  };

  if (!canManageRules) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        Only agency admins can configure notifications.
      </p>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading notification settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search notifications…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Tabs value={category} onValueChange={(v) => setCategory(v as NotificationCategory | 'all')}>
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="all">All</TabsTrigger>
            {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
              <TabsTrigger key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle>Agency notification rules</CardTitle>
            <CardDescription>
              Control which operations send in-app notifications and customize message templates for{' '}
              {currentSubCompany?.name ?? 'this agency'}. All users receive notifications per these rules.
              Use placeholders like {'{{entityLabel}}'}, {'{{actorName}}'}, {'{{taskTitle}}'}.
            </CardDescription>
          </div>
          {dirtyCount > 0 && (
            <Button type="button" size="sm" onClick={() => void saveAllDirty()} disabled={savingAll}>
              {savingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              Save all ({dirtyCount})
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[min(520px,60vh)] pr-3">
            <div className="space-y-2">
              {filteredRules.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No rules match your filter.</p>
              ) : (
                filteredRules.map((rule) => {
                  const edited = editedRules[rule.eventKey] ?? {
                    enabled: rule.enabled,
                    titleTemplate: rule.titleTemplate ?? '',
                    bodyTemplate: rule.bodyTemplate ?? '',
                    dirty: false,
                  };
                  return (
                    <AdminRuleEditor
                      key={rule.eventKey}
                      rule={rule}
                      edited={edited}
                      onChange={(patch) =>
                        setEditedRules((prev) => ({
                          ...prev,
                          [rule.eventKey]: { ...edited, ...patch },
                        }))
                      }
                      onReset={() => resetRule(rule)}
                      onSave={() => saveRule(rule.eventKey)}
                      saving={savingKey === rule.eventKey}
                    />
                  );
                })
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
