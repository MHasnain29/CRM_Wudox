import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { reportEmailSchema } from '@/lib/dailyReportCc';
import { sendDailyReportPreview, type DailyReportPayload, type ReportEmailResult } from '@/lib/dailyReportsApi';

export function ReportPreviewEmail({ snapshotId, report }: { snapshotId: string; report: DailyReportPayload }) {
  const [email, setEmail] = useState(report.recipient.email);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReportEmailResult | null>(null);
  const inFlight = useRef(false);
  const dateLabel = report.presentation?.longDate ?? report.reportDate;

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current || result) return;
    const parsed = reportEmailSchema.safeParse(email);
    if (!parsed.success) { setError('Enter one valid recipient email address.'); return; }
    inFlight.current = true;
    setSending(true);
    setError('');
    try {
      setResult(await sendDailyReportPreview(snapshotId, parsed.data));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send this report. Please try again.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };

  const statusMessage = result && (
    result.status === 'accepted' ? `Report email accepted for delivery to ${result.recipientEmail}.`
      : ['pending', 'sending'].includes(result.status) ? `Report queued for ${result.recipientEmail}. Check delivery history for updates.`
        : result.status === 'failed' ? 'The email could not be sent. You can retry it from delivery history.'
          : result.status === 'unknown' ? 'Delivery could not be confirmed. Check delivery history before retrying.'
            : 'This delivery was cancelled. Create a new preview to send an updated report.'
  );

  return (
    <Card className="mx-auto max-w-5xl border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Mail aria-hidden="true" className="h-4 w-4 text-primary" />Email this report</CardTitle>
        <CardDescription>Send the report for {dateLabel} ({report.timezone}) to any email address.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={event => void send(event)} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <Label htmlFor="preview-recipient-email">Recipient email</Label>
            <Input id="preview-recipient-email" type="email" autoComplete="email" required maxLength={254}
              placeholder="name@example.com" value={email} disabled={sending}
              aria-invalid={!!error} aria-describedby={`preview-email-help${error ? ' preview-email-error' : ''}`}
              onChange={event => { setEmail(event.target.value); setError(''); setResult(null); }} />
          </div>
          <Button type="submit" disabled={sending || !email.trim() || !!result}>
            {sending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Mail aria-hidden="true" className="h-4 w-4" />}
            {sending ? 'Sending…' : 'Send report'}
          </Button>
        </form>
        <p id="preview-email-help" className="text-xs text-muted-foreground">This one-time email sends the report shown below only to the address entered here. Your daily email settings stay the same.</p>
        {error && <p id="preview-email-error" role="alert" className="text-sm text-destructive">{error}</p>}
        {result && <div role="status" className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
          <p>{statusMessage}</p>
          <Link to="/settings?tab=daily-reports" className="font-medium text-primary underline underline-offset-4">View delivery history</Link>
        </div>}
      </CardContent>
    </Card>
  );
}
