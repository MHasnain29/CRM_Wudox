# Secrets at rest and in API responses

## Encryption key

`GOOGLE_TOKEN_ENCRYPTION_KEY` — 64-char hex (32 bytes). Generate with `openssl rand -hex 32`.

- **Required in production** (app will not start without it).
- Used for AES-256-GCM of:
  - Agency Google Calendar refresh tokens (`SubCompany.googleRefreshToken`)
  - Twilio Auth Token / API Key Secret (`PhoneAgencyConfig.twilioAuthTokenEnc`, `twilioApiKeySecretEnc`)
- Stored format: `enc:<iv>:<tag>:<ciphertext>` (hex).
- Encrypt helpers **throw** if the key is missing (no plaintext writes).
- Decrypt still accepts legacy plaintext until migrated: `npm run scripts:encrypt-secrets`.

## Public agency DTO

Agency list/create/update and auth `/me` / login use `safeSubCompanyForClient` ([`src/utils/safeSubCompany.ts`](../src/utils/safeSubCompany.ts)).

**Never returned:** `googleRefreshToken`, `emailSignatureTemplate`, Twilio enc fields.

**Returned:** branding, email From/inbound config, `googleCalendarConnected`, `googleConnectedEmail` (status only).

## Phone system

Twilio Auth Token / API Key Secret: write-only on save; responses expose `hasAuthToken` / `hasApiKeySecret` and SIDs only. See [PHONE_SYSTEM.md](./PHONE_SYSTEM.md).
