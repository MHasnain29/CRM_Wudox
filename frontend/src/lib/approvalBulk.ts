import { postApprovalAction, type ApprovalWorkflowType } from '@/lib/api';

/** Run the same chain action across multiple pending entities (sequential). */
export async function bulkPostApprovalAction(
  workflow: ApprovalWorkflowType,
  items: Array<{ id: string; subCompanyId?: string | null; label?: string }>,
  action: 'forward' | 'approve' | 'reject',
): Promise<{ ok: number; failures: string[] }> {
  let ok = 0;
  const failures: string[] = [];
  for (const item of items) {
    try {
      await postApprovalAction(workflow, item.id, action, {
        subCompanyId: item.subCompanyId ?? undefined,
      });
      ok += 1;
    } catch {
      failures.push(item.label ?? item.id);
    }
  }
  return { ok, failures };
}
