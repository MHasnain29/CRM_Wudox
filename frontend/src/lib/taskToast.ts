/**
 * Persistent toast for task assignment notifications.
 * Uses server-rendered title/body from admin notification templates.
 */
import { toast } from 'sonner';
import type { TaskAssignedPayload } from './socket';

export function showTaskAssignedToast(payload: TaskAssignedPayload): void {
  if (!payload.title?.trim()) return;

  toast(payload.title, {
    description: payload.body?.trim() || undefined,
    duration: Infinity,
    classNames: {
      title: 'text-[18px]',
    },
    action: {
      label: 'View',
      onClick: () => {
        window.location.href = `/tasks?openTask=${payload.taskId}`;
      },
    },
  });
}
