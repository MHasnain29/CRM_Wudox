import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type AgreementChipKind = 'both' | 'temp' | 'direct';

type ProposalLike = {
  agreementTypes: string[];
  pair?: { members?: unknown[] } | null;
  proposalPairId?: string | null;
};

const CHIP: Record<AgreementChipKind, { label: string; className: string }> = {
  both: {
    label: 'Both',
    className: 'border-violet-200/80 bg-violet-50 text-violet-800 hover:bg-violet-50',
  },
  temp: {
    label: 'Temp',
    className: 'border-sky-200/80 bg-sky-50 text-sky-800 hover:bg-sky-50',
  },
  direct: {
    label: 'Direct',
    className: 'border-amber-200/80 bg-amber-50 text-amber-900 hover:bg-amber-50',
  },
};

/** Resolve list-chip kind — Both pairs collapse to one "Both" chip. */
export function resolveAgreementChipKind(p: ProposalLike): AgreementChipKind {
  if (p.pair?.members && Array.isArray(p.pair.members) && p.pair.members.length > 1) {
    return 'both';
  }
  if (p.proposalPairId) return 'both';

  const types = p.agreementTypes ?? [];
  const hasTemp = types.includes('temp');
  const hasDirect = types.some((t) => t.startsWith('direct'));
  if (hasTemp && hasDirect) return 'both';
  if (hasDirect) return 'direct';
  return 'temp';
}

/** Compact modern agreement-type chip for proposal tables. */
export function AgreementTypeChips({
  proposal,
  className,
}: {
  proposal: ProposalLike;
  className?: string;
}) {
  const kind = resolveAgreementChipKind(proposal);
  const { label, className: colors } = CHIP[kind];

  return (
    <Badge
      variant="outline"
      className={cn(
        'h-6 rounded-md px-2 text-[11px] font-medium tracking-wide shadow-none',
        colors,
        className,
      )}
      title={
        kind === 'both'
          ? 'Temp + Direct Placement'
          : kind === 'temp'
            ? 'Temp / Temp to Permanent'
            : 'Direct Placement'
      }
    >
      {label}
    </Badge>
  );
}
