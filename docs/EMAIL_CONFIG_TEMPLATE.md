# Email Configuration Template — NA Staffing CRM

Fill this form for **email setup only**. One copy per environment (production / staging).  
Use a **separate sheet per agency** in section 3 if agencies use different domains.

**Environment:** Production / Staging  
**Completed by:** _________________  
**Date:** _________________

---

## 1. SendGrid account (org-wide)

| Field | Fill in |
|-------|---------|
| SendGrid account email / login | |
| API Key (production) | *(share securely — do not paste in chat)* |
| API Key name in SendGrid | e.g. `na-staffing-crm-prod` |
| Invite our team as admin? (email) | |

### 1.1 Domain authentication (SPF + DKIM)

Every domain used in **From** or **Send-as** must be authenticated in SendGrid.

| Domain to authenticate | Authenticated in SendGrid? (Yes/No) | DNS provider (Cloudflare / GoDaddy / other) | Who can add DNS records |
|------------------------|-------------------------------------|---------------------------------------------|-------------------------|
| e.g. nastaffing.com | | | |
| | | | |
| | | | |

---

## 2. Server env defaults (fallback when agency fields empty)

Set in `backend/.env` (or hosting secrets). Used as org fallback.

| Env var | Required? | Fill in | Example |
|---------|-----------|---------|---------|
| `SENDGRID_API_KEY` | Yes (for email) | | `SG.xxxxx` |
| `EMAIL_FROM` | Yes | | `noreply@nastaffing.com` |
| `EMAIL_FROM_NAME` | Recommended | | `NA Staffing CRM` |
| `EMAIL_INBOUND_DOMAIN` | Yes (for replies) | | `inbound.nastaffing.com` |
| `EMAIL_INBOUND_LOCALPART` | Recommended | | `reply` |
| `SEND_AS_ALLOWED_DOMAINS` | Optional | | `nastaffing.com,hrglobal.com` |
| `SEND_AS_OVERRIDE_EMAIL` | Staging only | | `qa-sink@example.com` (leave empty in production) |
| `FRONTEND_URL` | Yes (password reset links) | | `https://crm.nastaffing.com` |
| Public API host (for inbound webhook) | Yes | | `https://api.nastaffing.com` |

**Inbound webhook URL (give to SendGrid Inbound Parse):**

```
https://<PUBLIC_API_HOST>/api/v1/emails/inbound
```

Your filled URL: `https://________________/api/v1/emails/inbound`

---

## 3. Per-agency email settings

**CRM path:** Settings → Agencies → Edit agency → **Integrations** (and Settings tab for footer).

Copy this block for **each agency**.

### Agency: _______________________________

#### 3A. Display / branding (Settings tab)

| Field in CRM | Fill in | Notes |
|--------------|---------|-------|
| Agency name | | Internal org name |
| Agency email (display) | | Shown on agency card |
| Agency phone (display) | | Optional |
| Company display name (email footer text) | | Appears in email footer |
| Tagline | | Joined with footer as `Footer · Tagline` |
| Agency logo URL | | Used in some email layouts |

#### 3B. Outbound sender (Integrations)

| Field in CRM | Fill in | Example |
|--------------|---------|---------|
| From address (`emailFromAddress`) | | `toronto@nastaffing.com` |
| From name (`emailFromName`) | | `NA Staffing Toronto` |
| Send-as domain (`emailSendAsDomain`) | | `nastaffing.com` |

**Send-as rules:**

- If send-as domain is set and the user’s email is on that domain → CRM may send **From: user@domain**.
- Domain **must** be authenticated in SendGrid (section 1.1).
- If empty → uses agency From address, then env `EMAIL_FROM`.

#### 3C. Inbound replies / threading (Integrations)

| Field in CRM | Fill in | Example |
|--------------|---------|---------|
| Inbound Parse domain (`emailInboundDomain`) | | `inbound.nastaffing.com` |
| Inbound local-part (`emailInboundLocalpart`) | | `reply` |

**Reply-To format the CRM uses:**

```
{localpart}+crmreply-{emailId}.{userId}@{inbound-domain}
```

Preview for this agency:

```
________+crmreply-…@________
```

#### 3D. Agency auto-signature

**CRM path:** Settings → Templates → Agency Email Signature (Auto-Signature)

| Field | Fill in |
|-------|---------|
| Agency signature HTML / text | *(paste or attach)* |
| Includes `{{sender_signature}}` placeholder? | Yes / No |

---

## 4. DNS checklist (email)

### 4.1 Sending domain (outbound)

| Done | Record | Purpose |
|------|--------|---------|
| [ ] | SendGrid **Domain Authentication** CNAME/TXT as shown in SendGrid | SPF + DKIM |
| [ ] | Optional: DMARC TXT (`_dmarc`) | Policy / reporting |

### 4.2 Inbound reply subdomain

