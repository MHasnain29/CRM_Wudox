# Feature Spec & Implementation Prompt — Email Notification Controls

> **Purpose:** ready-to-hand spec for Claude to implement per-email-type
> notification controls. Follows `CLAUDE.md` (understand → plan → approve →
> build → verify → review). Hand to Claude: *"Implement the feature in
> docs/EMAIL_NOTIFICATION_CONTROLS.md. Start in Plan Mode per CLAUDE.md, confirm
> the file list against current code, and get my approval before writing code."*

---

## 1. Goal
Give holders of a new `email_notifications:manage` permission **per-email-type
control** over which automatic notification emails their agency sends, plus a
**master kill-switch** — without ever affecting critical account emails,
manual user-sent emails, campaigns, or the in-app notification system.

## 2. Decisions (LOCKED by owner — build to these)
1. **Granularity → PER-EMAIL-TYPE + MASTER.** Each of the ~26 notification email
   types has its own agency toggle, grouped by category in the UI, under one
   master switch. Default = ON for every type (zero behavior change on deploy).
2. **Who controls → RBAC permission `email_notifications:manage`** (NOT a
   hardcoded `super_admin` check). See §7 for the 3-place registration.
3. **Agency-scoped** — settings live per `SubCompany` (multi-tenant isolation).
4. **Scope = automatic notifications ONLY.** Manual "send email to client" and
   bulk campaigns are OUT OF SCOPE — they always send and their code is left
   untouched. Critical auth emails are hard-excluded and can never be gated.

## 2a. 🚫 HARD GUARANTEE — never affected by this feature
These paths MUST keep working identically no matter what any toggle is set to.
Do NOT route them through the gate; do NOT edit their send code:
- **Manual email sending** — user-initiated "send email to client"
  (`routes/emails.ts` → `sendClientEmail`, user-initiated). Always sends.
- **Bulk / campaign email** — `services/campaignSender.ts`. Always sends; file untouched.
- **Critical auth email** — password reset + welcome/temp-password. Always sends.
If a change would touch any of these, it is out of scope — stop and flag it.

## 3. ⚠️ Why the naive approach fails (audit findings — read this)
An exhaustive audit of `backend/` found:
- **No existing single choke point.** `email.ts` has ~27 email functions; **most
  call `sgMail.send()` directly**. Gating only `sendClientEmail` covers ~60% and
  MISSES lead/proposal/meeting/report/training emails.
- **`campaignSender.ts` bypasses the email service entirely** (direct `sgMail.send`).
- **Two emails MUST NEVER be gated:** `sendPasswordResetEmail` and
  `sendWelcomeWithPassword`. Gating them = users locked out of their accounts.
  This is the core "don't break anything" hazard.
- **`sendClientEmail` is shared** by both excluded manual compose AND several
  gated notifications → the gate must key off an email-TYPE tag, not the function.

## 4. Architecture — single central delivery wrapper (the key idea)
Introduce ONE internal choke point that every notification email routes through:

```ts
// backend/src/services/emailGate.ts  (new)
type EmailTypeKey = keyof typeof EMAIL_CATALOG

// catalog is the single source of truth for every email type
// { key: { label, category, critical } }  — critical types are never gated
export const EMAIL_CATALOG = { /* see §5 */ }

// wrapper wraps the real sgMail.send; every notification send goes through it
export async function deliverEmail(msg, { subCompanyId, type }: { subCompanyId?: string; type: EmailTypeKey }) {
  const meta = EMAIL_CATALOG[type]
  if (!meta || meta.critical) return sgMail.send(msg)      // critical/unknown → always send
  if (!subCompanyId)          return sgMail.send(msg)      // no agency context → FAIL-OPEN (never silently drop)
  const allowed = await isEmailTypeEnabled(subCompanyId, type)  // master && per-type, 60s cache
  if (!allowed) { logSuppressed(subCompanyId, type); return { suppressed: true } }
  return sgMail.send(msg)
}
```

**Rules that keep it safe ("don't affect anything else"):**
- **Fail-open:** any missing context, cache error, or unknown type → send anyway.
  A gate bug must never silently swallow mail.
- **Critical types are excluded in code**, not by config — cannot be turned off.
- **Default enabled=true** for every type when no row exists → deploying the
  feature changes nothing until someone flips a switch.
