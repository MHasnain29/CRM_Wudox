import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle, Eye, FileSpreadsheet, Loader2, Pencil, ThumbsUp, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  PendingManualSubmissionRecord,
  PendingImportRecord,
  PendingClientEditRecord,
  PendingContactImportRecord,
} from '@/lib/api';
import { getPendingManualApprovalStatus } from '@/lib/pendingSubmissionApproval';
import { diffPendingClientEdit } from '@/lib/pendingClientEditDiff';

type SourceFilter = 'all' | 'manual' | 'import' | 'contactImport' | 'edit';
type RowKey =
  | `manual:${string}`
  | `import:${string}`
  | `contactImport:${string}`
  | `edit:${string}`;
type BulkAction = 'approve' | 'reject' | 'managerApprove';

export interface PendingQueuesPanelProps {
  pendingQueueLoading: boolean;
  pendingManualSubmissions: PendingManualSubmissionRecord[];
  onReviewManual: (s: PendingManualSubmissionRecord) => void;

  canDirectorActManual?: boolean;
  onBulkApproveManual?: (ids: string[]) => Promise<void> | void;
  onBulkRejectManual?: (ids: string[]) => Promise<void> | void;
  canManagerActManual?: boolean;
  onBulkManagerApproveManual?: (ids: string[]) => Promise<void> | void;

  pendingClientEdits?: PendingClientEditRecord[];
  onReviewEdit?: (s: PendingClientEditRecord) => void;
  canDirectorActEdit?: boolean;
  onBulkApproveEdit?: (ids: string[]) => Promise<void> | void;
  onBulkRejectEdit?: (ids: string[]) => Promise<void> | void;
  onBulkManagerApproveEdit?: (ids: string[]) => Promise<void> | void;

  pendingImports?: PendingImportRecord[];
  onReviewImport?: (s: PendingImportRecord) => void;
  canBulkActImports?: boolean;
  onBulkApproveImports?: (ids: string[]) => Promise<void> | void;
  onBulkRejectImports?: (ids: string[]) => Promise<void> | void;

  pendingContactImports?: PendingContactImportRecord[];
  onReviewContactImport?: (s: PendingContactImportRecord) => void;
  canBulkActContactImports?: boolean;
  onBulkApproveContactImports?: (ids: string[]) => Promise<void> | void;
  onBulkRejectContactImports?: (ids: string[]) => Promise<void> | void;

  showAgencyColumn?: boolean;
  agencyNameById?: (subCompanyId: string) => string | undefined;
  title?: string;
  description?: string;
  readOnly?: boolean;
  /** When false, hide manager forward actions (e.g. global database director-only route). */
  enableManagerForward?: boolean;
}

type UnifiedRow =
  | {
      key: RowKey;
      kind: 'manual';
      id: string;
      subCompanyId: string | null;
      name: string;
      industry: string | null;
      submittedAt: Date;
      submittedByLabel: string;
      record: PendingManualSubmissionRecord;
    }
  | {
      key: RowKey;
      kind: 'import';
      id: string;
      subCompanyId: string | null;
      name: string;
      industry: string | null;
      submittedAt: Date;
      submittedByLabel: string;
      contactCount: number;
      record: PendingImportRecord;
    }
  | {
      key: RowKey;
      kind: 'contactImport';
      id: string;
      subCompanyId: string | null;
      name: string;
      industry: string | null;
      submittedAt: Date;
      submittedByLabel: string;
      contactCount: number;
      record: PendingContactImportRecord;
    }
  | {
      key: RowKey;
      kind: 'edit';
      id: string;
      subCompanyId: string | null;
      name: string;
      industry: string | null;
      submittedAt: Date;
      submittedByLabel: string;
      record: PendingClientEditRecord;
    };

function personLabel(u: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return name || u.email || '—';
}