| Done | Record | Value |
|------|--------|-------|
| [ ] | MX on inbound subdomain (e.g. host `inbound`) | `mx.sendgrid.net` (priority 10) |
| [ ] | SendGrid → Settings → **Inbound Parse** → Hostname = inbound domain | |
| [ ] | Destination URL = `https://<API>/api/v1/emails/inbound` | |
| [ ] | MX propagated (check with dig / MX toolbox) | |

---

## 5. SendGrid Inbound Parse (console)

| Setting | Fill in |
|---------|---------|
| Hostname | e.g. `inbound.nastaffing.com` |
| Destination URL | `https://…/api/v1/emails/inbound` |
| Spam check / send raw (as preferred) | |
| Plus-addressing supported? | Must allow `local+tag@domain` |

---

## 6. CRM email behaviour settings

### 6.1 Email send window (cutoff)

**CRM path:** Settings → Email cutoff

| Field | Fill in |
|-------|---------|
| Enabled? | Yes / No |
| Start time | |
| End / cutoff time | |
| Timezone | e.g. `America/Toronto` |

*(Emails outside the window are queued until the window opens.)*

### 6.2 Email templates

**CRM path:** Settings → Templates

| Done | Item |
|------|------|
| [ ] | Starter templates imported / custom templates created |
| [ ] | Agency auto-signature saved |
| [ ] | Users set personal signature (profile / signature settings) |

### 6.3 Daily report emails (optional)

**CRM path:** Settings → Daily reports

| Field | Fill in |
|-------|---------|
| Enabled? | Yes / No |
| Send hour / minute | |
| Timezone | |
| Who receives | |

### 6.4 Bug report recipient emails (optional)

**CRM path:** Settings → Bug report emails

| Email | Name / role |
|-------|-------------|
| | |
| | |

### 6.5 Password reset / system emails

Uses org `EMAIL_FROM` + `FRONTEND_URL`. No per-agency setup beyond SendGrid working.

| Done | Check |
|------|-------|
| [ ] | Forgot-password email arrives |
| [ ] | Reset link opens correct frontend URL |

---

## 7. User-level email fields

| Field | Where | Fill / rule |
|-------|-------|-------------|
| Work email | User profile | Must be real inbox for notifications / send-as |
| Send-as email override | User (if used) | Must match allowed send-as domain |
| Send-as disabled | User flag | Yes = always use agency From |
| Personal signature | User settings | Appended via `{{sender_signature}}` |

**User list for send-as (optional):**

| User name | Login email | Send-as email (if different) | Agency | Send-as OK? |
|-----------|-------------|------------------------------|--------|-------------|
| | | | | |
| | | | | |

---

## 8. Multi-agency matrix (summary)

| Agency | From address | From name | Send-as domain | Inbound domain | Local-part | Footer / tagline |
|--------|--------------|-----------|----------------|----------------|------------|------------------|
| | | | | | | |
| | | | | | | |
| | | | | | | |

---

## 9. Test plan (email)

| Done | Test | Expected |
|------|------|----------|
| [ ] | SendGrid API key accepted | Test script / CRM send succeeds |
| [ ] | Domain auth verified in SendGrid | No “not authenticated” warnings |
| [ ] | Send email from CRM to external inbox | From name/address correct |
| [ ] | Reply from external inbox | Lands in CRM **Emails → Inbox** for correct user |
| [ ] | Reply threaded | Linked to original (`inReplyTo`) + correct client/lead |
| [ ] | Second agency send + reply | Does not mix into first agency |
| [ ] | Send-as (if enabled) | From shows associate address; still delivers |
| [ ] | Outside send window (if enabled) | Message queues, then sends later |
| [ ] | Forgot password | Reset email arrives with correct link |
| [ ] | Suppression / bounce | Hard bounce / unsubscribe handled (SendGrid sync job) |

---

## 10. Quick reference — what goes where

| Concern | Place |
|---------|--------|
| API key | Server env `SENDGRID_API_KEY` |
| Default From | Env `EMAIL_FROM` / `EMAIL_FROM_NAME` **or** agency Integrations |
| Per-agency From | Settings → Agencies → Integrations |
| Send-as domains | Agency `emailSendAsDomain` + env `SEND_AS_ALLOWED_DOMAINS` |
| Reply threading | Agency inbound domain + SendGrid Inbound Parse + MX |
| Footer / tagline | Settings → Agencies → Settings tab |
| Auto-signature | Settings → Templates → Agency signature |
| Templates | Settings → Templates |
| Send hours | Settings → Email cutoff |
| Password reset links | Env `FRONTEND_URL` |

---

## 11. Attachments / secure share

- [ ] SendGrid API key (password manager / encrypted share)
- [ ] Screenshot of SendGrid Domain Authentication = Verified
- [ ] Screenshot of Inbound Parse host + URL
- [ ] DNS MX screenshot for inbound subdomain
- [ ] Agency logo file(s)
- [ ] Signature HTML draft(s)

**Do not put production API keys in Slack/email plain text.**
