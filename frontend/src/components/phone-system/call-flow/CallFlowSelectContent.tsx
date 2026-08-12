import type { ComponentProps } from 'react';
import { SelectContent } from '@/components/ui/select';
import { callFlowPopoverClass } from './callFlowFullscreen';

type CallFlowSelectContentProps = ComponentProps<typeof SelectContent> & {
  isFullscreen?: boolean;
};

export function CallFlowSelectContent({
  isFullscreen = false,
  className,
  ...props
}: CallFlowSelectContentProps) {
  return (
    <SelectContent className={callFlowPopoverClass(isFullscreen, className)} {...props} />
  );
}