- **Manual compose + campaigns are NOT routed through the gate** — their code is
  not touched at all.
- **In-app notifications (`AgencyNotificationRule`) are untouched** — separate model.
- No change to templates, content, send-window, SendGrid config, or recipients.

**Wiring:** replace each notification `sgMail.send(...)` inside `email.ts` with
`deliverEmail(..., { subCompanyId, type })`, tagging it with its catalog key.
For `sendClientEmail`, thread a `type` param from callers so manual compose
passes an excluded/untagged path (always sends) while notification callers pass
their type. This is mechanical but must cover EVERY notification site in §6.

## 5. Email-type catalog (the ~26 notification types + exclusions)
Group by category for the UI. `critical: true` = hard-excluded, shown as
"Always on (locked)". Confirm exact `email.ts` line numbers in Plan Mode.

**CRITICAL — never gated (excluded in code):**
- `password_reset` (sendPasswordResetEmail) — auth
- `account_welcome` (sendWelcomeWithPassword) — account setup / temp password

**OUT OF SCOPE — not routed through gate, code untouched:**
- Manual client compose (`routes/emails.ts` → sendClientEmail, user-initiated)
- Campaigns (`services/campaignSender.ts`)

**GATABLE NOTIFICATIONS (default ON), by category:**
- **Leads:** `lead_requested`, `lead_assigned`, `lead_request_approved`,
  `lead_request_rejected`, `lead_reassignment_requested`,
  `lead_reassignment_approved`, `lead_reassignment_rejected`
- **Proposals:** `proposal_submitted`, `proposal_approved`, `proposal_rejected`,
  `proposal_client_email`, `signed_document_confirmation`, `review_email_to_client`
- **Clients:** `client_created`, `client_unsubscribe`, `client_permanently_closed`
- **Meetings:** `meeting_scheduled`
- **Reports:** `daily_report`
- **Training / Employee:** `employee_assignment_details`, `employee_training_message`,
  `employee_standalone_training`, `employee_default_trainings`
- **Offboarding:** `offboarding_received`
- **Admin / Requests:** `bug_resolved`, `settings_request` (industry/tag/job-title
  request + approve/reject emails in `routes/settings.ts`)

> Note: `bug_report` (to internal team) — confirm in Plan Mode whether it's
> gatable (internal ops) or should join CRITICAL. Recommend: gatable under Admin.

## 6. Complete send-site inventory to re-tag (from audit — verify each)
Every site below must be routed through `deliverEmail` with the right type.
Missing one = an uncontrolled email. Grep to confirm none were added since.

Core defs in `backend/src/services/email.ts` (~27 `sgMail.send` calls). Callers:
- `routes/auth.ts:280` password reset — **CRITICAL, leave direct**
- `routes/users.ts:1219/1381/1527` welcome/temp password — **CRITICAL, leave direct**
- `routes/users.ts:1652` password reset — **CRITICAL, leave direct**
- `routes/bugReports.ts:98` bug report; `:262` bug resolved
- `routes/emails.ts:1211` manual client send — **OUT OF SCOPE, leave ungated**
- `routes/leadRequests.ts:334/499`; `routes/leads.ts:674/1060`
- `routes/meetings.ts:599/874`
- `routes/proposals.ts:546/1482/2358/3279`
- `routes/settings.ts:488/530/566/662/704/740/1018/1060/1096`
- `routes/clients.ts:3293/3433/3442/4123`
- `routes/pandadoc.ts:283`
- services: `activeClientTrainingEmail.ts:125`, `clientDestinationCreate.ts:478`,
  `employeeAssignmentTraining.ts:125`, `employeeAssignments.ts:511`,
  `employeeDefaultTraining.ts:249`, `employeeTraining.ts:174/270`,
  `jobPlacements.ts:283`, `leadReassignment.ts:390/420/611/772`,
  `leadRequestApproval.ts:362`, `offboarding.ts:521`,
  `pandadoc/pandaDocCrmDelivery.ts:163`, `proposalReviewSend.ts:221`
- `jobs/dailyReportEmailer.ts:247` daily report (cron)
- `services/campaignSender.ts:332` — **OUT OF SCOPE, leave untouched**
- Queue: `jobs/outboundEmailQueueProcessor.ts` drains queue → gate at ENQUEUE
  time in `sendClientEmail`, NOT at drain time (too late / no type context).

