# NA Staffing CRM — One-doc system understanding

**Read this first.** Product + architecture understanding for the CRM. Topic deep-dives live in `backend/docs/<topic>.md` and other files linked at the end.

**Rule:** If a topic evolved later, the **latest product decision wins**. Do not open PDFs or scan the whole repo for day-to-day work.

---

## 1. What this product is

Multi-agency staffing CRM: shared client database, **agency-scoped** sales work (status, tags, notes, leads, calls), JWT auth, dynamic RBAC, proposals (PandaDoc), Twilio softphone (client PSTN), and separate staff WebRTC chat calling.

**Scale target:** 500–1000 concurrent users. Stateless API, indexes, pagination, optional Redis/Twilio/R2/SendGrid (must not crash when unset).

---

## 2. Stack & layout

| Layer | Tech |
|-------|------|
| API | Node, Express, Prisma, PostgreSQL — prefix `/api/v1` |
| Cache / sessions | Redis optional (refresh tokens, rate limit, jobs) |
| Frontend | React, Vite, shadcn, `@/` imports |
| Email / files / voice | SendGrid, Cloudflare R2, Twilio CRM softphone |

| Area | Path |
|------|------|
| Routes → services → Prisma | `backend/src/` |
| Schema | `backend/prisma/schema.prisma` |
| Env | `backend/src/config/env.ts` + `.env.example` |
| Topic docs | `backend/docs/<topic>.md` |
| Spec | This file |
| UI | `frontend/src/` — `pages/`, `components/`, `hooks/`, `lib/` |

**Patterns:** Thin routes (validate → service → response); fat services; Zod; `authenticate` + `requirePermission`; agency helpers (`agencyScope`, `dataScope`, `useAgencyFilter`, `resolveAgencyId`). No hardcoded role string checks for access — use permission keys.

---

## 3. Agencies (sub-companies)

- Org has many **agencies** (`sub_companies`).
- **Clients are global** (one shared list).
- **Work product is per agency:** status tabs, tags, notes, leads, calls, follow-ups, meetings, proposals.
- Elevated users (`super_admin`, `director`, `operations_manager`) can switch agency context (`?subCompanyId=` / UI Layer-1 tabs / `?allAgencies=true` on client detail).
- **Operations Manager:** no home agency; must have rows in `operations_manager_sub_companies` or list APIs return “Agency context required.”

---

## 4. Roles & permissions (short)

| Role | Scope idea |
|------|------------|
| `super_admin` | Org-global; no home agency |
| `director` | Org-wide; no home agency |
| `operations_manager` | Org-wide; assigned agencies |
| `database_manager` | Org-global client DB; Super Users page |
| `data_entry_specialist` | Org-wide entry |
| `company_director` | Per-agency leadership |
| `sales_manager` / `recruitment_manager` | Agency + team |
| `sales_associate` / `sales_executive` / `recruiter` / `sr_recruiter` | Own / limited write |
| `dev_team` / `it` | Support / settings |

Permissions are `resource:action` (e.g. `clients:read`, `leads:assign`, `voice:use`). Login / `/me` returns `permissions[]` for UI. Matrix: **backend/docs/ROLES_AND_ACCESS.md**. Dynamic RBAC: **backend/docs/DYNAMIC_RBAC.md**, **SYSTEM_ROLES_RBAC.md**. Approvals: **APPROVAL_CHAINS_GUIDE.md**.

---

## 5. Auth & security

- **JWT access** ~15m; **refresh** ~7d in Redis; **rotation** on refresh; logout revokes refresh when body provided.
- Routes: login, logout, refresh-token, forgot/reset password, `/me`.
- bcrypt 12; password complexity on reset; optional lockout.
- **IP:** optional global `IP_ALLOWLIST`; role/country rules via `/api/v1/ip-restriction-rules` (`settings:write`).
- Detail: **backend/docs/AUTH.md**, **IP_RESTRICTION.md**, **SECRETS.md**.

---

