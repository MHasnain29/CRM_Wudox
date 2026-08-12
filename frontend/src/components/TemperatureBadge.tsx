import { Badge } from '@/components/ui/badge';
import { Flame, Droplet, Snowflake } from 'lucide-react';
import { Temperature } from '@/lib/types';

interface TemperatureBadgeProps {
  temperature?: Temperature | string | null;
}

const config = {
  hot: {
    label: 'Hot',
    variant: 'destructive' as const,
    icon: Flame,
    className: 'bg-red-500 hover:bg-red-600 text-white',
  },
  warm: {
    label: 'Warm',
    variant: 'default' as const,
    icon: Droplet,
    className: 'bg-orange-500 hover:bg-orange-600 text-white',
  },
  cold: {
    label: 'Cold',
    variant: 'secondary' as const,
    icon: Snowflake,
    className: 'bg-blue-500 hover:bg-blue-600 text-white',
  },
} as const;

export function TemperatureBadge({ temperature }: TemperatureBadgeProps) {
  const key =
    temperature === 'hot' || temperature === 'warm' || temperature === 'cold'
      ? temperature
      : 'warm';
  const { label, icon: Icon, className } = config[key];

  return (
    <Badge className={className}>
      <Icon className="h-3 w-3 mr-1" />
      {label}
    </Badge>
  );
}