## 7. Permission registration (4 places — verified against code)
Runtime resolves effective keys via `buildAccessContext`/`ensureAccessContext`
(`req.access`/`req.permissionKeys`); `super_admin` bypasses all. Frontend
`useHasPermission` reads `authStore.permissions` (populated on login).
- `backend/src/config/permissions.ts` — add `'email_notifications:manage'` to the
  `Permission` union (after `'hubstaff:manage'`, ~line 78) AND to `ALL_PERMISSIONS`
  (after `'hubstaff:manage'`, ~line 116).
- `backend/src/config/systemRolePermissions.ts` — add to `PERMISSIONS_BY_ROLE_KEY`
  for: `super_admin`, `director`, `company_director`, `operations_manager`.
- `backend/prisma/rbacDemoData.ts` — add to `PERMISSION_CATALOG`: a group row
  (reuse `module.emails` or add `module.email_notifications`) + a leaf
  `{ key:'email_notifications:manage', name:'Manage email notification settings',
  module:'email_notifications', parentKey:'module.emails', isGroup:false,
  actionType:'custom' }`. This is the SEED SOURCE `seed-rbac.ts` reads.
- Then run `npm run prisma:seed-rbac`. ⚠️ resets roles — coordinate before live.
  (No schema change: `RbacPermission`/`RolePermission` already exist.)

## 8. Data model (Prisma) — follow existing singleton-setting pattern
```prisma
model EmailNotificationSetting {          // master, 1:1 with SubCompany
  id           String     @id @default(cuid())
  subCompanyId String     @unique
  subCompany   SubCompany @relation(fields: [subCompanyId], references: [id], onDelete: Cascade)
  enabled      Boolean    @default(true)  // master kill-switch
  updatedById  String?
  updatedAt    DateTime   @updatedAt
  createdAt    DateTime   @default(now())
}

model EmailTypePreference {               // per-type, per agency
  id           String     @id @default(cuid())
  subCompanyId String
  typeKey      String                     // matches EMAIL_CATALOG key
  enabled      Boolean    @default(true)
  updatedById  String?
  updatedAt    DateTime   @updatedAt
  subCompany   SubCompany @relation(fields: [subCompanyId], references: [id], onDelete: Cascade)
  @@unique([subCompanyId, typeKey])
}
```
- Missing row ⇒ treated as enabled (default ON). Effective = master ON && type ON.
- Follow `EmailSendWindowSetting` conventions exactly: `id` via
  `@default(dbgenerated("(gen_random_uuid())::text"))`, snake_case `@map`,
  `@@map("email_notification_settings")` / `@@map("email_type_preferences")`,
  `subCompanyId @unique @map("sub_company_id")`, relation `onDelete: Cascade`.
  Add back-relations on `SubCompany` (near lines 54–81):
  `emailNotificationSetting EmailNotificationSetting?` and
  `emailTypePreferences EmailTypePreference[]`.
- **Migration:** write the FULL SQL into the migration file — CREATE both TABLEs,
  the `@@unique([subCompanyId, typeKey])` constraint, indexes — so `migrate deploy`
  applies it on the server. `prisma migrate dev` is broken here — use
  `migrate diff` + `db execute`. **Permissions are NOT inserted here** — they go
  through `rbacDemoData.ts` + `seed-rbac` (see §7).

## 9. API (Express) — follow `routes/settings.ts`
- `GET  /api/settings/email-notifications` → `{ master: boolean, types: [{ key, label, category, critical, enabled }] }`
- `PATCH /api/settings/email-notifications` → `{ master?: boolean, types?: [{ key, enabled }] }` (upsert)
- Guard: `authenticate` + `requirePermission('email_notifications:manage')`.
- Validate: booleans only; reject unknown `typeKey`s; never allow toggling a
  `critical` type (server rejects even if UI sends it).

## 10. Frontend (React + Radix/Shadcn) — follow `Settings_Notifications.tsx`
- New settings sub-tab, gated by `useHasPermission('email_notifications:manage')`.
- Master `Switch` at top; below, categories with a `Switch` per type; critical
  types render disabled/locked with "Always on". Fetch on load, save on toggle,
  error toast on failure. Reuse the existing `Switch` component.

