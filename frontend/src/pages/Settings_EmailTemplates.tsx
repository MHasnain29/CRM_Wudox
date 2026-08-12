import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmailRichTextEditor } from '@/components/EmailRichTextEditor';
import { EmailTemplatePreview } from '@/components/EmailTemplatePreview';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Plus,
  Pencil,
  Trash2,
  FileText,
  Loader2,
  ArrowLeft,
  Eye,
  Code,
  Type,
  Save,
  Copy,
  LayoutTemplate,
  Search,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchEmailTemplates,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  fetchAgencySignature,
  updateAgencySignature,
  type ApiEmailTemplate,
} from '@/lib/api';
import { useCanAccessMultipleAgencies, useCanConfigureAgencySignature } from '@/lib/access';
import {
  starterTemplates,
  templateCategories,
  placeholders,
  fillPlaceholders,
  type StarterTemplate,
} from '@/lib/emailStarterTemplates';
import { cn } from '@/lib/utils';
import { SignatureBuilder } from '@/components/SignatureBuilder';
import {
  DEFAULT_SIGNATURE_CONFIG,
  migrateSignatureConfigToV2,
  type SignatureConfig,
} from '@/types/signatureConfig';

type EditorMode = 'visual' | 'html' | 'preview';
type View = 'list' | 'editor' | 'starter-picker';

interface EditorForm {
  name: string;
  subject: string;
  bodyHtml: string;
}

// ───────── Starter Template Thumbnail ─────────
function StarterThumbnail({ template }: { template: StarterTemplate }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const agencyFooterText = useStore((s) => {
    const sub = s.currentSubCompany;
    return [sub?.emailFooterText?.trim(), sub?.emailTagline?.trim()].filter(Boolean).join(' · ') || null;
  });
  const agencyName = useStore((s) => s.currentSubCompany?.name?.trim() || null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = fillPlaceholders(template.html, agencyFooterText, agencyName);
  }, [template.html, agencyFooterText, agencyName]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      className="w-full h-full border-none pointer-events-none"
      title={template.name}
      tabIndex={-1}
    />
  );
}

