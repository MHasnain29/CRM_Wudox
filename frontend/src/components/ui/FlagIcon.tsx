import * as Flags from 'country-flag-icons/react/3x2';
import type { ComponentType, SVGProps } from 'react';

interface FlagIconProps {
  isoCode: string;
  className?: string;
}

export function FlagIcon({ isoCode, className }: FlagIconProps) {
  const Flag = (Flags as Record<string, ComponentType<SVGProps<SVGSVGElement>>>)[isoCode];
  if (!Flag) return null;
  return <Flag style={{ width: '1em', height: '0.75em' }} aria-hidden className={className} />;
}