## 11. Build order (small steps)
1. Add `email_notifications:manage` permission (3 places in §7).
2. Prisma models + hand-written migration SQL. Regenerate client.
3. `emailGate.ts`: `EMAIL_CATALOG`, `isEmailTypeEnabled` (60s cache),
   `deliverEmail` wrapper. Unit-sanity the gate logic (critical→send, off→suppress,
   missing context→send).
4. Re-tag every notification send site (§6) through `deliverEmail`. Leave
   critical + manual + campaign paths untouched. Grep afterward to prove no
   notification `sgMail.send` remains un-wrapped.
5. API endpoints + upsert service, guarded by the permission + validation.
6. Frontend sub-tab, permission-gated.

## 12. Acceptance criteria (evidence required)
- Master OFF ⇒ no notification emails send; auth (reset/welcome), manual sends,
  and campaigns STILL send. Verified per path.
- A single type OFF (e.g. `daily_report`) ⇒ that email stops; all others send.
- Default (fresh agency, no rows) ⇒ everything sends exactly as today — **no regression**.
- Critical types cannot be disabled via API (server rejects) or UI (locked).
- Users without `email_notifications:manage` get 403 and see no control.
- Gate is fail-open: simulate a settings-lookup error ⇒ email still sends.
- In-app notifications unaffected (separate system).
- Cache reflects a change within TTL; no stale suppression afterward.
- Run `/verify`, `/code-review`, and `/security-review` (touches auth-gating +
  data-affecting control). Then suggest a commit message as a code block — do NOT commit.

## 13. Guardrails (from CLAUDE.md — do not violate)
- Plan first, get approval before writing code.
- **Do not affect anything else:** critical/manual/campaign paths untouched;
  in-app notifications untouched; templates/send-window/SendGrid config untouched;
  fail-open everywhere; default ON preserves current behavior.
- Consistency: copy existing singleton-setting + settings-route + Switch patterns.
- Simplicity: build Phase-1 scope only; no per-user prefs, no per-event in-app changes.
- Types: no `any`, no `!`; reuse Prisma-generated types.
- Migrations: full SQL in the file. Commits: never run `git commit`.

---

## 14. DETAILED IMPLEMENTATION PLAN (code-verified, no gaps)

Line numbers verified against current code; re-grep before editing (files shift).

### ⚠️ The critical work item: agency context threading
Only 5 email fns carry `subCompanyId` (`sendClientEmail`,
`sendProposalClientEmail`→via it, `sendSignedDocumentConfirmationEmail`,
`sendMeetingScheduledEmail`, `sendReviewEmailToClient`). The other ~19
notification fns DO NOT. Per-agency gating requires adding a `subCompanyId?: string`
param to each and passing it from every call site (§6). This is the largest,
highest-risk change. **Fail-open safety:** if a site can't resolve `subCompanyId`,
`gatedSend` sends anyway — a missed thread degrades to "not yet controllable",
never to "silently dropped". Critical fns are left untouched entirely.

### Workstream A — Permission `email_notifications:manage` (4 edits + seed)
- `config/permissions.ts`: append to `Permission` union (~L78) + `ALL_PERMISSIONS` (~L116).
- `config/systemRolePermissions.ts`: add to `super_admin`, `director`,
  `company_director`, `operations_manager` arrays in `PERMISSIONS_BY_ROLE_KEY`.
- `prisma/rbacDemoData.ts`: add leaf to `PERMISSION_CATALOG` (parent `module.emails`,
  `actionType:'custom'`).
- Run `npm run prisma:seed-rbac` (⚠️ resets roles). Frontend picks it up on next login.

### Workstream B — Prisma models + migration
- `schema.prisma`: add `EmailNotificationSetting` (master: `enabled Boolean @default(true)`)
  and `EmailTypePreference` (`typeKey String`, `enabled Boolean @default(true)`,
  `@@unique([subCompanyId, typeKey])`), per §8 conventions. Add 2 back-relations on `SubCompany`.
- New migration folder; hand-write full SQL (both CREATE TABLEs + unique + indexes).
  Generate via `migrate diff` + apply via `db execute`. Regenerate client.

### Workstream C — Settings service, catalog, cache (new file)
`services/emailNotificationSettings.ts`:
- `EMAIL_CATALOG: Record<string,{label;category;critical}>` — all types from §5
  (critical: `password_reset`, `account_welcome`).
