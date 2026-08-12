import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, Globe, Building2, Loader2, Plus, Pencil, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  type ClientNoteFieldDef,
  type ClientNoteFieldType,
  type ClientNoteFieldVisibility,
  createClientNoteField,
  deactivateClientNoteField,
  fetchAccessibleAgencies,
  fetchClientNoteFields,
  updateClientNoteField,
} from '@/lib/api';

const FIELD_TYPE_OPTIONS: { value: ClientNoteFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Yes / No' },
  { value: 'select', label: 'Dropdown' },
];

function labelForType(t: ClientNoteFieldType): string {
  return FIELD_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
}

/** Make sure the generated key doesn't collide with an existing field in the same scope. */
function uniqueKey(base: string, existing: ClientNoteFieldDef[], scopeAgencyId: string | null): string {
  if (!base) return base;
  const keys = new Set(
    existing
      .filter((f) => (scopeAgencyId === null ? f.subCompanyId === null : f.subCompanyId === scopeAgencyId))
      .map((f) => f.key),
  );
  if (!keys.has(base)) return base;
  let i = 2;
  while (keys.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

type AgencyOption = { id: string; name: string };

export function ClientNotesTab() {
  const [fields, setFields] = useState<ClientNoteFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fLabel, setFLabel] = useState('');
  const [fKey, setFKey] = useState('');
  const [fType, setFType] = useState<ClientNoteFieldType>('text');
  const [fOptions, setFOptions] = useState<string[]>([]);
  const [fOptionInput, setFOptionInput] = useState('');
  const [fVisibility, setFVisibility] = useState<ClientNoteFieldVisibility>('global');
  const [fAgencyId, setFAgencyId] = useState<string>('');
  const [fSortOrder, setFSortOrder] = useState<number>(0);

  const editing = useMemo(() => fields.find((f) => f.id === editingId) ?? null, [fields, editingId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, agencyList] = await Promise.all([
        fetchClientNoteFields(),
        fetchAccessibleAgencies(),
      ]);
      setFields(list);
      setAgencies(agencyList.map((a) => ({ id: a.id, name: a.name })));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load fields');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = useCallback(() => {
    setFLabel('');
    setFKey('');
    setFType('text');
    setFOptions([]);
    setFOptionInput('');
    setFVisibility('global');
    setFAgencyId('');
    setFSortOrder(0);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    setEditingId(null);
    setDialogOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((row: ClientNoteFieldDef) => {
    setEditingId(row.id);
    setFLabel(row.label);
    setFKey(row.key);
    setFType(row.fieldType);
    setFOptions(row.options ?? []);
    setFOptionInput('');
    setFVisibility(row.visibility);
    setFAgencyId(row.subCompanyId ?? '');
    setFSortOrder(row.sortOrder);
    setDialogOpen(true);
  }, []);

  const handleLabelChange = (next: string) => {
    setFLabel(next);
    if (!editingId) {
      // Auto-generate key from label, kept hidden from the UI.
      const scopeAgencyId = fVisibility === 'agency' ? (fAgencyId || null) : null;
      setFKey(uniqueKey(slugifyKey(next), fields, scopeAgencyId));
    }
  };

  const addOption = () => {
    const trimmed = fOptionInput.trim();
    if (!trimmed) return;
    if (fOptions.includes(trimmed)) {
      setFOptionInput('');
      return;
    }
    if (trimmed.length > 64) {
      toast.error('Option is too long (max 64 chars)');
      return;
    }
    setFOptions((prev) => [...prev, trimmed]);
    setFOptionInput('');
  };

  const removeOption = (opt: string) => {
    setFOptions((prev) => prev.filter((o) => o !== opt));
  };

  const validationError = useMemo(() => {
    if (!fLabel.trim()) return 'Label is required';
    if (!fKey || !/^[a-z][a-z0-9_]{0,62}$/.test(fKey)) {
      return 'Key must be lowercase snake_case (start with letter)';
    }
    if (fType === 'select' && fOptions.length === 0) {
      return 'Add at least one option for dropdown fields';
    }
    if (fVisibility === 'agency' && !fAgencyId) {
      return 'Choose an agency for agency-scoped fields';
    }
    return null;
  }, [fLabel, fKey, fType, fOptions, fVisibility, fAgencyId]);

  const handleSubmit = async () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      if (editingId && editing) {
        const updated = await updateClientNoteField(editingId, {
          label: fLabel.trim(),
          options: editing.fieldType === 'select' ? fOptions : null,
          sortOrder: fSortOrder,
          isActive: editing.isActive,
        });
        setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
        toast.success('Field updated');
      } else {
        const created = await createClientNoteField({
          key: fKey,
          label: fLabel.trim(),
          fieldType: fType,
          options: fType === 'select' ? fOptions : null,
          visibility: fVisibility,
          subCompanyId: fVisibility === 'agency' ? fAgencyId : null,
          sortOrder: fSortOrder,
        });
        setFields((prev) => [...prev, created].sort((a, b) => a.sortOrder - b.sortOrder));
        toast.success('Field created');
      }
      setDialogOpen(false);
      resetForm();
      setEditingId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save field');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (row: ClientNoteFieldDef) => {
    try {
      const updated = await updateClientNoteField(row.id, { isActive: !row.isActive });
      setFields((prev) => prev.map((f) => (f.id === updated.id ? updated : f)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deactivateClientNoteField(deleteId);
      setFields((prev) => prev.map((f) => (f.id === deleteId ? { ...f, isActive: false } : f)));
      toast.success('Field deactivated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to deactivate');
    } finally {
      setDeleteId(null);
    }
  };

  const deletingRow = useMemo(() => fields.find((f) => f.id === deleteId) ?? null, [fields, deleteId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Client Notes
          </h2>
          <p className="text-sm text-muted-foreground">
            Define custom fields that appear on a client&apos;s Field Notes panel once they&apos;re Closed Won. Choose global or restrict to one agency.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" />
          Add field
        </Button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-12 border-2 border-dashed rounded-lg">
          <ClipboardList className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No custom fields yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add a field to start collecting structured onboarding details on Closed-Won clients.
          </p>
          <Button className="mt-4" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            Add your first field
          </Button>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[34%]">Label</TableHead>
                  <TableHead className="w-[16%]">Type</TableHead>
                  <TableHead className="w-[16%]">Visibility</TableHead>
                  <TableHead className="w-[20%]">Agency</TableHead>
                  <TableHead className="w-[8%] text-right">Order</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((row) => (
                  <TableRow key={row.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{row.label}</span>
                        {!row.isActive && (
                          <Badge variant="outline" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{labelForType(row.fieldType)}</Badge>
                    </TableCell>
                    <TableCell>
                      {row.visibility === 'global' ? (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Globe className="h-3 w-3" />
                          Global
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Building2 className="h-3 w-3" />
                          Agency
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{row.subCompanyName ?? '—'}</span>
                    </TableCell>
                    <TableCell className="text-right text-sm">{row.sortOrder}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                        {row.isActive ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              aria-label="Edit field"
                              onClick={() => openEdit(row)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-muted-foreground"
                              aria-label="Deactivate field"
                              onClick={() => setDeleteId(row.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={() => toggleActive(row)}
                          >
                            Reactivate
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit field' : 'Add custom field'}</DialogTitle>
            <DialogDescription>
              {editingId
                ? 'Update the field label, options, or order. Type, key, and visibility cannot be changed once created.'
                : 'Define a field that will appear under Field Notes for Closed-Won clients.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="fld-label">Label</Label>
              <Input
                id="fld-label"
                value={fLabel}
                onChange={(e) => handleLabelChange(e.target.value)}
                placeholder="Plant Tour"
                maxLength={128}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fld-type">Type</Label>
              <Select
                value={fType}
                onValueChange={(v) => setFType(v as ClientNoteFieldType)}
                disabled={!!editingId}
              >
                <SelectTrigger id="fld-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FIELD_TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {fType === 'select' && (
              <div className="space-y-2">
                <Label>Options</Label>
                <div className="flex flex-wrap gap-2">
                  {fOptions.map((opt) => (
                    <Badge key={opt} variant="secondary" className="gap-1 pr-1">
                      {opt}
                      <button
                        type="button"
                        onClick={() => removeOption(opt)}
                        className="rounded-sm hover:bg-muted-foreground/20 p-0.5"
                        aria-label={`Remove ${opt}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={fOptionInput}
                    onChange={(e) => setFOptionInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addOption();
                      }
                    }}
                    placeholder="Add option, press Enter"
                    maxLength={64}
                  />
                  <Button type="button" variant="outline" onClick={addOption}>Add</Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Visibility</Label>
              <RadioGroup
                value={fVisibility}
                onValueChange={(v) => setFVisibility(v as ClientNoteFieldVisibility)}
                className="flex gap-4"
                disabled={!!editingId}
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="vis-global" value="global" />
                  <Label htmlFor="vis-global" className="text-sm cursor-pointer">Global</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem id="vis-agency" value="agency" />
                  <Label htmlFor="vis-agency" className="text-sm cursor-pointer">Single agency</Label>
                </div>
              </RadioGroup>
            </div>

            {fVisibility === 'agency' && (
              <div className="space-y-2">
                <Label htmlFor="fld-agency">Agency</Label>
                <Select
                  value={fAgencyId}
                  onValueChange={setFAgencyId}
                  disabled={!!editingId}
                >
                  <SelectTrigger id="fld-agency">
                    <SelectValue placeholder="Choose agency" />
                  </SelectTrigger>
                  <SelectContent>
                    {agencies.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="fld-sort">Sort order</Label>
              <Input
                id="fld-sort"
                type="number"
                min={0}
                max={9999}
                value={fSortOrder}
                onChange={(e) => setFSortOrder(Number(e.target.value) || 0)}
                className="w-24"
              />
            </div>

            {validationError && (
              <p className="text-xs text-destructive">{validationError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !!validationError}>
              {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {editingId ? 'Save changes' : 'Create field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deactivate confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this field?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRow ? `"${deletingRow.label}"` : 'This field'} will be hidden from all Field Notes panels.
              Existing values are preserved and become read-only. You can reactivate the field later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
