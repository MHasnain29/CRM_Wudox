import { formatFileSize } from './fileAttachmentUtils';

export {
  formatFileSize as formatEmailFileSize,
  isImageFile as isEmailImageMime,
  isVideoFile as isEmailVideoMime,
  isPdfFile as isEmailPdfMime,
} from './fileAttachmentUtils';

export {
  formatFileSize,
  isImageFile,
  isVideoFile,
  isPdfFile,
  isPreviewableFile,
  inferMimeFromFilename,
} from './fileAttachmentUtils';

export const EMAIL_ATTACHMENT_ACCEPT =
  'image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar';

export const MAX_EMAIL_ATTACHMENTS = 10;
export const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export type EmailAttachmentValidationResult =
  | { ok: true; files: File[] }
  | { ok: false; message: string };

export function validateEmailAttachmentSelection(
  existing: File[],
  incoming: File[],
): EmailAttachmentValidationResult {
  const combined = [...existing, ...incoming];
  if (combined.length > MAX_EMAIL_ATTACHMENTS) {
    return {
      ok: false,
      message: `You can attach up to ${MAX_EMAIL_ATTACHMENTS} files per email.`,
    };
  }

  const names = new Set<string>();
  for (const file of combined) {
    if (file.size === 0) {
      return { ok: false, message: `"${file.name}" is empty.` };
    }
    if (file.size > MAX_EMAIL_ATTACHMENT_BYTES) {
      return {
        ok: false,
        message: `"${file.name}" exceeds ${formatFileSize(MAX_EMAIL_ATTACHMENT_BYTES)}.`,
      };
    }
    const key = file.name.toLowerCase();
    if (names.has(key)) {
      return { ok: false, message: `Duplicate attachment: "${file.name}".` };
    }
    names.add(key);
  }

  return { ok: true, files: combined };
}
