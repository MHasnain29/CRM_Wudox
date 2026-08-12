import type { Request, Response } from 'express';
import { getR2Stream } from './r2Storage';

export function recordingUrlToR2Key(recordingUrl: string): string {
  return recordingUrl.startsWith('http')
    ? new URL(recordingUrl).pathname.replace(/^\//, '')
    : recordingUrl;
}

export async function pipeRecordingStream(
  recordingUrl: string,
  req: Request,
  res: Response,
): Promise<void> {
  const key = recordingUrlToR2Key(recordingUrl);
  const result = await getR2Stream(key, req.headers.range);

  if (!result) {
    res.status(404).json({ error: 'Recording file not found in storage' });
    return;
  }

  res.set({
    'Content-Type': result.contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=1800',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...(result.contentLength != null && { 'Content-Length': String(result.contentLength) }),
    ...(result.contentRange && { 'Content-Range': result.contentRange }),
  });
  res.status(result.statusCode);

  req.on('close', () => result.stream.destroy());

  result.stream.on('error', (err) => {
    console.error('[recording stream] R2 stream error:', err);
    if (!res.headersSent) res.status(502).json({ error: 'Storage stream failed' });
    else res.end();
  });

  result.stream.pipe(res);
}
