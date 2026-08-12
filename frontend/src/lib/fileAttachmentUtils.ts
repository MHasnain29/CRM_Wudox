const IMAGE_EXTS = /\.(jpe?g|png|gif|webp|bmp|svg|ico|avif|tiff?)$/i;
const VIDEO_EXTS = /\.(mp4|webm|ogg|mov|avi|mkv|m4v)$/i;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function inferMimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', pdf: 'application/pdf',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', avi: 'video/x-msvideo',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain', csv: 'text/csv', zip: 'application/zip',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function isImageFile(mime: string | null | undefined, filename?: string): boolean {
  return (mime?.startsWith('image/') ?? false) || (filename ? IMAGE_EXTS.test(filename) : false);
}

export function isVideoFile(mime: string | null | undefined, filename?: string): boolean {
  return (mime?.startsWith('video/') ?? false) || (filename ? VIDEO_EXTS.test(filename) : false);
}

export function isPdfFile(mime: string | null | undefined, filename?: string): boolean {
  return mime === 'application/pdf' || (filename?.toLowerCase().endsWith('.pdf') ?? false);
}

export function isPreviewableFile(mime: string | null | undefined, filename?: string): boolean {
  return isImageFile(mime, filename) || isVideoFile(mime, filename) || isPdfFile(mime, filename);
}
