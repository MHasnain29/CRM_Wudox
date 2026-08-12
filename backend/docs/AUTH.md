# Auth implementation

Aligned with **docs/SYSTEM_UNDERSTANDING.md** (§5 Auth & security).

## Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login` | Email + password → user, access token, refresh token |
| POST | `/api/v1/auth/logout` | Optional body `{ refreshToken }` → revoke refresh (204) |
| POST | `/api/v1/auth/refresh-token` | Body `{ refreshToken }` → new access + new refresh (rotation) |
| POST | `/api/v1/auth/forgot-password` | Body `{ email }` → send reset email (200 always, no enumeration) |
| POST | `/api/v1/auth/reset-password` | Body `{ token, newPassword }` → set new password (token from email) |
| GET | `/api/v1/auth/me` | Current user (requires Bearer token) |

## JWT strategy

- **Access token:** 15m TTL, payload: sub, email, role, subCompanyId.
- **Refresh token:** 7d TTL, payload: sub, type: 'refresh', jti. **Stored in Redis** under `refresh:<jti>`; revoked on logout or after use (rotation).
- **Token rotation on refresh:** Old refresh is revoked; new access + new refresh issued.

## Password

- bcrypt, 12 salt rounds.
- **Complexity:** Min 8 chars, at least one letter and one number (enforced on reset-password; optional on future signup).

## Forgot / reset password

- **forgot-password:** Sends email via SendGrid (if configured) with link `FRONTEND_URL/reset-password?token=...`. Token is JWT, type `password_reset`, 1h TTL. If SendGrid not set, in development the link is logged only.
- **reset-password:** Verifies token, validates new password complexity, hashes and updates user.

## Env

- JWT_SECRET, JWT_EXPIRES_IN, JWT_REFRESH_SECRET, JWT_REFRESH_EXPIRES_IN
- JWT_RESET_EXPIRES_IN (default 1h) for password reset link
- REDIS_* for refresh storage (optional; without Redis, refresh works but cannot be revoked server-side)
- SENDGRID_API_KEY, EMAIL_FROM, FRONTEND_URL for forgot-password email
