/** Normalize a phone string to E.164 (+digits). Returns null when too short or empty. */
export function normalizeToE164(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10) return null;

  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}

/** Validate E.164 for storage (must start with + and have 10+ digits). */
export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{9,14}$/.test(value);
}
