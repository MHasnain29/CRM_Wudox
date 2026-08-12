import { Badge } from '@/components/ui/badge';
import { LeadStage } from '@/lib/types';
import { stageLabels, stageColors } from '@/lib/stageConfig';

interface StageBadgeProps {
  stage: LeadStage;
  className?: string;
}

export function StageBadge({ stage, className }: StageBadgeProps) {
  return (
    <Badge className={`${stageColors[stage]} ${className || ''}`}>
      {stageLabels[stage]}
    </Badge>
  );
}