export function PendingQueuesPanel({
  pendingQueueLoading,
  pendingManualSubmissions,
  onReviewManual,
  canDirectorActManual = false,
  onBulkApproveManual,
  onBulkRejectManual,
  canManagerActManual = false,
  onBulkManagerApproveManual,
  pendingClientEdits = [],
  onReviewEdit,
  canDirectorActEdit = false,
  onBulkApproveEdit,
  onBulkRejectEdit,
  onBulkManagerApproveEdit,
  pendingImports = [],
  onReviewImport,
  canBulkActImports = false,
  onBulkApproveImports,
  onBulkRejectImports,
  pendingContactImports = [],
  onReviewContactImport,
  canBulkActContactImports = false,
  onBulkApproveContactImports,
  onBulkRejectContactImports,
  showAgencyColumn = false,
  agencyNameById,
  title = 'Pending client approvals',
  description = 'Clients added manually, edited by associates, or imported from CSV/Excel wait here until a director approves them. Managers can recommend manual submissions and edits before final approval.',
  readOnly = false,
  enableManagerForward = true,
}: PendingQueuesPanelProps) {
  const ag = showAgencyColumn && agencyNameById;

  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [selectedKeys, setSelectedKeys] = useState<Set<RowKey>>(new Set());
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null);
  const [busy, setBusy] = useState(false);

  const unifiedRows = useMemo((): UnifiedRow[] => {
    const manual: UnifiedRow[] = pendingManualSubmissions.map((r) => ({
      key: `manual:${r.id}` as RowKey,
      kind: 'manual',
      id: r.id,
      subCompanyId: r.subCompanyId,
      name: r.name,
      industry: r.industry,
      submittedAt: new Date(r.submittedAt),
      submittedByLabel: personLabel(r.submittedBy),
      record: r,
    }));
    const imports: UnifiedRow[] = pendingImports.map((r) => ({
      key: `import:${r.id}` as RowKey,
      kind: 'import',
      id: r.id,
      subCompanyId: r.subCompanyId,
      name: r.name,
      industry: r.industry,
      submittedAt: new Date(r.importedAt),
      submittedByLabel: r.importedBy ? personLabel(r.importedBy) : '—',
      contactCount: r.contacts?.length ?? 0,
      record: r,
    }));
    const contactImports: UnifiedRow[] = pendingContactImports.map((r) => ({
      key: `contactImport:${r.id}` as RowKey,
      kind: 'contactImport',
      id: r.id,
      subCompanyId: r.subCompanyId,
      name: r.targetClient?.name ?? r.matchValue,
      industry: null,
      submittedAt: new Date(r.importedAt),
      submittedByLabel: r.importedBy
        ? personLabel({
            firstName: r.importedBy.firstName ?? '',
            lastName: r.importedBy.lastName ?? '',
          })
        : '—',
      contactCount: Array.isArray(r.contacts) ? r.contacts.length : 0,
      record: r,
    }));
    const edits: UnifiedRow[] = pendingClientEdits.map((r) => ({
      key: `edit:${r.id}` as RowKey,
      kind: 'edit',
      id: r.id,
      subCompanyId: r.subCompanyId,
      name: r.name,
      industry: r.industry,
      submittedAt: new Date(r.submittedAt),
      submittedByLabel: personLabel(r.submittedBy),
      record: r,
    }));
    return [...manual, ...imports, ...contactImports, ...edits].sort(
      (a, b) => b.submittedAt.getTime() - a.submittedAt.getTime(),
    );
  }, [pendingManualSubmissions, pendingImports, pendingContactImports, pendingClientEdits]);

  const filteredRows = useMemo(() => {
    if (sourceFilter === 'all') return unifiedRows;
    return unifiedRows.filter((r) => r.kind === sourceFilter);
  }, [unifiedRows, sourceFilter]);

  const manualCount = pendingManualSubmissions.length;
  const importCount = pendingImports.length;
  const contactImportCount = pendingContactImports.length;
  const editCount = pendingClientEdits.length;
  const totalCount = manualCount + importCount + contactImportCount + editCount;
  const showSourceFilter = !pendingQueueLoading && totalCount > 0;

  useEffect(() => {
    if (sourceFilter === 'manual' && manualCount === 0) setSourceFilter('all');
    if (sourceFilter === 'import' && importCount === 0) setSourceFilter('all');
    if (sourceFilter === 'contactImport' && contactImportCount === 0) setSourceFilter('all');
    if (sourceFilter === 'edit' && editCount === 0) setSourceFilter('all');
  }, [sourceFilter, manualCount, importCount, contactImportCount, editCount]);

  useEffect(() => {
    const valid = new Set(unifiedRows.map((r) => r.key));
    setSelectedKeys((prev) => {
      let changed = false;
      const next = new Set<RowKey>();
      prev.forEach((key) => {
        if (valid.has(key)) next.add(key);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [unifiedRows]);

  const directorCanAct = !readOnly && (
    (canDirectorActManual && !!(onBulkApproveManual || onBulkRejectManual)) ||
    (canBulkActImports && !!(onBulkApproveImports || onBulkRejectImports)) ||
    (canBulkActContactImports && !!(onBulkApproveContactImports || onBulkRejectContactImports)) ||
    (canDirectorActEdit && !!(onBulkApproveEdit || onBulkRejectEdit))
  );
  const managerCanAct =
    enableManagerForward &&
    !readOnly &&
    ((canManagerActManual && !!onBulkManagerApproveManual) || !!onBulkManagerApproveEdit);
  const showCheckboxes = directorCanAct || managerCanAct;

  const selectedRows = filteredRows.filter((r) => selectedKeys.has(r.key));
  const selectedCount = selectedRows.length;
  const allFilteredSelected = filteredRows.length > 0 && selectedCount === filteredRows.length;
  const someFilteredSelected = selectedCount > 0 && !allFilteredSelected;

  const selectedManualIds = selectedRows.filter((r) => r.kind === 'manual').map((r) => r.id);
  const selectedImportIds = selectedRows.filter((r) => r.kind === 'import').map((r) => r.id);
  const selectedContactImportIds = selectedRows
    .filter((r) => r.kind === 'contactImport')
    .map((r) => r.id);
  const selectedEditIds = selectedRows.filter((r) => r.kind === 'edit').map((r) => r.id);
  const selectedManualNotYetManagerApproved = selectedRows.filter(
    (r): r is Extract<UnifiedRow, { kind: 'manual' }> =>
      r.kind === 'manual' && !(r.record.managerApprovedAt && r.record.managerApprovedById),
  );
  const selectedEditNotYetManagerApproved = selectedRows.filter(
    (r): r is Extract<UnifiedRow, { kind: 'edit' }> =>
      r.kind === 'edit' && !(r.record.managerApprovedAt && r.record.managerApprovedById),
  );

  const canDirectorApproveSelection =
    (canDirectorActManual && !!onBulkApproveManual && selectedManualIds.length > 0) ||
    (canBulkActImports && !!onBulkApproveImports && selectedImportIds.length > 0) ||
    (canBulkActContactImports &&
      !!onBulkApproveContactImports &&
      selectedContactImportIds.length > 0) ||
    (canDirectorActEdit && !!onBulkApproveEdit && selectedEditIds.length > 0);
  const canDirectorRejectSelection =
    (canDirectorActManual && !!onBulkRejectManual && selectedManualIds.length > 0) ||
    (canBulkActImports && !!onBulkRejectImports && selectedImportIds.length > 0) ||
    (canBulkActContactImports &&
      !!onBulkRejectContactImports &&
      selectedContactImportIds.length > 0) ||
    (canDirectorActEdit && !!onBulkRejectEdit && selectedEditIds.length > 0);

  const toggleRow = (key: RowKey) =>
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const toggleAllFiltered = () =>
    setSelectedKeys((prev) => {
      const filteredKeys = filteredRows.map((r) => r.key);
      const allSelected = filteredKeys.length > 0 && filteredKeys.every((k) => prev.has(k));
      if (allSelected) {
        const next = new Set(prev);
        filteredKeys.forEach((k) => next.delete(k));
        return next;
      }
      const next = new Set(prev);
      filteredKeys.forEach((k) => next.add(k));
      return next;
    });

  const processingLabel = (() => {
    if (confirmAction === 'approve') return 'Approving submissions…';
    if (confirmAction === 'reject') return 'Rejecting submissions…';
    if (confirmAction === 'managerApprove') return 'Forwarding to next approver…';
    return 'Processing…';
  })();

  const executeBulk = async (action: BulkAction) => {
    if (selectedCount === 0) return;
    setConfirmAction(action);
    setBusy(true);
    try {
      if (action === 'approve') {
        if (selectedManualIds.length > 0 && onBulkApproveManual) {
          await onBulkApproveManual(selectedManualIds);
        }
        if (selectedImportIds.length > 0 && onBulkApproveImports) {
          await onBulkApproveImports(selectedImportIds);
        }
        if (selectedContactImportIds.length > 0 && onBulkApproveContactImports) {
          await onBulkApproveContactImports(selectedContactImportIds);
        }
        if (selectedEditIds.length > 0 && onBulkApproveEdit) {
          await onBulkApproveEdit(selectedEditIds);
        }
      } else if (action === 'reject') {
        if (selectedManualIds.length > 0 && onBulkRejectManual) {
          await onBulkRejectManual(selectedManualIds);
        }
        if (selectedImportIds.length > 0 && onBulkRejectImports) {
          await onBulkRejectImports(selectedImportIds);
        }
        if (selectedContactImportIds.length > 0 && onBulkRejectContactImports) {
          await onBulkRejectContactImports(selectedContactImportIds);
        }
        if (selectedEditIds.length > 0 && onBulkRejectEdit) {
          await onBulkRejectEdit(selectedEditIds);
        }
      } else if (action === 'managerApprove') {
        const manualIds = selectedManualNotYetManagerApproved.map((r) => r.id);
        if (manualIds.length > 0 && onBulkManagerApproveManual) {
          await onBulkManagerApproveManual(manualIds);
        }
        const editIds = selectedEditNotYetManagerApproved.map((r) => r.id);
        if (editIds.length > 0 && onBulkManagerApproveEdit) {
          await onBulkManagerApproveEdit(editIds);
        }
      }
      setSelectedKeys(new Set());
    } finally {
      setBusy(false);
      setConfirmAction(null);
    }
  };

  const confirmTitle =
    confirmAction === 'reject'
      ? 'Reject selected submissions?'
      : 'Forward selected items to the next approver?';

  const confirmDescription =
    confirmAction === 'reject'
      ? 'Selected items are permanently removed from the queue. This cannot be undone.'
      : 'Moves manual submissions and edits to the next role in the approval route. Changes are not applied until final approval. Import rows are skipped. Items already forwarded are not updated.';

  return (
    <>
      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle className="text-lg">{title}</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
        </CardHeader>
        <CardContent>
          {showSourceFilter && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4 pb-4 border-b">
              <div>
                <p className="text-sm font-medium">Filter by source</p>
                <p className="text-xs text-muted-foreground">
                  Separate Add Client submissions from CSV/Excel imports
                </p>
              </div>
              <Tabs
                value={sourceFilter}
                onValueChange={(v) => {
                  if (
                    v === 'all' ||
                    v === 'manual' ||
                    v === 'import' ||
                    v === 'contactImport' ||
                    v === 'edit'
                  ) {
                    setSourceFilter(v);
                  }
                }}
              >
                <TabsList className="h-9 flex-wrap">
                  <TabsTrigger value="all" className="text-xs sm:text-sm">
                    All ({totalCount})
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="text-xs sm:text-sm" disabled={manualCount === 0}>
                    <UserPlus className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    Manual ({manualCount})
                  </TabsTrigger>
                  <TabsTrigger value="import" className="text-xs sm:text-sm" disabled={importCount === 0}>
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    Import ({importCount})
                  </TabsTrigger>
                  <TabsTrigger
                    value="contactImport"
                    className="text-xs sm:text-sm"
                    disabled={contactImportCount === 0}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    Contacts ({contactImportCount})
                  </TabsTrigger>
                  <TabsTrigger value="edit" className="text-xs sm:text-sm" disabled={editCount === 0}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                    Edits ({editCount})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
          {pendingQueueLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRows.length > 0 ? (
            <>
              {showCheckboxes && selectedCount > 0 && (
                <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 mb-3">
                  <div className="text-sm font-medium">
                    Items selected
                    <button
                      type="button"
                      className="ml-3 text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => setSelectedKeys(new Set())}
                      disabled={busy}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-end">
                    {managerCanAct && (selectedManualIds.length > 0 || selectedEditIds.length > 0) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction('managerApprove')}
                        disabled={
                          busy ||
                          (selectedManualNotYetManagerApproved.length === 0 &&
                            selectedEditNotYetManagerApproved.length === 0)
                        }
                        title={
                          selectedManualNotYetManagerApproved.length === 0 &&
                          selectedEditNotYetManagerApproved.length === 0
                            ? 'All selected rows are already manager-approved'
                            : undefined
                        }
                      >
                        <ThumbsUp className="h-4 w-4 mr-2" />
                        Forward
                      </Button>
                    )}
                    {directorCanAct && canDirectorRejectSelection && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setConfirmAction('reject')}
                        disabled={busy}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                    )}
                    {directorCanAct && canDirectorApproveSelection && (
                      <Button
                        size="sm"
                        onClick={() => void executeBulk('approve')}
                        disabled={busy}
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    {showCheckboxes && (
                      <TableHead className="w-10">
                        <Checkbox
                          checked={allFilteredSelected ? true : someFilteredSelected ? 'indeterminate' : false}
                          onCheckedChange={toggleAllFiltered}
                          aria-label="Select all visible pending clients"
                        />
                      </TableHead>
                    )}
                    {ag ? <TableHead>Agency</TableHead> : null}
                    <TableHead>Source</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Submitted by</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row) => (
                    <TableRow key={row.key} data-state={selectedKeys.has(row.key) ? 'selected' : undefined}>
                      {showCheckboxes && (
                        <TableCell>
                          <Checkbox
                            checked={selectedKeys.has(row.key)}
                            onCheckedChange={() => toggleRow(row.key)}
                            aria-label={`Select ${row.name}`}
                          />
                        </TableCell>
                      )}
                      {ag ? (
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {row.subCompanyId ? agencyNameById!(row.subCompanyId) ?? '—' : 'Global'}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {row.kind === 'manual' ? (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <UserPlus className="h-3 w-3" />
                            Manual
                          </Badge>
                        ) : row.kind === 'edit' ? (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <Pencil className="h-3 w-3" />
                            Edit
                          </Badge>
                        ) : row.kind === 'contactImport' ? (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <FileSpreadsheet className="h-3 w-3" />
                            Contacts
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 font-normal">
                            <FileSpreadsheet className="h-3 w-3" />
                            Import
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{row.name}</div>
                        {row.industry ? (
                          <div className="text-xs text-muted-foreground">{row.industry}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">{row.submittedByLabel}</TableCell>
                      <TableCell>
                        {row.kind === 'manual' || row.kind === 'edit' ? (
                          (() => {
                            if (row.kind === 'edit') {
                              const s = row.record;
                              const mgrOk = !!(s.managerApprovedAt && s.managerApprovedById);
                              const mgrName = s.managerApprovedBy
                                ? personLabel(s.managerApprovedBy)
                                : '';
                              const changeSummary = diffPendingClientEdit(s, s.client).summaryLine;
                              return (
                                <div className="space-y-1">
                                  {mgrOk ? (
                                    <>
                                      <Badge variant="secondary">Manager approved</Badge>
                                      {mgrName ? (
                                        <div className="text-xs text-muted-foreground">by {mgrName}</div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <Badge variant="outline">Awaiting review</Badge>
                                  )}
                                  <div className="text-xs text-muted-foreground max-w-[220px] truncate" title={changeSummary}>
                                    {changeSummary}
                                  </div>
                                </div>
                              );
                            }
                            const status = getPendingManualApprovalStatus(row.record);
                            return (
                              <div className="space-y-1">
                                <Badge variant="outline">{status.badge}</Badge>
                                {status.detail ? (
                                  <div className="text-xs text-muted-foreground">{status.detail}</div>
                                ) : null}
                              </div>
                            );
                          })()
                        ) : (
                          <Badge variant="secondary">{row.contactCount} contact(s)</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(row.submittedAt, 'MMM d, yyyy h:mm a')}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (row.kind === 'manual') onReviewManual(row.record);
                            else if (row.kind === 'edit') onReviewEdit?.(row.record);
                            else if (row.kind === 'contactImport') onReviewContactImport?.(row.record);
                            else onReviewImport?.(row.record);
                          }}
                          aria-label={`Review ${row.name}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          ) : totalCount === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No clients awaiting approval. Use Add Client or Import clients to submit new records.
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No {sourceFilter === 'manual' ? 'manual' : sourceFilter === 'edit' ? 'edit' : sourceFilter === 'contactImport' ? 'contact import' : 'imported'} submissions in this view.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={busy}>
        <DialogContent
          className="sm:max-w-md [&>button]:hidden"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="items-center text-center sm:text-center">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto mb-2" />
            <DialogTitle>Working on it</DialogTitle>
            <DialogDescription className="text-center">
              {processingLabel}
              <br />
              Please wait — this may take a minute for large imports. Do not close this page.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!confirmAction && !busy && confirmAction !== 'approve'}
        onOpenChange={(open) => !open && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmAction && confirmAction !== 'approve') {
                  void executeBulk(confirmAction);
                }
              }}
              className={
                confirmAction === 'reject'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : undefined
              }
            >
              {confirmAction === 'reject' ? 'Reject' : 'Mark approved'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
