/**
 * Opens Active Client details sheet from an assignment / employee list row.
 */
import { useState, type MouseEvent } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ActiveClientDetailsSheet } from '@/components/recruitment/active-clients/ActiveClientDetailsSheet';
import { fetchActiveClient, type ApiActiveClient } from '@/lib/activeClientsApi';

type Props = {
  clientId: string;
  clientName?: string | null;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  /** Optional label; defaults to client name or "View client". */
  label?: string;
};

export function ViewActiveClientButton({
  clientId,
  clientName,
  variant = 'outline',
  size = 'sm',
  className,
  label,
}: Props) {
  const [open, setOpen] = useState(false);
  const [client, setClient] = useState<ApiActiveClient | null>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    if (!clientId) return;
    setLoading(true);
    try {
      const detail = await fetchActiveClient(clientId);
      setClient(detail);
      setOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load client');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={loading || !clientId}
        onClick={(e) => void handleClick(e)}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
        ) : (
          <Building2 className="h-3.5 w-3.5 mr-1.5" />
        )}
        {label ?? clientName ?? 'View client'}
      </Button>
      <ActiveClientDetailsSheet
        client={client}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setClient(null);
        }}
      />
    </>
  );
}