## 6. Clients — shared DB, per-agency overlay

### Identity

- `id` (UUID) = FK everywhere.
- `corporateCode` = business identity (display, lookup; GET `/clients/:id` accepts UUID or code).
- Multiple sites → `client_locations` on the same client row.
- Optional parent/branch via `parentClientId` (CSV import / branch approve).

### Shared vs per-agency

| Shared | Per agency (`subCompanyId`) |
|--------|-----------------------------|
| Name, industry, contacts, locations, corporateCode | Status tabs, tags, notes*, calls, follow-ups, meetings, documents*, leads, proposals |

\*Director/super_admin content often `isPublic` / visible cross-agency. Elevated: `?allAgencies=true` merges allowed agencies.

### Status tags (agency-scoped)

Six values on `client_sub_companies.status` (fallback `Client.status`):

| Tag | When |
|-----|------|
| **Contacted** | Default; lead in progress; signed but not activated |
| **Active** | **Only** when lead → `closed_won` (manager “Make Lead Active” or Approve & Activate) |
| **Lost** | Latest lead `closed_lost` |
| **Ex / Unsubscribed / Permanently Closed** | Manual manager toggles |

**Golden rule:** Active ≠ “signed in PandaDoc.” Signed → still Contacted until activation (`closed_won`).

Paths to Active: PandaDoc sign → Pending Activations → Make Active; manual signed upload → same; or Approve & Activate (skip signing wait).

Model API: **backend/docs/CLIENT_AGENCY_MODEL.md**.

### Ownership labels (do not confuse)

| Label | Meaning | Who sets |
|-------|---------|----------|
| **Assigned to** | Who works the lead now | Managers (reassign) |
| **Won by** | Whose proposal closed the deal | Set at close-won (immutable ribbon) |
| **Owned by** | Long-term business owner (Management or person) | Director / OM / super_admin only |

On closed-won: if Owned by unset, auto-set from latest approved proposal `createdById`. Director override never overwritten. Import leaves Owned by unset.

### Notes vs Field Notes (custom fields)

- Existing **Notes** (`ClientNote`, public/private, pin) stay always available (additive).
- **Field Notes** (custom fields) gated on **Closed Won** (`Lead.status === 'closed_won'`).
- Field types MVP: `text | textarea | number | boolean | select`.
- Visibility: `global` (one value/client) vs `agency` (per agency). Permissions via RBAC keys, not role names.

---

## 7. Leads & pipeline

- Lead = **Client + Agency + Owner + Stage + Status**.
- Same client can be a lead in multiple agencies; other agencies do not see each other’s leads (except director/super_admin overrides / all-agencies views).
- Permissions: `leads:read` / `write` / `assign`.
- Statuses include `open`, `active`, `closed_won`, `closed_won_pending`, `closed_lost`.
- Pipeline stages per agency (or global). Lead requests may gate “another agency takes this client.”
- Detail: **backend/docs/LEADS_AND_PIPELINE.md**.

---

## 8. UI pattern — agency / user layers

Elevated roles get URL-driven tabs (survives refresh):

| Page | Layer 1 | Layer 2 |
|------|---------|---------|
| **Leads** | All Agencies + per agency | All Users + per user in agency |
| **Clients** | Same as Leads | Same (copy Leads pattern) |
| **Users** | All Agencies + per agency only | None (users are the rows) |

Query: `?agencyId=…&userId=…`. Non-elevated users see the classic single-agency page.

---

## 9. CSV / Excel client import

Dynamic importer:

1. Any CSV/Excel (`exceljs`); synonym auto-map + user confirm.
2. Group rows by file **ID** column → one staged client, many contacts.
3. Keyword → `industry` (auto-add to agency AllowedIndustry if missing).
4. Upload: `clients:read`. Approve: **Director only**.
5. Approve modes: `new` | `append` | `branch` (`targetClientId`).
6. Mapping templates in Postgres `ImportMappingTemplate` (per agency), not localStorage/Redis.
7. UI: `ImportClientsDialog.tsx`; API under `/clients/pending-imports`.

