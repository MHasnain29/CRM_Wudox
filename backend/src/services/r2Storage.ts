/**
 * R2 (S3-compatible) storage: upload call recordings and other files.
 * Optional: if R2 env vars are not set, uploads are no-ops and return null.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import { env } from '../config/env';

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (client !== null) return client;
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME } = env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_ENDPOINT || !R2_BUCKET_NAME) {
    return null;
  }
  client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

export function isR2Configured(): boolean {
  return getClient() !== null;
}

/** Agency-scoped object key prefix within the org-wide R2 bucket. */
export function agencyR2KeyPrefix(subCompanyId: string): string {
  return `agencies/${subCompanyId}`;
}

export function buildAgencyR2Key(subCompanyId: string, ...parts: string[]): string {
  return `${agencyR2KeyPrefix(subCompanyId)}/${parts.join('/')}`;
}

/**
 * Upload a buffer to R2. Key will be prefix/filename.
 * Returns public URL if R2_PUBLIC_URL is set, otherwise the key (or null if R2 not configured).
 */
export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  const bucket = env.R2_BUCKET_NAME!;
  try {
    await c.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
    const base = env.R2_PUBLIC_URL?.replace(/\/$/, '');
    return base ? `${base}/${key}` : key;
  } catch (err) {
    console.error('R2 upload failed:', err);
    return null;
  }
}

export interface R2StreamResult {
  stream: Readable;
  contentType: string;
  contentLength?: number;
  contentRange?: string;
  statusCode: 200 | 206;
}

/**
 * Stream an object from R2 by key. Supports HTTP Range — only requested bytes are fetched.
 * Returns null if R2 is not configured or key does not exist.
 */
export async function getR2Stream(
  key: string,
  range?: string
): Promise<R2StreamResult | null> {
  const c = getClient();
  if (!c) return null;
  const bucket = env.R2_BUCKET_NAME!;

  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ...(range ? { Range: range } : {}),
      })
    );

    if (!out.Body) return null;

    return {
      stream: out.Body as Readable,
      contentType: out.ContentType ?? 'audio/mpeg',
      contentLength: out.ContentLength ?? undefined,
      contentRange: out.ContentRange ?? undefined,
      statusCode: out.ContentRange ? 206 : 200,
    };
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
    console.error('[getR2Stream] R2 error:', err);
    return null;
  }
}

/**
 * Get object from R2 by key. Returns { body, contentType } or null if not found / R2 not configured.
 */
export async function getFromR2(key: string): Promise<{ body: Buffer; contentType?: string } | null> {
  const c = getClient();
  if (!c) return null;
  const bucket = env.R2_BUCKET_NAME!;
  try {
    const out = await c.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    const body = out.Body;
    if (!body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const contentType = out.ContentType ?? 'application/octet-stream';
    return { body: buffer, contentType };
  } catch (err) {
    console.error('R2 get failed:', err);
    return null;
  }
}

/**
 * Time-limited HTTPS URL for a private R2 object (for email img src).
 * Prefer R2_PUBLIC_URL when possible. Max practical expiry ~7 days with IAM keys.
 */
export async function getR2SignedUrl(
  key: string,
  expiresInSeconds = 60 * 60 * 24 * 7,
): Promise<string | null> {
  const c = getClient();
  if (!c || !env.R2_BUCKET_NAME) return null;
  try {
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET_NAME,
      Key: key.replace(/^\//, ''),
    });
    return await getSignedUrl(c as any, command, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.error('R2 signed URL failed:', err);
    return null;
  }
}

/** Delete an object from R2 by key. No-op if R2 is not configured. */
export async function deleteFromR2(key: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: key }));
  } catch (err) {
    console.error('R2 delete failed:', err);
  }
}
