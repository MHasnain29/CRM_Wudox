/**
 * Open/download an employee document via the authenticated download API.
 */
import { getAuthHeaders, getEmployeeDocumentDownloadUrl } from '@/lib/api';

export async function fetchEmployeeDocumentBlob(
  employeeId: string,
  docId: string,
  fileName?: string | null,
): Promise<Blob> {
  const url = getEmployeeDocumentDownloadUrl(employeeId, docId);
  const res = await fetch(url, {
    headers: getAuthHeaders() as HeadersInit,
    credentials: 'include',
  });
  if (!res.ok) {
    throw new Error('Download failed');
  }
  const type =
    res.headers.get('content-type')?.split(';')[0]?.trim() ||
    (fileName?.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  return new Blob([await res.arrayBuffer()], { type });
}

export async function openOrDownloadEmployeeDocument(
  employeeId: string,
  docId: string,
  fileName?: string | null,
): Promise<void> {
  const blob = await fetchEmployeeDocumentBlob(employeeId, docId, fileName);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName?.trim() || 'document';
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
  URL.revokeObjectURL(objectUrl);
}

/** Open an employee document (e.g. signed onboarding PDF) in a new browser tab. */
export async function previewEmployeeDocument(
  employeeId: string,
  docId: string,
  fileName?: string | null,
): Promise<void> {
  const blob = await fetchEmployeeDocumentBlob(employeeId, docId, fileName);
  const objectUrl = URL.createObjectURL(blob);
  const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
  if (!opened) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Popup blocked — allow popups to view the document');
  }
  // Revoke later so the tab can finish loading the blob URL.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}