// ───────── Starter Picker ─────────
function StarterPicker({
  onPick,
  onCancel,
}: {
  onPick: (template: StarterTemplate) => void;
  onCancel: () => void;
}) {
  const [category, setCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  const filtered = starterTemplates.filter((t) => {
    if (category !== 'all' && t.category !== category) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Choose a Starter Template</h2>
          <p className="text-sm text-muted-foreground mt-1">Pick a professionally designed template to get started</p>
        </div>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-1">
            {templateCategories.map((cat) => (
              <Button
                key={cat.key}
                variant={category === cat.key ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs shrink-0"
                onClick={() => setCategory(cat.key)}
              >
                {cat.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((t) => (
          <button
            key={t.key}
            className="group text-left border rounded-lg overflow-hidden bg-card hover:border-primary hover:shadow-lg transition-all"
            onClick={() => onPick(t)}
          >
            <div className="h-[180px] bg-white overflow-hidden relative">
              <div className="absolute inset-0 transform scale-[0.45] origin-top-left" style={{ width: '222%', height: '222%' }}>
                <StarterThumbnail template={t} />
              </div>
              <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white/20 group-hover:to-primary/5 transition-colors" />
            </div>
            <div className="p-3">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm">{t.name}</p>
                <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{t.description}</p>
            </div>
          </button>
        ))}
      </div>
      {filtered.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <LayoutTemplate className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>No templates match your search</p>
        </div>
      )}
    </div>
  );
}

// ───────── Full Editor View ─────────
function TemplateEditor({
  editing,
  initialForm,
  initialHtml,
  onSave,
  onCancel,
  saving,
}: {
  editing: ApiEmailTemplate | null;
  initialForm: EditorForm;
  initialHtml: string;
  onSave: (form: EditorForm) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const agencyFooterText = useStore((s) => {
    const sub = s.currentSubCompany;
    return [sub?.emailFooterText?.trim(), sub?.emailTagline?.trim()].filter(Boolean).join(' · ') || null;
  });
  const [form, setForm] = useState<EditorForm>(initialForm);
  const [fullHtml, setFullHtml] = useState(initialHtml);
  // Full HTML documents (starter templates) should open in HTML mode; simple body content in visual
  const isFullHtmlDoc = initialHtml.trim().startsWith('<!DOCTYPE') || initialHtml.trim().startsWith('<html');
  const [editorMode, setEditorMode] = useState<EditorMode>(isFullHtmlDoc ? 'html' : 'visual');
  const [htmlSource, setHtmlSource] = useState(initialHtml);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync htmlSource when switching TO html mode
  useEffect(() => {
    if (editorMode === 'html') {
      setHtmlSource(fullHtml);
    }
  }, [editorMode, fullHtml]);

  const handleVisualChange = (html: string) => {
    setForm((f) => ({ ...f, bodyHtml: html }));
    setFullHtml(html);
  };

  const handleHtmlSourceChange = (src: string) => {
    setHtmlSource(src);
    setFullHtml(src);
    setForm((f) => ({ ...f, bodyHtml: src }));
  };

  const getLatestHtml = () => {
    if (editorMode === 'html') return htmlSource;
    return fullHtml;
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.subject.trim()) {
      toast.error('Name and subject are required');
      return;
    }
    const bodyHtml = getLatestHtml();
    if (!bodyHtml.trim()) {
      toast.error('Template body cannot be empty');
      return;
    }
    onSave({ ...form, bodyHtml });
  };

  const copyHtml = () => {
    navigator.clipboard.writeText(getLatestHtml()).then(() => toast.success('HTML copied to clipboard'));
  };

  const insertPlaceholder = (key: string) => {
    if (editorMode === 'html' && htmlTextareaRef.current) {
      const ta = htmlTextareaRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = ta.value.substring(0, start) + key + ta.value.substring(end);
      handleHtmlSourceChange(newVal);
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + key.length, start + key.length);
      }, 0);
    } else if (editorMode === 'visual') {
      // Insert at cursor in contentEditable via execCommand
      document.execCommand('insertText', false, key);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top Bar */}
      <div className="flex items-center justify-between border-b px-4 py-3 bg-background shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h2 className="font-semibold text-sm">{editing ? 'Edit Template' : 'New Template'}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as EditorMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="visual" className="gap-1.5 text-xs">
                <Type className="h-3.5 w-3.5" />
                Visual
              </TabsTrigger>
              <TabsTrigger value="html" className="gap-1.5 text-xs">
                <Code className="h-3.5 w-3.5" />
                HTML
              </TabsTrigger>
              <TabsTrigger value="preview" className="gap-1.5 text-xs">
                <Eye className="h-3.5 w-3.5" />
                Preview
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="w-px h-6 bg-border" />
          <Button variant="ghost" size="sm" onClick={copyHtml} className="gap-1.5 text-xs">
            <Copy className="h-3.5 w-3.5" />
            Copy HTML
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {editing ? 'Update' : 'Create'}
          </Button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="w-[260px] border-r shrink-0 overflow-y-auto bg-muted/20">
          <div className="p-4 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Template Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Follow-up"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Subject Line</Label>
              <Input
                value={form.subject}
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. Following up — {{company_name}}"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Placeholders</Label>
              <p className="text-[11px] text-muted-foreground">Click to insert at cursor</p>
              <div className="flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <button
                    key={p.key}
                    className="px-2 py-0.5 rounded-full text-[11px] bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
                    onClick={() => insertPlaceholder(p.key)}
                    title={`${p.label}: ${p.sample}`}
                  >
                    {p.key}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2.5 space-y-1">
              <p className="text-[11px] font-semibold text-green-600 dark:text-green-400">Auto-Signature</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Every sent email automatically ends with the <span className="font-medium text-foreground">Agency Email Signature</span> configured in Settings → Templates, followed by the sender&apos;s personal signature.
              </p>
              <p className="text-[11px] text-muted-foreground">You do not need to add this manually.</p>
            </div>
          </div>
        </div>

        {/* Editor / Preview */}
        <div className="flex-1 min-w-0 flex flex-col">
          {editorMode === 'visual' && (
            <div className="flex-1 overflow-auto p-4">
              <div className="max-w-[700px] mx-auto">
                {isFullHtmlDoc && (
                  <div className="mb-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-2.5 text-sm text-yellow-600 dark:text-yellow-400">
                    This template uses full HTML. Use the <strong>HTML</strong> tab for advanced editing or <strong>Preview</strong> to see the rendered email.
                  </div>
                )}
                <EmailRichTextEditor
                  value={form.bodyHtml}
                  onChange={handleVisualChange}
                  placeholder="Write your email template content..."
                  minHeight={500}
                  hideModeTabs
                />
              </div>
            </div>
          )}

          {editorMode === 'html' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
                <span className="text-xs text-muted-foreground">HTML Source — Edit raw HTML for full email template control</span>
              </div>
              <div className="flex-1 overflow-hidden">
                <Textarea
                  ref={htmlTextareaRef}
                  value={htmlSource}
                  onChange={(e) => handleHtmlSourceChange(e.target.value)}
                  placeholder="<html>...</html>"
                  className="h-full w-full rounded-none border-0 font-mono text-sm resize-none focus-visible:ring-0"
                  style={{ minHeight: '100%' }}
                />
              </div>
            </div>
          )}

          {editorMode === 'preview' && (
            <EmailTemplatePreview html={fullHtml} agencyFooterText={agencyFooterText} className="flex-1" />
          )}
        </div>
      </div>
    </div>
  );
}

// ───────── Auto Signature Card ─────────
export function AutoSignatureCard() {
  const canEdit = useCanConfigureAgencySignature();
  const isElevated = useCanAccessMultipleAgencies();
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const [selectedAgencyId, setSelectedAgencyId] = useState(currentSubCompany?.id ?? '');
  const [config, setConfig] = useState<SignatureConfig>(DEFAULT_SIGNATURE_CONFIG);
  const [savedSnapshot, setSavedSnapshot] = useState<string>('');
  const [agencyLogoUrl, setAgencyLogoUrl] = useState<string | null>(null);
  const [isLegacy, setIsLegacy] = useState(false);
  const [usingDefault, setUsingDefault] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedAgency = subCompanies.find((s) => s.id === selectedAgencyId) ?? currentSubCompany;
  const dirty = JSON.stringify(config) !== savedSnapshot;

  const load = useCallback(async (agencyId: string) => {
    if (isElevated && !agencyId) return;
    setLoading(true);
    try {
      const data = await fetchAgencySignature(isElevated ? agencyId : undefined);
      const migrated = data.emailSignatureConfig
        ? migrateSignatureConfigToV2(data.emailSignatureConfig)
        : { ...DEFAULT_SIGNATURE_CONFIG };
      setConfig(migrated);
      setSavedSnapshot(JSON.stringify(migrated));
      setAgencyLogoUrl(data.agencyLogoUrl ?? null);
      setIsLegacy(!!data.isLegacy);
      setUsingDefault(!!data.usingDefault);
    } finally {
      setLoading(false);
    }
  }, [isElevated]);

  useEffect(() => {
    load(selectedAgencyId);
  }, [load, selectedAgencyId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateAgencySignature(
        { emailSignatureConfig: config },
        isElevated ? selectedAgencyId : undefined,
      );
      const saved = res.emailSignatureConfig
        ? migrateSignatureConfigToV2(res.emailSignatureConfig)
        : config;
      setConfig(saved);
      setSavedSnapshot(JSON.stringify(saved));
      setIsLegacy(false);
      setUsingDefault(false);
      toast.success('Agency signature saved');
    } catch {
      toast.error('Failed to save signature');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    const next = { ...DEFAULT_SIGNATURE_CONFIG };
    setConfig(next);
    setSaving(true);
    try {
      await updateAgencySignature(
        { emailSignatureConfig: next },
        isElevated ? selectedAgencyId : undefined,
      );
      setSavedSnapshot(JSON.stringify(next));
      setIsLegacy(false);
      setUsingDefault(false);
      toast.success('Reset to Executive default');
    } catch {
      toast.error('Failed to reset signature');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertLegacy = async () => {
    setSaving(true);
    try {
      const next = { ...DEFAULT_SIGNATURE_CONFIG };
      await updateAgencySignature(
        { emailSignatureConfig: next },
        isElevated ? selectedAgencyId : undefined,
      );
      setConfig(next);
      setSavedSnapshot(JSON.stringify(next));
      setIsLegacy(false);
      setUsingDefault(false);
      toast.success('Converted to visual signature');
    } catch {
      toast.error('Failed to convert signature');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">Agency Email Signature</CardTitle>
          {isElevated && subCompanies.length > 1 && (
            <Select value={selectedAgencyId} onValueChange={setSelectedAgencyId}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder="Select agency" />
              </SelectTrigger>
              <SelectContent>
                {subCompanies.map((sc) => (
                  <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Compact branded footer appended to every outgoing email from this agency.
          Placeholders resolve at send time ({'{{sender_name}}'}, {'{{agency_logo}}'}, etc.).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {usingDefault && !isLegacy && (
          <div className="rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            Using the <span className="font-medium text-foreground">universal default</span> signature
            (Executive · logo left). Emails already use this even before you save — customize and save
            to make it agency-specific.
          </div>
        )}
        {isLegacy && (
          <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="space-y-2 flex-1">
              <p>
                This agency still uses a legacy raw-HTML signature. Save with the visual builder to
                convert it to the approved compact design.
              </p>
              {canEdit && (
                <Button size="sm" variant="outline" onClick={handleConvertLegacy} disabled={saving}>
                  Convert to visual signature
                </Button>
              )}
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SignatureBuilder
              config={config}
              onChange={setConfig}
              disabled={!canEdit}
              agencyId={selectedAgency?.id}
              agencyLogoUrl={agencyLogoUrl ?? selectedAgency?.agencyLogoUrl}
              agencyName={selectedAgency?.name}
            />
            {!canEdit && (
              <p className="text-xs text-muted-foreground">You don&apos;t have permission to edit the agency signature.</p>
            )}
            {canEdit && (
              <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-3">
                <div className="text-xs text-muted-foreground">
                  {dirty ? (
                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                      Unsaved changes
                    </span>
                  ) : (
                    <span>All changes saved</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleReset} disabled={saving}>
                    Reset
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : null}
                    Save Signature
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ───────── Main Component ─────────
export function EmailTemplatesSection() {
  const isElevated = useCanAccessMultipleAgencies();
  const subCompanies = useStore((s) => s.subCompanies);
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const [selectedAgencyId, setSelectedAgencyId] = useState(isElevated ? 'all' : (currentSubCompany?.id ?? ''));
  const [createAgencyId, setCreateAgencyId] = useState(currentSubCompany?.id ?? subCompanies[0]?.id ?? '');

  // Sync createAgencyId from the list filter when a specific agency is selected.
  // When 'all' is selected, createAgencyId stays empty — backend will create a global template.
  useEffect(() => {
    if (selectedAgencyId && selectedAgencyId !== 'all') {
      if (selectedAgencyId !== createAgencyId) setCreateAgencyId(selectedAgencyId);
    }
  }, [selectedAgencyId, createAgencyId]);

  const [templates, setTemplates] = useState<ApiEmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ApiEmailTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [editorForm, setEditorForm] = useState<EditorForm>({ name: '', subject: '', bodyHtml: '' });
  const [editorHtml, setEditorHtml] = useState('');

  const agencyNameById = useMemo(() => Object.fromEntries(subCompanies.map((sc) => [sc.id, sc.name])), [subCompanies]);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchEmailTemplates({
        scope: 'shared',
        ...(isElevated ? { subCompanyId: selectedAgencyId || 'all' } : {}),
      });
      setTemplates(list);
    } catch {
      toast.error('Failed to load templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [isElevated, selectedAgencyId]);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const openStarterPicker = () => {
    setEditing(null);
    setView('starter-picker');
  };

  const handlePickStarter = (starter: StarterTemplate) => {
    setEditing(null);
    // Bake selected agency name into header so Blank (and any {{agency_name}}) matches the agency being configured
    const agencyIdForCreate =
      isElevated && selectedAgencyId && selectedAgencyId !== 'all'
        ? (createAgencyId || selectedAgencyId)
        : (createAgencyId || currentSubCompany?.id || '');
    const agencyName =
      agencyNameById[agencyIdForCreate] ||
      currentSubCompany?.name ||
      'Agency';
    const html = starter.html.replace(/\{\{agency_name\}\}/g, agencyName);
    setEditorForm({
      name: starter.name,
      subject: starter.subject,
      bodyHtml: html,
    });
    setEditorHtml(html);
    setView('editor');
  };

  const openEdit = (t: ApiEmailTemplate) => {
    setEditing(t);
    setEditorForm({
      name: t.name,
      subject: t.subject,
      bodyHtml: t.bodyHtml,
    });
    setEditorHtml(t.bodyHtml);
    setView('editor');
  };

  const handleSave = async (form: EditorForm) => {
    if (!form.name.trim() || !form.subject.trim() || !form.bodyHtml.trim()) {
      toast.error('Name, subject and body are required');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateEmailTemplate(editing.id, {
          name: form.name.trim(),
          subject: form.subject.trim(),
          bodyHtml: form.bodyHtml.trim(),
          headerHtml: null,
          footerHtml: null,
        });
        toast.success('Template updated');
      } else {
        await createEmailTemplate({
          name: form.name.trim(),
          subject: form.subject.trim(),
          bodyHtml: form.bodyHtml.trim(),
          // 'all' selected → no subCompanyId → backend stores as global (null), visible to all agencies
          ...(isElevated && selectedAgencyId !== 'all' && createAgencyId ? { subCompanyId: createAgencyId } : {}),
        });
        toast.success('Template created');
      }
      setView('list');
      loadTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteEmailTemplate(id);
      toast.success('Template deleted');
      setDeleteId(null);
      loadTemplates();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cannot delete this template');
    }
  };

  // ─── Full editor view ───
  if (view === 'editor') {
    return (
      <Card className="overflow-hidden" style={{ height: 'calc(100vh - 180px)', minHeight: '600px' }}>
        <TemplateEditor
          editing={editing}
          initialForm={editorForm}
          initialHtml={editorHtml}
          onSave={handleSave}
          onCancel={() => setView('list')}
          saving={saving}
        />
      </Card>
    );
  }

  // ─── Starter picker view ───
  if (view === 'starter-picker') {
    return (
      <Card>
        <CardContent className="pt-6">
          <StarterPicker
            onPick={handlePickStarter}
            onCancel={() => setView('list')}
          />
        </CardContent>
      </Card>
    );
  }

  // ─── List view ───
  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Email Templates
            </CardTitle>
            <div className="flex items-center gap-2">
              {isElevated && subCompanies.length > 0 && (
                <Select
                  value={selectedAgencyId}
                  onValueChange={(v) => {
                    setSelectedAgencyId(v);
                    if (v !== 'all') setCreateAgencyId(v);
                  }}
                >
                  <SelectTrigger className="w-[180px] h-8 text-sm">
                    <SelectValue placeholder="All Agencies" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Agencies</SelectItem>
                    {subCompanies.map((sc) => (
                      <SelectItem key={sc.id} value={sc.id}>{sc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button onClick={openStarterPicker}>
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Create professional email templates with the visual editor, HTML editor, and live preview.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <LayoutTemplate className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No email templates yet</p>
              <p className="text-sm mt-1">Choose from professional starter templates to get started</p>
              <Button className="mt-4" onClick={openStarterPicker}>
                <Plus className="h-4 w-4 mr-2" />
                Choose a Template
              </Button>
            </div>
          ) : (
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {templates.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between rounded-lg border bg-card p-4 hover:bg-accent/30 transition-colors cursor-pointer"
                    onClick={() => openEdit(t)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{t.name}</p>
                        {isElevated && !t.subCompanyId && (
                          <Badge variant="outline" className="text-[10px] shrink-0 border-blue-400 text-blue-500">All Agencies</Badge>
                        )}
                        {isElevated && t.subCompanyId && agencyNameById[t.subCompanyId] && (
                          <Badge variant="outline" className="text-[10px] shrink-0">{agencyNameById[t.subCompanyId]}</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">{t.subject}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); openEdit(t); }}
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleteId(t.id); }}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(deleteId)} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The template will no longer appear in the compose dialog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && handleDelete(deleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