- Raw-SQL `get`/`upsert` for both tables mirroring `emailSendWindow.ts`
  (`ON CONFLICT ... DO UPDATE`, `isMissingRelationError` → default-enabled).
- 60s TTL cache per `subCompanyId` + `invalidateEmailNotificationCache()`
  (mirror `notificationRuleService.ts`).
- `isEmailTypeEnabled(subCompanyId, typeKey): Promise<boolean>` =
  master (default true) && type (default true); critical → true without lookup;
  ANY error → true (fail-open).

### Workstream D — Gate wiring in `services/email.ts` (the big one)
- Add private `gatedSend(message, { subCompanyId, type })`:
  `critical/unknown type || !subCompanyId → sgMail.send`; else
  `!(await isEmailTypeEnabled) → log + return { suppressed:true }`; else `sgMail.send`.
- **Leave critical fns untouched** (`sendPasswordResetEmail` L647,
  `sendWelcomeWithPassword` L704 — keep raw `sgMail.send`).
- For each of the ~19 notification fns: add `subCompanyId?` param (where missing)
  + replace `sgMail.send(...)` with `gatedSend(..., { subCompanyId, type })`.
- `sendClientEmail` (L747): add a `type` param; gate at ENQUEUE time — before the
  `shouldSendNow`/enqueue/send branch (~L782), `if (type not excluded && subCompanyId
  && !(await isEmailTypeEnabled)) return false`. Manual-compose caller passes an
  excluded type (not in catalog → always sends).
- Update ALL call sites in §6 to pass `subCompanyId` (+ `type` for `sendClientEmail`).
- Leave `campaignSender.ts` and `routes/emails.ts` manual send untouched. Queue
  processor untouched (gated at enqueue).
- After: `grep -n "sgMail.send" services/email.ts` — every hit must be either a
  critical fn (intentional) or inside `gatedSend`. No bare notification sends remain.

### Workstream E — API (`routes/settings.ts`)
- `GET /email-notifications` (guard `requirePermission('email_notifications:manage')`,
  scope `getEffectiveSubCompanyId`): return `{ master, types:[{key,label,category,critical,enabled}] }`
  merging `EMAIL_CATALOG` with stored rows (missing → enabled:true).
- `PUT /email-notifications` (same guard): zod-validate `{ master?, types?:[{key,enabled}] }`;
  reject unknown keys and any attempt to toggle a `critical` type; upsert via service;
  invalidate cache; return updated shape. (Router already mounted at `/api/v1/settings`.)

### Workstream F — Frontend
- `lib/api.ts`: `fetchEmailNotificationSettings()` (apiFetch GET) +
  `updateEmailNotificationSettings(payload)` (fetch PUT + `getAuthHeaders()`),
  path `/settings/email-notifications`.
- New `pages/Settings_EmailNotifications.tsx`: mirror `Settings_Notifications.tsx`;
  master `Switch` + per-category type `Switch`es; critical types `disabled` + "Always on";
  load on mount, save on toggle, toast errors.
- `pages/Settings.tsx`: `const canManageEmailNotifs = useHasPermission('email_notifications:manage');`
  add gated `TabsTrigger value="email-notifications"` (~L1583) + `TabsContent` (~L2206).

### Workstream G — Verify & review
Run the §12 scenarios via `/verify`; then `/code-review` and `/security-review`;
suggest a commit message as a code block (do NOT commit).

### Suggested order
A → B → C → E → F in parallel-ish; **D last** (depends on C, highest risk).

---

### Copy-paste prompt for Claude
> Implement the email notification controls in `docs/EMAIL_NOTIFICATION_CONTROLS.md`.
> Follow `CLAUDE.md`: start in Plan Mode, re-verify the §6 send-site inventory and
> §5 catalog line numbers against the CURRENT code (grep for every `sgMail.send`),
> show me the plan, and wait for approval. Build all send sites through the central
> `deliverEmail` gate; leave critical auth emails, manual client compose, and
> campaigns untouched; keep the gate fail-open and default-ON. Write full SQL in the
> migration. When done, run `/verify`, `/code-review`, `/security-review`, then
> suggest a commit message as a code block (do not commit).
