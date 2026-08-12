/**
 * AES-256-GCM encryption for stored secrets (Google refresh tokens, Twilio auth tokens, etc.).
 * Uses GOOGLE_TOKEN_ENCRYPTION_KEY (64-char hex = 32 bytes).
 * Format: enc:<iv>:<tag>:<ciphertext> (all hex).
 */
import crypto from 'crypto';
import { env } from '../config/env';

const CIPHER_ALGO = 'aes-256-gcm';

export function hasEncryptionKey(): boolean {
  return Boolean(env.GOOGLE_TOKEN_ENCRYPTION_KEY);
}

export function encryptSecret(plainText: string): string {
  if (!env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY is required to store secrets. Set a 64-char hex key (openssl rand -hex 32).',
    );
  }
  const key = Buffer.from(env.GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypt stored secret. Accepts legacy plaintext (not starting with enc:) until rows are migrated. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith('enc:')) return stored;
  if (!env.GOOGLE_TOKEN_ENCRYPTION_KEY) {
    throw new Error(
      'GOOGLE_TOKEN_ENCRYPTION_KEY is required to decrypt stored secrets.',
    );
  }
  const [, ivHex, tagHex, encHex] = stored.split(':');
  const key = Buffer.from(env.GOOGLE_TOKEN_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

/** Alias for Google refresh tokens — same AES-256-GCM format as Twilio secrets. */
export const encryptToken = encryptSecret;
export const decryptToken = decryptSecret;
