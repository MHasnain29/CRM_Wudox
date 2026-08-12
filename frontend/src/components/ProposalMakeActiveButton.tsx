import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, Loader2 } from 'lucide-react';
import { fetchApprovalStatus } from '@/lib/api';

type Props = {
  proposalId: string;
  subCompanyId: string;
  disabled?: boolean;
  onClick: () => void;
  size?: 'sm' | 'default';
};

/** Shown only when the current user may final-approve the proposal in the approval chain. */
export function ProposalMakeActiveButton({
  proposalId,
  subCompanyId,
  disabled,
  onClick,
  size = 'sm',
}: Props) {
  const [canActivate, setCanActivate] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const status = await fetchApprovalStatus('proposal_review', proposalId, subCompanyId);
      setCanActivate(status.allowedAction === 'approve');
    } catch {
      setCanActivate(false);
    } finally {
      setLoading(false);
    }
  }, [proposalId, subCompanyId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading || !canActivate) return null;

  return (
    <Button
      size="sm"
      className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 text-xs px-2"
      onClick={onClick}
      disabled={disabled}
    >
      {disabled ? (
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
      ) : (
        <CheckCircle className="h-3 w-3 mr-1" />
      )}
      Make Active
    </Button>
  );
}
