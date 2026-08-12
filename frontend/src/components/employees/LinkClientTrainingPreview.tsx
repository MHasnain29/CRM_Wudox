/**
 * Shows Active Client required training + Preview inside Link to Client & Job.
 */
import { Button } from '@/components/ui/button';
import { previewActiveClientTrainingDocument } from '@/lib/activeClientTrainingApi';
import { Eye, GraduationCap, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export type LinkClientTrainingInfo = {
  clientTraining: boolean;
  hasTrainingDocument?: boolean;
  trainingFileName?: string | null;
  trainingPandaDocTemplateId?: string | null;
  trainingPandaDocTemplateName?: string | null;
};

type Props = {
  activeClientId: string;
  clientName?: string;
  training: LinkClientTrainingInfo | null | undefined;
};

export function LinkClientTrainingPreview({ activeClientId, clientName, training }: Props) {
  const [loading, setLoading] = useState(false);
  if (!training?.clientTraining) return null;

  const handlePreview = async () => {
    if (!training.hasTrainingDocument) {
      toast.error('No training document on file for this client');
      return;
    }
    setLoading(true);
    try {
      await previewActiveClientTrainingDocument(activeClientId, training.trainingFileName);
    } catch {
      toast.error('Could not open training document');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-amber-200/80 bg-amber-50/50 px-3 py-2.5 space-y-2">
      <div className="flex items-start gap-2">
        <GraduationCap className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-medium text-foreground">
            Client training required
            {clientName ? (
              <span className="font-normal text-muted-foreground"> — {clientName}</span>
            ) : null}
          </p>
          {training.trainingPandaDocTemplateName || training.trainingFileName ? (
            <p className="text-[11px] text-muted-foreground truncate">
              Document:{' '}
              {training.trainingPandaDocTemplateName || training.trainingFileName}
            </p>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5"
        disabled={loading || !training.hasTrainingDocument}
        onClick={() => void handlePreview()}
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
        Preview
      </Button>
    </div>
  );
}
