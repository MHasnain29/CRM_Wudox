import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye } from 'lucide-react';
import { format } from 'date-fns';

type Contact = { name: string; email?: string | null } | null | undefined;
type Reviewer = { firstName?: string | null; lastName?: string | null } | null | undefined;
type Owner = { firstName?: string | null; lastName?: string | null };

type Props = {
  owner: Owner;
  agreementLabels: string[];
  paymentTermsLabel: string;
  submittedAt: string | Date;
  contact: Contact;
  reviewedBy?: Reviewer;
  reviewedAt?: string | Date | null;
  readyToActivate: boolean;
  onEmailPreview?: () => void;
};

function personName(p?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!p) return '—';
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || '—';
}

/** Compact CRM key/value summary for awaiting-client proposal detail. */
export function AwaitingClientSummary({
  owner,
  agreementLabels,
  paymentTermsLabel,
  submittedAt,
  contact,
  reviewedBy,
  reviewedAt,
  readyToActivate,
  onEmailPreview,
}: Props) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: 'Status',
      value: (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className={readyToActivate ? 'bg-emerald-50 text-emerald-800 hover:bg-emerald-50' : 'bg-amber-50 text-amber-900 hover:bg-amber-50'}>
            {readyToActivate ? 'Ready to activate' : 'Awaiting client'}
          </Badge>
          <span className="text-xs font-normal text-muted-foreground">
            Approved by {personName(reviewedBy)}
            {reviewedAt ? ` · ${format(new Date(reviewedAt), 'MMM d, yyyy')}` : ''}
          </span>
        </div>
      ),
    },
    { label: 'Owner', value: <span className="font-medium">{personName(owner)}</span> },
    { label: 'Agreements', value: <span className="font-medium">{agreementLabels.join(' · ') || '—'}</span> },
    { label: 'Payment terms', value: <span className="font-medium">{paymentTermsLabel}</span> },
    { label: 'Submitted', value: <span className="font-medium">{format(new Date(submittedAt), 'MMM d, yyyy')}</span> },
    {
      label: 'Sent to',
      value: contact ? (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
          <span>
            {contact.name}
            {contact.email ? (
              <span className="text-muted-foreground font-normal"> · {contact.email}</span>
            ) : null}
          </span>
          {onEmailPreview && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs font-normal"
              onClick={onEmailPreview}
            >
              <Eye className="h-3 w-3 mr-1" />
              Email preview
            </Button>
          )}
        </span>
      ) : (
        <span className="text-muted-foreground italic font-normal">No contact</span>
      ),
    },
  ];

  return (
    <dl className="rounded-md border divide-y text-sm">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground pt-0.5">{row.label}</dt>
          <dd className="min-w-0 text-foreground/90">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
