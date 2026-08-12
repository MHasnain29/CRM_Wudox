/**
 * Active Client training API — separate from Ontario/WHMIS EmployeeTraining.
 */
import { apiFetch, getAuthHeaders } from '@/lib/api';
import { API_PREFIX } from '@/lib/apiConfig';

export type ActiveClientTrainingAssignment = {
  id: string;
  employeeId: string;
  activeClientId: string;
  activeClientName: string;
  assignmentId: string;
  status: 'pending' | 'signed';
  templateFileName: string;
  hasSignedDocument: boolean;
  signedFileName: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  pandaDocId?: string | null;
  pandaDocStatus?: string | null;
  isPandaDoc?: boolean;
};

function errorOf(res: unknown, fallback: string): string {
  return (res as { error?: string }).error ?? fallback;
}

export async function fetchEmployeeActiveClientTrainings(
  employeeId: string,
): Promise<ActiveClientTrainingAssignment[]> {
  const res = await apiFetch<{ data: ActiveClientTrainingAssignment[] }>(
    `/employees/${encodeURIComponent(employeeId)}/active-client-trainings`,
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to load client trainings'));
  return res.data.data ?? [];
}

export async function resendActiveClientTraining(
  employeeId: string,
  trainingId: string,
): Promise<ActiveClientTrainingAssignment> {
  const res = await apiFetch<{ data: ActiveClientTrainingAssignment }>(
    `/employees/${encodeURIComponent(employeeId)}/active-client-trainings/${encodeURIComponent(trainingId)}/resend`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to resend client training'));
  return res.data.data;
}

export async function syncActiveClientTraining(
  employeeId: string,
  trainingId: string,
): Promise<ActiveClientTrainingAssignment> {
  const res = await apiFetch<{ data: ActiveClientTrainingAssignment }>(
    `/employees/${encodeURIComponent(employeeId)}/active-client-trainings/${encodeURIComponent(trainingId)}/sync`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to sync client training'));
  return res.data.data;
}

export async function uploadSignedActiveClientTraining(
  employeeId: string,
  trainingId: string,
  body: { name?: string; fileBase64: string; mimeType?: string },
): Promise<ActiveClientTrainingAssignment> {
  const res = await apiFetch<{ data: ActiveClientTrainingAssignment }>(
    `/employees/${encodeURIComponent(employeeId)}/active-client-trainings/${encodeURIComponent(trainingId)}/signed`,
    { method: 'POST', body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(errorOf(res, 'Failed to upload signed training'));
  return res.data.data;
}

/** Open file in a new browser tab. */
async function openAuthenticatedFile(url: string, fileName?: string | null): Promise<void> {
  const res = await fetch(url, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Preview failed');

  const type =
    res.headers.get('content-type')?.split(';')[0]?.trim() ||
    (fileName?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/pdf');
  const blob = new Blob([await res.arrayBuffer()], { type });
  window.open(URL.createObjectURL(blob), '_blank');
}

export async function previewActiveClientTrainingDocument(
  activeClientId: string,
  fileName?: string | null,
): Promise<void> {
  const url = `${API_PREFIX}/active-clients/${encodeURIComponent(activeClientId)}/training-document`;
  await openAuthenticatedFile(url, fileName || 'client-training.pdf');
}

export async function previewEmployeeActiveClientTrainingFile(
  employeeId: string,
  trainingId: string,
  kind: 'template' | 'signed',
  fileName?: string | null,
): Promise<void> {
  const url = `${API_PREFIX}/employees/${encodeURIComponent(employeeId)}/active-client-trainings/${encodeURIComponent(trainingId)}/${kind}/download`;
  await openAuthenticatedFile(url, fileName || `${kind}-client-training.pdf`);
}
