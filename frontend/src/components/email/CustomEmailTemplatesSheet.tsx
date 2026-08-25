/**
 * Large centered modal: manage personal email template copies.
 * HTML paste + live preview of the exact email the client receives.
 *
 * Delete confirm is in-dialog (not nested AlertDialog) to avoid Radix
 * body pointer-events lock that freezes the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, LayoutTemplate, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CustomTemplateBodyEditor,
  type CustomTemplateBodyEditorHandle,
} from '@/components/email/CustomTemplateBodyEditor';
import {
  customizeEmailTemplate,
  deleteEmailTemplate,
  fetchEmailTemplates,
  updateEmailTemplate,
  type ApiEmailTemplate,
} from '@/lib/api';
import { emailTemplateFillFields } from '@/lib/emailStarterTemplates';
import { recoverPastedEmailHtml } from '@/lib/recoverPastedEmailHtml';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { SectionPaginationBar, useClientPagination } from '@/components/SectionPagination';

const LIST_PAGE_SIZE = 10;

type Mode = 'list' | 'pick-shared' | 'edit';

interface CustomEmailTemplatesSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function resetUiState(
  setMode: (m: Mode) => void,
  setEditing: (t: ApiEmailTemplate | null) => void,
  setDeleteId: (id: string | null) => void,
  setForm: (f: { name: string; subject: string; bodyHtml: string }) => void,
) {
  setMode('list');
  setEditing(null);
  setDeleteId(null);
  setForm({ name: '', subject: '', bodyHtml: '' });
}

export function CustomEmailTemplatesSheet({ open, onOpenChange }: CustomEmailTemplatesSheetProps) {
  const [mode, setMode] = useState<Mode>('list');
  const [mine, setMine] = useState<ApiEmailTemplate[]>([]);
  const [shared, setShared] = useState<ApiEmailTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState<ApiEmailTemplate | null>(null);
  const [form, setForm] = useState({ name: '', subject: '', bodyHtml: '' });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const editorRef = useRef<CustomTemplateBodyEditorHandle>(null);
  const agencyFooterText = useStore((s) => {
    const sub = s.currentSubCompany;
    return [sub?.emailFooterText?.trim(), sub?.emailTagline?.trim()].filter(Boolean).join(' · ') || null;
  });
  const agencyName = useStore((s) => s.currentSubCompany?.name?.trim() || null);

  const minePage = useClientPagination(mine, [mine.length, open], LIST_PAGE_SIZE);
  const sharedPage = useClientPagination(shared, [shared.length, mode], LIST_PAGE_SIZE);

  const loadMine = useCallback(async () => {
    setLoading(true);
    try {
      setMine(await fetchEmailTemplates({ scope: 'mine' }));
    } catch {
      toast.error('Failed to load your templates');
      setMine([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      resetUiState(setMode, setEditing, setDeleteId, setForm);
      setSaving(false);
      setDeleting(false);
      // Clear any leftover Radix body lock from prior nested dialogs
      document.body.style.pointerEvents = '';
      return;
    }
    document.body.style.pointerEvents = '';
    setMode('list');
    setEditing(null);
    setDeleteId(null);
    loadMine();
  }, [open, loadMine]);

  const handleOpenChange = (next: boolean) => {
    if (deleting || saving) return;
    onOpenChange(next);
  };

  const goList = () => {
    setMode('list');
    setEditing(null);
    setDeleteId(null);
  };

  const startEdit = (t: ApiEmailTemplate) => {
    setDeleteId(null);
    setEditing(t);
    setForm({
      name: t.name,
      subject: t.subject,
      bodyHtml: recoverPastedEmailHtml(t.bodyHtml),
    });
    setMode('edit');
  };

  const openPickShared = async () => {
    setDeleteId(null);
    setLoading(true);
    setMode('pick-shared');
    try {
      setShared(await fetchEmailTemplates({ scope: 'shared' }));
    } catch {
      toast.error('Failed to load shared templates');
      setShared([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCustomize = async (source: ApiEmailTemplate) => {
    if (saving) return;
    setSaving(true);
    try {
      const copy = await customizeEmailTemplate(source.id);
      toast.success('Saved as your copy — edit it below');
      startEdit(copy);
      await loadMine();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to customize');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!editing || saving) return;
    if (!form.name.trim() || !form.subject.trim() || !form.bodyHtml.trim()) {
      toast.error('Name, subject and message are required');
      return;
    }
    setSaving(true);
    try {
      const bodyHtml = (editorRef.current?.getHtml() ?? form.bodyHtml).trim();
      const updated = await updateEmailTemplate(editing.id, {
        name: form.name.trim(),
        subject: form.subject.trim(),
        bodyHtml,
      });
      setMine((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
      setEditing(updated);
      toast.success('Template updated');
      setMode('list');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteEmailTemplate(id);
      setMine((prev) => prev.filter((t) => t.id !== id));
      setDeleteId(null);
      if (editing?.id === id) {
        setEditing(null);
        setForm({ name: '', subject: '', bodyHtml: '' });
        setMode('list');
      }
      toast.success('Template deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete');
    } finally {
      setDeleting(false);
    }
  };

  const fieldLabel = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
  const isEdit = mode === 'edit' && !!editing;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="w-full max-w-[min(1080px,94vw)] h-[min(780px,92vh)] !flex !flex-col gap-0 p-0 overflow-hidden sm:rounded-xl border-border/80 shadow-2xl">
        <DialogHeader className="px-6 py-4 border-b border-border/70 bg-muted/25 shrink-0 text-left pr-12 space-y-0">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-background shadow-sm">
                <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold tracking-tight">
                  Custom Templates
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {mode === 'pick-shared'
                    ? 'Pick a company template to copy for yourself'
                    : isEdit
                      ? 'Paste HTML and preview the email the client will receive'
                      : 'Your copies only. Company templates stay unchanged.'}
                </DialogDescription>
              </div>
            </div>
            {mode === 'list' && !loading && (
              <Button
                size="sm"
                className="h-8 shrink-0 shadow-sm mr-6"
                onClick={openPickShared}
                disabled={saving || deleting}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                From library
              </Button>
            )}
          </div>
        </DialogHeader>

        {mode === 'pick-shared' && (
          <div className="px-6 py-2 border-b border-border/60 flex items-center gap-2 shrink-0 bg-background">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-muted-foreground hover:text-foreground -ml-2"
              disabled={deleting || saving}
              onClick={goList}
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Back to my templates
            </Button>
          </div>
        )}

        <div className="flex-1 min-h-0 flex flex-col bg-muted/10">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : isEdit ? (
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-0 items-stretch">
              {/* Left panel */}
              <aside className="flex flex-col gap-4 min-h-0 order-2 lg:order-1 border-r border-border/60 bg-background/80 px-5 py-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-fit -ml-2 shrink-0 text-muted-foreground hover:text-foreground"
                  disabled={deleting || saving}
                  onClick={goList}
                >
                  <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                  Back
                </Button>

                <div className="space-y-3 shrink-0">
                  <div className="space-y-1.5">
                    <Label className={fieldLabel}>Name</Label>
                    <Input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="h-9 bg-background shadow-sm"
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className={fieldLabel}>Subject</Label>
                    <Input
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      className="h-9 bg-background shadow-sm"
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-border/70 bg-muted/30 p-3 space-y-2 flex-1 min-h-0 overflow-y-auto">
                  <div>
                    <p className={cn(fieldLabel, 'normal-case tracking-normal text-foreground/80')}>
                      Insert field
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                      Click to insert into the HTML at your cursor.
                    </p>
                  </div>
                  <div className="flex flex-col gap-1 pt-0.5">
                    {emailTemplateFillFields.map((field) => (
                      <button
                        key={field.key}
                        type="button"
                        title={field.hint}
                        className="w-full text-left rounded-lg border border-transparent bg-background/90 px-3 py-2 shadow-sm ring-1 ring-border/50 hover:ring-border hover:bg-accent/50 transition-all"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          editorRef.current?.insertField(field.key);
                        }}
                      >
                        <span className="block text-sm font-medium text-foreground/90">{field.label}</span>
                        <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
                          {field.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 pt-0.5">
                  <Button className="flex-1 shadow-sm" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                    Save
                  </Button>
                  <Button variant="outline" className="shadow-sm" onClick={goList} disabled={saving}>
                    Cancel
                  </Button>
                </div>
              </aside>

              {/* Right: HTML paste + visual preview */}
              <div className="min-w-0 min-h-0 flex flex-col gap-2 order-1 lg:order-2 px-5 py-4 bg-muted/20">
                <Label className={cn(fieldLabel, 'shrink-0')}>Message</Label>
                <CustomTemplateBodyEditor
                  key={editing.id}
                  ref={editorRef}
                  value={form.bodyHtml}
                  onChange={(html) => setForm((f) => ({ ...f, bodyHtml: html }))}
                  agencyFooterText={agencyFooterText}
                  agencyName={agencyName}
                  disabled={saving}
                  className="flex-1"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-6 py-5">
                  {mode === 'pick-shared' ? (
                    shared.length === 0 ? (
                      <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border/70 bg-background shadow-sm">
                          <LayoutTemplate className="h-5 w-5 text-muted-foreground/70" />
                        </div>
                        <p className="text-sm font-medium text-foreground/80">No shared templates</p>
                        <p className="text-xs text-muted-foreground mt-1">Ask an admin to add company templates first</p>
                      </div>
                    ) : (
                      <>
                        <div className="mb-3 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            {shared.length} company template{shared.length === 1 ? '' : 's'}
                          </p>
                          <p className="text-[11px] text-muted-foreground/80">Click to create your copy</p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {sharedPage.pageRows.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              disabled={saving}
                              onClick={() => void handleCustomize(t)}
                              className="group flex w-full items-start gap-3 text-left rounded-xl border border-border/70 bg-background p-4 shadow-sm hover:border-border hover:shadow-md hover:bg-accent/20 transition-all disabled:opacity-50"
                            >
                              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-muted">
                                <FileText className="h-4 w-4" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium truncate text-foreground/90 group-hover:text-foreground">
                                  {t.name}
                                </p>
                                <p className="text-xs text-muted-foreground truncate mt-1 leading-relaxed">
                                  {t.subject}
                                </p>
                                <p className="text-[11px] text-muted-foreground/80 mt-2 font-medium">
                                  Create my copy →
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )
                  ) : mine.length === 0 ? (
                    <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
                      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background shadow-sm">
                        <LayoutTemplate className="h-6 w-6 text-muted-foreground/60" />
                      </div>
                      <p className="text-sm font-medium text-foreground/85">No custom templates yet</p>
                      <p className="text-xs text-muted-foreground mt-1.5 max-w-xs">
                        Customize a company template to create your own editable copy
                      </p>
                      <Button
                        size="sm"
                        className="mt-5 h-8 shadow-sm"
                        onClick={openPickShared}
                        disabled={saving || deleting}
                      >
                        <Plus className="h-3.5 w-3.5 mr-1.5" />
                        Customize from library
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 flex items-baseline justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">
                          {mine.length} personal template{mine.length === 1 ? '' : 's'}
                        </p>
                        <p className="text-[11px] text-muted-foreground/80">Click a card to edit</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {minePage.pageRows.map((t) => (
                          <div
                            key={t.id}
                            className={cn(
                              'group relative flex items-start gap-3 rounded-xl border border-border/70 bg-background p-4 shadow-sm transition-all',
                              deleteId === t.id
                                ? 'border-destructive/35 bg-destructive/[0.04]'
                                : 'hover:border-border hover:shadow-md',
                            )}
                          >
                            {deleteId === t.id ? (
                              <div className="flex w-full items-center gap-2 py-0.5">
                                <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                                  Delete this copy?
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 shrink-0"
                                  disabled={deleting}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteId(null);
                                  }}
                                >
                                  No
                                </Button>
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 shrink-0 shadow-sm"
                                  disabled={deleting}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleDelete(t.id);
                                  }}
                                >
                                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Yes'}
                                </Button>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                  onClick={() => {
                                    setDeleteId(null);
                                    startEdit(t);
                                  }}
                                  disabled={deleting}
                                >
                                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground group-hover:bg-muted transition-colors">
                                    <FileText className="h-4 w-4" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate text-foreground/90">
                                      {t.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground truncate mt-1 leading-relaxed">
                                      {t.subject}
                                    </p>
                                  </div>
                                </button>
                                <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                                    disabled={deleting}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteId(null);
                                      startEdit(t);
                                    }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                    disabled={deleting}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeleteId(t.id);
                                    }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </ScrollArea>

              {mode === 'pick-shared' && sharedPage.showPagination && (
                <div className="shrink-0 px-6 pb-4 bg-background border-t border-border/60">
                  <SectionPaginationBar
                    total={sharedPage.total}
                    startIndex={sharedPage.startIndex}
                    pageLen={sharedPage.pageRows.length}
                    totalPages={sharedPage.totalPages}
                    page={sharedPage.page}
                    onPageChange={sharedPage.setPage}
                    pageSize={LIST_PAGE_SIZE}
                    className="border-t-0 mt-0 pt-3"
                  />
                </div>
              )}
              {mode === 'list' && minePage.showPagination && (
                <div className="shrink-0 px-6 pb-4 bg-background border-t border-border/60">
                  <SectionPaginationBar
                    total={minePage.total}
                    startIndex={minePage.startIndex}
                    pageLen={minePage.pageRows.length}
                    totalPages={minePage.totalPages}
                    page={minePage.page}
                    onPageChange={minePage.setPage}
                    pageSize={LIST_PAGE_SIZE}
                    className="border-t-0 mt-0 pt-3"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
