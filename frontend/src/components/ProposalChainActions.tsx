import { useState, useEffect } from 'react';
import { approveForReview, approveProposal, fetchSigningAuthorities, type SigningAuthority } from '@/lib/api';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

type ProposalLike = {
  id: string;
  isForReview?: boolean;
  lead: { subCompanyId: string };
};

type Props = {
  proposal: ProposalLike;
  subCompanyId?: string;
  onComplete: () => void;
  compact?: boolean;
  onView?: () => void;
  makeActiveSlot?: React.ReactNode;
};

export function ProposalChainActions({ proposal, subCompanyId, onComplete, compact, onView, makeActiveSlot }: Props) {
  const agencyId = subCompanyId ?? proposal.lead.subCompanyId;
  const isFinalSend = !proposal.isForReview;

  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [signChoice, setSignChoice] = useState<'unsigned' | 'signed'>('unsigned');
  const [authorities, setAuthorities] = useState<SigningAuthority[]>([]);
  const [selectedAuthorityId, setSelectedAuthorityId] = useState<string | null>(null);
  const [loadingAuthorities, setLoadingAuthorities] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isFinalSend || signChoice !== 'signed' || !approveDialogOpen) return;
    setLoadingAuthorities(true);
    fetchSigningAuthorities(agencyId)
      .then((list) => {
        setAuthorities(list);
        const primary = list.find((a) => a.isPrimary) ?? list[0] ?? null;
        setSelectedAuthorityId(primary?.id ?? null);
      })
      .catch(() => setAuthorities([]))
      .finally(() => setLoadingAuthorities(false));
  }, [signChoice, agencyId, isFinalSend, approveDialogOpen]);

  const openApproveDialog = () => {
    setSignChoice('unsigned');
    setAuthorities([]);
    setSelectedAuthorityId(null);
    setApproveDialogOpen(true);
  };

  const runForReviewApprove = async () => {
    await approveForReview(proposal.id);
  };

  const handleApproveConfirm = async () => {
    if (signChoice === 'signed' && (loadingAuthorities || authorities.length === 0 || !selectedAuthorityId)) {
      return;
    }
    setSubmitting(true);
    try {
      await approveProposal(proposal.id, {
        signed: signChoice === 'signed',
        signingAuthorityId: signChoice === 'signed' ? selectedAuthorityId ?? undefined : undefined,
      });
      setApproveDialogOpen(false);
      onComplete();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to approve proposal');
    } finally {
      setSubmitting(false);
    }
  };

  const signedBlocked = signChoice === 'signed' && (loadingAuthorities || authorities.length === 0 || !selectedAuthorityId);

  return (
    <>
      <ApprovalQueueActions
        workflow="proposal_review"
        entityId={proposal.id}
        subCompanyId={agencyId}
        compact={compact}
        customApprove={proposal.isForReview ? runForReviewApprove : undefined}
        onApproveClick={isFinalSend ? openApproveDialog : undefined}
        finalApproveLabel={proposal.isForReview ? 'Send review email' : 'Final approve'}
        onActionComplete={onComplete}
        onView={onView}
        afterViewSlot={makeActiveSlot}
      />

      {isFinalSend && (
        <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Send to client</DialogTitle>
              <DialogDescription>
                Choose how this proposal should be sent to the client.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <RadioGroup
                value={signChoice}
                onValueChange={(value) => setSignChoice(value as 'unsigned' | 'signed')}
              >
                <div className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value="unsigned" id={`${proposal.id}-unsigned`} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <Label htmlFor={`${proposal.id}-unsigned`} className="font-medium cursor-pointer">
                      Unsigned
                    </Label>
                    <p className="text-xs text-muted-foreground">Client signs the agreement first.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
                  <RadioGroupItem value="signed" id={`${proposal.id}-signed`} className="mt-0.5" />
                  <div className="space-y-0.5">
                    <Label htmlFor={`${proposal.id}-signed`} className="font-medium cursor-pointer">
                      Signed
                    </Label>
                    <p className="text-xs text-muted-foreground">Include your agency signature on the document.</p>
                  </div>
                </div>
              </RadioGroup>

              {signChoice === 'signed' && (
                <div className="space-y-2">
                  <Label>Signing authority</Label>
                  {loadingAuthorities ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading authorities…
                    </div>
                  ) : authorities.length === 0 ? (
                    <p className="text-sm text-destructive">
                      No signing authorities set up — add one in Settings → Agencies.
                    </p>
                  ) : (
                    <Select
                      value={selectedAuthorityId ?? ''}
                      onValueChange={setSelectedAuthorityId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select signing authority" />
                      </SelectTrigger>
                      <SelectContent>
                        {authorities.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}{a.isPrimary ? ' ★' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleApproveConfirm} disabled={submitting || signedBlocked}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Send
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
