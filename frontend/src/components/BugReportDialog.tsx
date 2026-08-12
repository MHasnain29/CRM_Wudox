import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { submitBugReport } from '@/lib/api';
import { Loader2 } from 'lucide-react';

interface BugReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Data URL of a captured screenshot. Optional. */
  screenshotDataUrl: string | null;
  onSubmitted?: () => void;
}

export function BugReportDialog({
  open,
  onOpenChange,
  screenshotDataUrl,
  onSubmitted,
}: BugReportDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setTitle('');
    setDescription('');
    setError(null);
  }, []);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) reset();
      onOpenChange(next);
    },
    [onOpenChange, reset]
  );

  const handleSubmit = async () => {
    const desc = description.trim();
    if (!desc) {
      setError('Please describe the bug.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      let screenshotBase64: string | undefined;
      let mimeType = 'image/png';
      if (screenshotDataUrl) {
        const match = screenshotDataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1] || 'image/png';
          screenshotBase64 = match[2];
        }
      }
      await submitBugReport({
        title: title.trim() || undefined,
        description: desc,
        screenshotBase64,
        mimeType,
        pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });
      onSubmitted?.();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            Describe what went wrong. A screenshot of the current page has been captured and will be attached.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="bug-title">Title (optional)</Label>
            <Input
              id="bug-title"
              placeholder="Short summary"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-background"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bug-description">Description *</Label>
            <Textarea
              id="bug-description"
              placeholder="What happened? Steps to reproduce..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="bg-background resize-none"
            />
          </div>
          {screenshotDataUrl && (
            <div className="grid gap-2">
              <Label>Screenshot</Label>
              <div className="rounded-md border border-border overflow-hidden max-h-40 bg-muted">
                <img
                  src={screenshotDataUrl}
                  alt="Page screenshot"
                  className="w-full h-auto object-contain max-h-40"
                />
              </div>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Submitting...
              </>
            ) : (
              'Submit report'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
