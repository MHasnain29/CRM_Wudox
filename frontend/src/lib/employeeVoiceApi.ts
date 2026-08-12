import { apiFetch } from '@/lib/api';

/** Place outbound call linked to an Employee. Returns callId for connectOutboundCall. */
export async function placeEmployeeOutboundCall(payload: {
  to: string;
  employeeId: string;
  subCompanyId?: string;
}): Promise<{ callId: string; message?: string }> {
  const res = await apiFetch<{ callId: string; message?: string }>('/voice/call/employee', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(res.error || 'Failed to place call');
  }
  return res.data;
}
