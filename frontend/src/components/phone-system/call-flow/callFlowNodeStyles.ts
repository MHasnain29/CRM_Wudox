import type { CallFlowNodeType } from '@/lib/callFlowTypes';

export const CALL_FLOW_NODE_COLORS: Record<
  CallFlowNodeType,
  { bg: string; border: string; text: string }
> = {
  trigger_incoming: {
    bg: 'bg-emerald-100 dark:bg-emerald-950',
    border: 'border-emerald-500',
    text: 'text-emerald-900 dark:text-emerald-100',
  },
  play_message: {
    bg: 'bg-violet-100 dark:bg-violet-950',
    border: 'border-violet-500',
    text: 'text-violet-900 dark:text-violet-100',
  },
  gather_dtmf: {
    bg: 'bg-sky-100 dark:bg-sky-950',
    border: 'border-sky-500',
    text: 'text-sky-900 dark:text-sky-100',
  },
  connect_extension: {
    bg: 'bg-teal-100 dark:bg-teal-950',
    border: 'border-teal-500',
    text: 'text-teal-900 dark:text-teal-100',
  },
  connect_group: {
    bg: 'bg-teal-100 dark:bg-teal-950',
    border: 'border-teal-500',
    text: 'text-teal-900 dark:text-teal-100',
  },
  connect_queue: {
    bg: 'bg-rose-100 dark:bg-rose-950',
    border: 'border-rose-500',
    text: 'text-rose-900 dark:text-rose-100',
  },
  business_hours: {
    bg: 'bg-indigo-100 dark:bg-indigo-950',
    border: 'border-indigo-500',
    text: 'text-indigo-900 dark:text-indigo-100',
  },
  play_office_hours: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    border: 'border-amber-500',
    text: 'text-amber-900 dark:text-amber-100',
  },
  voicemail_directory: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    border: 'border-amber-500',
    text: 'text-amber-900 dark:text-amber-100',
  },
  invalid_message_loop: {
    bg: 'bg-amber-100 dark:bg-amber-950',
    border: 'border-amber-500',
    text: 'text-amber-900 dark:text-amber-100',
  },
};

export function nodeTypeLabel(type: CallFlowNodeType): string {
  switch (type) {
    case 'trigger_incoming':
      return 'Incoming call';
    case 'play_message':
      return 'Play message';
    case 'gather_dtmf':
      return 'Gather DTMF';
    case 'connect_extension':
      return 'Connect extension';
    case 'connect_group':
      return 'Connect group';
    case 'connect_queue':
      return 'Waiting queue';
    case 'business_hours':
      return 'Business hours';
    case 'play_office_hours':
      return 'Office hours';
    case 'voicemail_directory':
      return 'Voicemail directory';
    case 'invalid_message_loop':
      return 'Invalid input';
    default:
      return type;
  }
}
