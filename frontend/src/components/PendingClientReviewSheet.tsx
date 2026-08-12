import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Building2, Users, CheckCircle, Trash2, AlertTriangle, GitBranch, Loader2, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  approvePendingImport,
  fetchClients,
  type PendingImportRecord,
} from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { useCanFinalApprovePendingClients } from '@/lib/access';

type ClientSearchResult = Awaited<ReturnType<typeof fetchClients>>['data'][number];

interface Props {
  pending: PendingImportRecord | null;
  onClose: () => void;
  onQueueChanged: () => void;
}

/** A trimmed view of an existing client used for the duplicate-match banner and branch-of picker. */
interface ClientLite {
  id: string;
  name: string;
  address?: string | null;
}

const normalizeName = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase();

const normalizeAddress = (s: string | null | undefined): string =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function PendingClientReviewSheet({ pending, onClose, onQueueChanged }: Props) {
  const { toast } = useToast();
  const isDirector = useCanFinalApprovePendingClients();
  const [exactMatch, setExactMatch] = useState<ClientLite | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);

  // Branch-of picker state — hidden behind a toggle; rarely needed.
  const [branchSearch, setBranchSearch] = useState('');
  const [branchResults, setBranchResults] = useState<ClientLite[]>([]);
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchTarget, setBranchTarget] = useState<ClientLite | null>(null);
  const [showBranchPicker, setShowBranchPicker] = useState(false);

  // Decision toggles
  const [appendToExisting, setAppendToExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset state whenever the pending row changes.
  useEffect(() => {
    setExactMatch(null);
    setBranchSearch('');
    setBranchResults([]);
    setBranchTarget(null);
    setShowBranchPicker(false);
    setAppendToExisting(false);
    setSubmitting(false);
    if (!pending) return;

    // Look for an exact-name match in the current agency scope.
    setMatchLoading(true);
    fetchClients({ search: pending.name, limit: 25, subCompanyId: pending.subCompanyId })
      .then((result) => {
        const target = normalizeName(pending.name);
        const targetAddr = normalizeAddress(pending.address);
        const candidates: ClientLite[] = ((result?.data ?? []) as ClientSearchResult[])
          .filter((c) => normalizeName(c.name) === target)
          .map((c) => ({ id: c.id, name: c.name, address: c.address }));
        // Prefer an address-match; fall back to first.
        const sameAddr = candidates.find((c) => targetAddr && normalizeAddress(c.address) === targetAddr);
        const chosen = sameAddr ?? candidates[0] ?? null;
        setExactMatch(chosen);
        if (chosen) {
          const addrMatch = !targetAddr || normalizeAddress(chosen.address) === targetAddr;
          setAppendToExisting(addrMatch);
        }
      })
      .catch(() => setExactMatch(null))
      .finally(() => setMatchLoading(false));
  }, [pending]);

  // Debounced branch-of search.
  useEffect(() => {
    const q = branchSearch.trim();
    if (q.length < 2) {
      setBranchResults([]);
      return;
    }
    setBranchLoading(true);
    const t = setTimeout(() => {
      fetchClients({ search: q, limit: 10, subCompanyId: pending?.subCompanyId })
        .then((result) => {
          const list: ClientLite[] = ((result?.data ?? []) as ClientSearchResult[])
            .map((c) => ({ id: c.id, name: c.name, address: c.address }));
          setBranchResults(list);
        })
        .catch(() => setBranchResults([]))
        .finally(() => setBranchLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [branchSearch, pending?.subCompanyId]);

  const showDifferentAddressHint = useMemo(() => {
    if (!pending || !exactMatch) return false;
    const a = normalizeAddress(pending.address);
    const b = normalizeAddress(exactMatch.address);
    return a !== '' && b !== '' && a !== b;
  }, [pending, exactMatch]);

  const handleApprove = async () => {
    if (!pending) return;
    setSubmitting(true);
    try {
      let mode: 'new' | 'append' | 'branch' = 'new';
      let targetClientId: string | undefined;

      if (branchTarget) {
        mode = 'branch';
        targetClientId = branchTarget.id;
      } else if (exactMatch && appendToExisting) {
        mode = 'append';
        targetClientId = exactMatch.id;
      }

      const result = await approvePendingImport(
        pending.id,
        { mode, targetClientId },
        { subCompanyId: pending.subCompanyId },
      );
      toast({
        title:
          mode === 'append'
            ? `Contacts added to existing ${exactMatch?.name ?? 'client'}`
            : mode === 'branch'
              ? `Created as a branch of ${branchTarget?.name ?? 'parent'}`
              : 'Client approved',
        description:
          mode === 'append'
            ? `${result.appended ?? 0} contact(s) appended.`
            : 'Client has been added to the database',
      });
      onQueueChanged();
      onClose();
    } catch (err) {
      toast({
        title: 'Failed to approve',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={!!pending} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[420px] sm:w-[560px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Review import submission</SheetTitle>
        </SheetHeader>

        {pending && (
          <div className="mt-6 space-y-6">
            {/* ─── Existing-client banner ──────────────────────────── */}
            {matchLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Checking for existing client…
              </div>
            )}

            {!matchLoading && exactMatch && !showDifferentAddressHint && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription className="flex items-start gap-2">
                  <div className="flex-1">
                    <strong>{exactMatch.name}</strong> already exists in the CRM. Add the{' '}
                    {pending.contacts?.length ?? 0} contact(s) to the existing client?
                  </div>
                  <Checkbox
                    checked={appendToExisting}
                    onCheckedChange={(v) => setAppendToExisting(v === true)}
                    aria-label="Add to existing"
                  />
                </AlertDescription>
              </Alert>
            )}

            {!matchLoading && exactMatch && showDifferentAddressHint && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  A client named <strong>{exactMatch.name}</strong> already exists at a different address. Approving
                  will create this as a <strong>new client</strong>; you can also link it as a branch below.
                </AlertDescription>
              </Alert>
            )}

            {/* ─── Company info ────────────────────────────────────── */}
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Company Information
              </h4>
              <div className="space-y-3 pl-6">
                <div>
                  <label className="text-xs text-muted-foreground">Company Name</label>
                  <p className="font-medium">{pending.name}</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">Industry</label>
                    <p>{pending.industry || '—'}</p>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Company Size</label>
                    <p>{pending.companySize || pending.employees || '—'}</p>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Location</label>
                  <p>{pending.location || '—'}</p>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Address</label>
                  <p>{pending.address || '—'}</p>
                </div>
                {pending.website && (
                  <div>
                    <label className="text-xs text-muted-foreground">Website</label>
                    <p className="break-all">{pending.website}</p>
                  </div>
                )}
                {pending.sourceId && (
                  <div>
                    <label className="text-xs text-muted-foreground">Source group ID</label>
                    <p><Badge variant="outline">{pending.sourceId}</Badge></p>
                  </div>
                )}
                {pending.tags.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground">Tags</label>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {pending.tags.map((tag, i) => (
                        <Badge key={i} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ─── Contacts ────────────────────────────────────────── */}
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Contacts ({pending.contacts?.length ?? 0})
              </h4>
              <div className="space-y-3 pl-6">
                {(!pending.contacts || pending.contacts.length === 0) && (
                  <p className="text-sm text-muted-foreground">No contacts in this row.</p>
                )}
                {pending.contacts?.map((c, i) => (
                  <div key={i} className="border rounded-md p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{c.name}</span>
                      {c.title && <span className="text-xs text-muted-foreground">{c.title}</span>}
                    </div>
                    {c.email && <div className="text-xs">{c.email}</div>}
                    {c.phone && (
                      <div className="text-xs">
                        {c.phone}
                        {c.extension ? ` ext. ${c.extension}` : ''}
                      </div>
                    )}
                    {c.linkedin && <div className="text-xs break-all">{c.linkedin}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* ─── Branch-of picker (director only, collapsed by default) ────── */}
            {isDirector && !appendToExisting && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowBranchPicker((s) => !s)}
                  className="w-full flex items-center justify-between gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <span className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4" />
                    More options
                    {branchTarget && (
                      <span className="text-xs text-foreground">· branch of {branchTarget.name}</span>
                    )}
                  </span>
                  <ChevronDown
                    className={[
                      'h-4 w-4 transition-transform',
                      showBranchPicker ? 'rotate-180' : '',
                    ].join(' ')}
                  />
                </button>
                {showBranchPicker && (
                  <div className="pl-6 space-y-2 mt-2">
                    <p className="text-xs text-muted-foreground">
                      Link this client as a branch of an existing one (e.g. Nestlé Canada → Nestlé Global).
                    </p>
                    {branchTarget ? (
                      <div className="flex items-center justify-between border rounded-md p-2 text-sm">
                        <div>
                          <div className="font-medium">{branchTarget.name}</div>
                          {branchTarget.address && (
                            <div className="text-xs text-muted-foreground">{branchTarget.address}</div>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setBranchTarget(null)}>
                          Clear
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Input
                          placeholder="Search existing clients by name…"
                          value={branchSearch}
                          onChange={(e) => setBranchSearch(e.target.value)}
                        />
                        {branchLoading && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                          </div>
                        )}
                        {!branchLoading && branchResults.length > 0 && (
                          <div className="border rounded-md max-h-40 overflow-y-auto">
                            {branchResults.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/40 border-b last:border-b-0"
                                onClick={() => {
                                  setBranchTarget(c);
                                  setBranchSearch('');
                                  setBranchResults([]);
                                }}
                              >
                                <div className="font-medium">{c.name}</div>
                                {c.address && (
                                  <div className="text-xs text-muted-foreground">{c.address}</div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ─── Actions (chain-driven: Forward / Final approve / Reject) ─── */}
            <div className="border-t pt-4 space-y-3">
              <ApprovalQueueActions
                workflow="client_import"
                entityId={pending.id}
                subCompanyId={pending.subCompanyId}
                customApprove={handleApprove}
                finalApproveLabel={
                  branchTarget
                    ? 'Approve as branch'
                    : exactMatch && appendToExisting
                      ? 'Append to existing'
                      : 'Approve as new'
                }
                onActionComplete={() => {
                  onQueueChanged();
                  onClose();
                }}
              />
              <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
                Close
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