---

## 10. Proposals & templates (agency-scoped)

Proposal defaults, PandaDoc template mappings, and review templates are **per agency** (`subCompanyId` already on models). Direction: manage them inside **Edit Agency** dialog tabs (not top-level Settings tabs with a picker). Runtime proposal submit already filters by submitter/lead agency.

---

## 11. Agency email signature

**Approved visual:** compact footer (~80–95px): logo left | divider | details right; white bg; single-color name; no social icons; Outlook-safe tables; width 480px.

- Config version 2; migrate v1 JSON on GET.
- Tokens: `{{sender_name}}`, `{{sender_title}}`, `{{sender_phone}}`, `{{sender_email}}`, `{{agency_name}}`, `{{agency_logo}}`.
- Code: settings email-signature routes + `SignatureBuilder` / `buildSignatureHtmlFromConfig`.

---

## 12. Voice vs internal calling

| Feature | Tech | Use |
|---------|------|-----|
| **CRM softphone** | Twilio | Call client PSTN (`voice:use`) |
| **Staff chat call** | WebRTC + Socket.IO | Messages 1:1 — **not** Twilio |

Docs: **PHONE_SYSTEM.md**, **TWILIO_VOICE_SETUP.md**, **INTERNAL_CHAT_CALLING.md**, **docs/CALLS_AND_CONTACT_ACTIVITY.md**.

---

## 13. API map (core)

| Domain | Examples |
|--------|----------|
| Auth | `/auth/login`, `/logout`, `/refresh-token`, `/forgot-password`, `/reset-password`, `/me` |
| Users | `/users`, database-managers (super_admin) |
| Clients | `/clients`, `/:id`, agency-status, notes, tags, pending-imports |
| Leads | `/leads`, pipeline-stages, assign |
| Voice | `/voice/token`, `/voice/call`, `/voice/config` |
| Internal calls | `/internal-calls/ice-config` + sockets |
| Settings / IP / approvals | settings, ip-restriction-rules, `/approvals/...` |

Prefer this file + one `backend/docs/<topic>.md` over scanning the repo.

---

## 14. Principles (non-negotiable)

From **docs/STANDARDS.md**:

1. Scalable — indexes, pagination, no N+1.
2. Secure — Zod, auth, no secrets in logs.
3. Modular — thin routes / fat services.
4. Optional services degrade gracefully.
5. Schema only via Prisma migrations.
6. Access via permissions + agency helpers — never invent parallel scope logic.
7. Additive on locked client flows unless product says otherwise.

---

## 15. Doc index (when you need depth)

| Doc | Use |
|-----|-----|
| **docs/SYSTEM_UNDERSTANDING.md** | This file — whole system |
| **docs/STANDARDS.md** | Engineering principles |
| **docs/CALLS_AND_CONTACT_ACTIVITY.md** | Call attribution & recordings |
| **docs/EMAIL_CONFIG_TEMPLATE.md** | Email ops fill-in form |
| **docs/SENDGRID_INBOUND_PARSE_SETUP.md** | Inbound parse / reply threading |
| **docs/CLIENT_GO_LIVE_INTAKE.md** | Go-live checklist |
| **backend/SETUP.md** | Backend local setup |
| **backend/RUN_SETUP.md** | Stuck-setup recovery steps |
| **backend/docs/\*.md** | Topic implementation (auth, clients, leads, RBAC, voice, …) |

---

## 16. Mental model (one paragraph)

Agencies share one client directory. Each agency runs its own relationship layer (tabs, tags, notes, leads). Associates work assigned leads; managers approve proposals and activate Closed Won → client becomes **Active** and ownership may auto-fill. Directors own long-term **Owned by**, agency settings, imports, and templates. Elevated users navigate with All Agencies / per-agency / per-user tabs. Auth is JWT+Redis; authorization is permission keys + agency scope helpers.
