# NA Staffing CRM — Basic Startup Settings Checklist

Use this when bringing up a **new production (or staging) environment**.  
Check each item after it is done. Order matters: finish **A → B → C** before day-to-day use.

---

## A. Server / env (must work before login)

Minimum for the app to start and stay up:

| Done | Item | Where / notes |
|------|------|----------------|
| [ ] | `DATABASE_URL` (PostgreSQL) | `backend/.env` |
| [ ] | `JWT_SECRET` + `JWT_REFRESH_SECRET` (32+ chars each) | `backend/.env` |
| [ ] | Redis on (`REDIS_URL` or host/port) **or** `REDIS_ENABLED=false` | Auth refresh tokens need Redis in normal setup |
| [ ] | `FRONTEND_URL` + `APP_URL` + `CORS_ORIGIN` = live CRM URL(s) | No trailing slash issues |
| [ ] | `PUBLIC_API_URL` = public HTTPS API (for Twilio webhooks) | Required for phone |
| [ ] | `TRUST_PROXY=true` if behind nginx / load balancer | So real client IP works |
| [ ] | Migrations applied | `npx prisma migrate deploy` |
| [ ] | RBAC seeded | `npm run prisma:seed-rbac` |
| [ ] | Approval defaults seeded | `npm run prisma:seed-approval` |
| [ ] | Super Admin can log in | Seed or create first admin |

**Integrations (only if that feature is used at launch):**

| Done | Item | Needed for |
|------|------|------------|
| [ ] | `SENDGRID_API_KEY` + `EMAIL_FROM` / `EMAIL_FROM_NAME` | Outbound email |
| [ ] | `EMAIL_INBOUND_DOMAIN` (+ DNS MX to SendGrid) | Email replies into CRM |
| [ ] | Twilio master env **or** per-agency creds in UI | Voice / phone system |
| [ ] | R2 keys + bucket (`R2_*`) | Documents / recordings storage |
| [ ] | `PANDADOC_API_KEY` (+ webhook secret) | Proposals / e-sign |
| [ ] | `GOOGLE_CLIENT_ID` / `SECRET` / `REDIRECT_URI` | Calendar connect |

---

## B. Settings — basic startup (in the CRM UI)

Log in as **Super Admin** (or Director / OM with settings access).  
Complete in this order.

### 1. Settings → Agencies *(required)*

For **each** agency:

| Done | Field / action |
|------|----------------|
| [ ] | Create agency (name) |
| [ ] | Agency email + phone (display) |
| [ ] | Logo URL (sidebar branding) |
| [ ] | Email footer + tagline |
| [ ] | **Integrations → Email:** From address, From name |
| [ ] | **Integrations → Email:** Send-as domain (if associates send as themselves) |
| [ ] | **Integrations → Email:** Inbound domain + local-part (for replies) |
| [ ] | **Integrations → Google Calendar:** Connect (optional) |
| [ ] | Proposal defaults / templates (optional — if proposals live day 1) |

### 2. Users *(required)*

| Done | Action |
|------|--------|
| [ ] | Create all staff users (name, email, role, agency) |
| [ ] | Operations Managers: assign **which agencies** they cover |
| [ ] | Directors / org-wide roles: confirm no wrong home agency |
| [ ] | Test login for one user per role |

*(Users page / Super Users — not only Settings tabs.)*

### 3. Settings → Roles *(required once)*

| Done | Action |
|------|--------|
| [ ] | Confirm system roles loaded (after `seed-rbac`) |
| [ ] | Adjust permissions only if client asked (or leave defaults) |
| [ ] | Confirm parent / hierarchy looks correct for approvals |

### 4. Settings → Approvals *(required for queues)*

Per agency (and org card where shown):

| Done | Workflow | Set route or turn off “Require approval” |
|------|----------|------------------------------------------|
| [ ] | Lead request / create | |
| [ ] | Client add / recommend | |
| [ ] | Proposals | |
| [ ] | Global Database (org) | Destination / Database Manager if used |
| [ ] | “Allow lead self-assign” on/off as client wants | |

### 5. Settings → Pipeline *(required for leads)*

| Done | Action |
|------|--------|
| [ ] | Stages created / ordered for each agency (or confirm defaults) |
| [ ] | Closed-won / closed-lost stages present |

### 6. Settings → Phone System *(required if calling is live)*

Per agency:

| Done | Action |
|------|--------|
| [ ] | **Integrations:** save Twilio Account SID, Auth Token, API Key SID/Secret, TwiML App SID |
| [ ] | Test connection |
| [ ] | Sync / assign phone numbers |
| [ ] | Set outbound caller ID |
| [ ] | Business hours |
| [ ] | Ring groups + members |
| [ ] | Call flow / IVR (greeting + keys) |
| [ ] | Voicemail boxes if used |
| [ ] | Place test inbound + outbound call |

### 7. Settings → Templates + Auto-Signature *(required if email is live)*

| Done | Action |
|------|--------|
| [ ] | Auto-signature configured per agency |
| [ ] | Starter / common email templates added |

### 8. Settings → Tags / Industries / Job titles *(recommended)*

| Done | Action |
|------|--------|
| [ ] | Tags list |
| [ ] | Industries list |
| [ ] | Job titles list |
| [ ] | Or use **Sync from clients** after first import |

### 9. Settings → Company (login branding) *(optional)*

| Done | Action |
|------|--------|
| [ ] | Company display name |
| [ ] | Login / company logo |

### 10. Other Settings (set if client cares at launch)

| Done | Tab | What to set |
|------|-----|-------------|
| [ ] | Client visibility | Days before org-wide share |
| [ ] | Daily reports | Time + timezone |
| [ ] | Email cutoff | Send window hours + timezone |
| [ ] | Idle time | Auto away / logout minutes |
| [ ] | Performance targets | Emails / calls / meetings per day |
| [ ] | Notifications | Agency notification rules |
| [ ] | Scripts | Call scripts |
| [ ] | Client notes | Note templates / rules |
| [ ] | Linked accounts | Agency link rules |
| [ ] | Bug report emails | Who receives bug reports |
| [ ] | Availability | User working hours (per user) |

---

## C. Smoke test (before telling client “live”)

| Done | Test |
|------|------|
| [ ] | Login + refresh token works |
| [ ] | Create / open a client in one agency |
| [ ] | Create a lead + move pipeline stage |
| [ ] | Send test email (and reply if inbound configured) |
| [ ] | Softphone registers (“Agent phone ready”) |
| [ ] | Outbound call + inbound ring group |
| [ ] | Upload a document (R2) |
| [ ] | Submit one approval item and approve it |
| [ ] | Second agency cannot see first agency’s private notes/calls |

---

## Minimum “basic start” (if client wants CRM only, no phone/email yet)

Must do:

1. Env + DB + migrate + `seed-rbac` + `seed-approval`
2. Settings → **Agencies** (at least one)
3. **Users** with correct roles
4. Settings → **Approvals** (or turn require-approval off)
5. Settings → **Pipeline**
6. Smoke: login → client → lead

Can defer: Phone System, SendGrid/inbound, PandaDoc, Google Calendar, R2 (until documents needed).

---

## Fill-in: agencies for this install

| Agency name | Email From | Inbound domain | Twilio number | Timezone | Owner admin |
|-------------|------------|----------------|---------------|----------|-------------|
|             |            |                |               |          |             |
|             |            |                |               |          |             |
|             |            |                |               |          |             |

**Install date:** _______________  
**Configured by:** _______________  
**Signed off by:** _______________
