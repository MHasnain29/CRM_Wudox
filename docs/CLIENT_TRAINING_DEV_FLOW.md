# Client Training — Developer Flow

> Technical notes for implementation.  
> Status: **Implemented (v1)** — core flow + review hardening + product decisions locked + isolation rules.

---

## Feature intent

Active Clients can optionally require **client training**.

1. **Capture** at Active Client create/edit: training document.
2. **Surface** on Link to Client & Job: show required training + **Preview**.
3. **Email** training document to employee after link (SendGrid, as linking user). Job start is **not** blocked.
4. **Complete** on employee Training UI: **Upload** signed training document + **Preview** (+ **Resend** of template email). Marks flow complete.

This is **recruitment Active Clients**, not Marketing Clients.

---

## Strict isolation — do not affect other flows

**Rule:** Client Training is a **separate feature**. Implementation must not change behavior of unrelated recruitment/CRM flows.

| Must NOT change / gate / reuse | Why |
|--------------------------------|-----|
| Ontario 4 Steps / WHMIS / `EmployeeTraining` / Master approval | Different training; Master gate stays as today |
| Marketing Client assignment training (`employeeAssignmentTraining`, `trainingMessage`, SMS) | Different product path |
| Job start / link success / auto-approve job placement | Placement proceeds without signed upload |
| Onboarding Agreement / PandaDoc | Separate paperwork |
| Marketing Clients / `ClientDetailsSheet` | Wrong domain |
| Voice / Twilio / unrelated email campaigns | Out of scope |

**Allowed touch points only (thin hooks):**

1. Active Client create/edit form — add training fields section  
2. Matching jobs / link dialog — optional training summary + preview block  
3. After successful `targetType: 'job'` link — side-effect: create pending row + best-effort email (failure must not fail the link)  
4. Employee Training dialog — **new separate section/card** only  

**How we keep isolation:**

- New Prisma model + new service module(s) + small new UI components  
- No edits inside `employeeAssignmentTraining.ts`, `employeeDefaultTraining.ts` / `assertEmployeeTrainingsComplete`, or Onboarding Agreement logic  
- Do not add Client Training into Master readiness badges  
- Link/create assignment API response stays successful even if training email fails  

If a change would alter any row above, **stop** — extract Client Training further instead.

---

## Hard rules from plan review (must follow)

These close real collisions with existing code. Treat as requirements, not suggestions.

### H1 — Hook the real link path (`targetType: 'job'`)

Production Link uses `createEmployeeAssignmentRequest` with `targetType: 'job'` (`EmployeeAssignmentRequest.tsx`). Job assignments auto-approve.

**Do NOT** reuse or extend:

- `backend/src/services/employeeAssignmentTraining.ts` (Marketing `targetType: 'client'` only; text message; no Active Client PDF)
- `EmployeeAssignment.trainingMessage` / `trainingCertificateDocumentId` for this feature
- `EmployeeTraining` model / Ontario–WHMIS default training rows

**Do:** new table + dedicated service; trigger after successful **job** placement/link create.

### H2 — Step 2 data must come from matching jobs (or on-select fetch)

`LinkClientJobFields` builds clients from **matching jobs**, not Active Client list payloads. Matching currently selects `activeClient: { id, name }` only (`employeeJobMatching.ts`).

**Required:** either

- extend matching-jobs `activeClient` select with training summary + previewable doc id, **or**
- fetch Active Client training detail when client is selected in the dialog.

Extending only `activeClientsApi` list is **not** enough for Step 2.

### H3 — Active Client document storage is new work

Today Active Client create/PATCH is JSON-only; no file fields on `ActiveClient`.

**Required before Step 1 ships:**

- Schema fields (or child table) for `clientTraining`, document storage key/meta
- Upload path (prefer: upload-to-R2 then id on create/update — match employee document patterns)
- Agency-scoped **GET/preview** for the **client template** document (employee document download cannot serve this)

### H4 — Step 4 UI: separate section, not Master-gated list

`EmployeeTrainingDialog` is Ontario 4 Steps + WHMIS (Master approval gate). Client training is **post-placement paperwork**.

**Required:**

- Separate card/section in that dialog (or sibling panel), distinct copy/status
- Do **not** store client-training rows in `EmployeeTraining`
- Do **not** fold into `assertEmployeeTrainingsComplete` / Master readiness

### H5 — Email is best-effort; upload must still work

Job-link create does **not** require employee email today.

**Required:**

- Missing email / SendGrid failure → **link still succeeds**; create pending training record with `sentAt = null`
- UI toast/warning when email skipped or failed
- **Upload signed doc allowed even if never emailed** (do not copy `EmployeeTrainingForm`’s `if (!sent) return` guard)
- Prefer existing training outbound helper pattern (`resolveTrainingOutboundSender` / fail-closed domain errors), not a raw one-off `resolveOutboundUserSender` call
- Attach file or authenticated download link; define size limit (CRM email ~30MB pattern)

### H6 — Lifecycle keyed to assignment / placement

Placements: only one active link path in UI when already placed; new placement deactivates others; end clears active work.

**Required data rules:**

- Pending/complete record keyed to **`assignmentId` (job assignment)** + `employeeId` + `activeClientId`
- Unique: one open client-training record per assignment
- On end placement / deactivated assignment: keep history; hide Upload on inactive unless product says otherwise
- Re-link to same/new client → **new** pending row for the new assignment (do not reopen old complete unless product says so)

### H7 — Edit Active Client is in scope for v1

`ActiveClientFormDialog` is create **and** edit. Shipping create-only leaves all existing clients unable to set training.

**Required v1:** same checkbox + document (replace document) on edit. Define what happens to pending employee rows when template is replaced (minimum: new links use new template; already-sent rows keep their snapshot or current client file — decide in product section).

### H8 — Validation when checkbox is on

If `clientTraining === true` → require document (create and edit). Prevent empty Preview/email.

### H9 — Permissions

| Action | Gate (existing pattern) |
|--------|-------------------------|
| Set training on Active Client | `jobs:write` (same as Active Client write) |
| Link / email / upload signed / resend | `employees:write` |

**v1 default:** any user with `employees:write` (in scope) may upload/resend — not linker-only. Act-as: attribute with `effectiveActorId`; scope via existing agency helpers.

### H10 — Resend on Step 4 surface

Entry label is “Resend / Upload”. Client-training card needs **Resend** (re-send client template email as current actor) in addition to Upload + Preview.

### H11 — Document type / metadata

If storing signed file as `EmployeeDocument`, do **not** rely only on shared `training_certificate` without distinguishing metadata (e.g. dedicated type or `kind: 'active_client_training_signed'`). Audits must separate Ontario/WHMIS certs from client-signed training.

---

## Current touchpoints

| Layer | Path |
|-------|------|
| Add/Edit Active Client | `ActiveClientFormDialog.tsx`, `activeClientsApi.ts`, `backend/src/routes/activeClients.ts` |
| Link modal | `LinkClientJobDialog.tsx`, `LinkClientJobFields.tsx`, `EmployeeAssignmentRequest.tsx` |
| Matching jobs | `backend/src/services/employeeJobMatching.ts` |
| Job assignment create | `backend/src/services/employeeAssignments.ts` (`targetType: 'job'`) |
| Employee Training UI | `EmployeeTrainingDialog.tsx` (host only — separate section) |
| Email | `email.ts`, `trainingOutboundSender.ts`, attachment patterns in `emails.ts` |
| Avoid | `employeeAssignmentTraining.ts`, Marketing Client assignment training columns |

---

## Step 1 — Capture on Add/Edit Active Client

Checkbox **Client training** → if checked, **Document** → persist on Active Client (+ R2 upload).

| Field | Meaning |
|-------|---------|
| `clientTraining` | Client requires training |
| `trainingDocument*` | Client’s required training file |

---

## Step 2 — Show on Link to Client & Job

After Active Client selected (data from matching jobs or fetch): if training → show block + **Preview** of **client template**. Else hide.

---

## Step 3 — Email after successful job link

| Rule | Detail |
|------|--------|
| Trigger | Job-link (`targetType: 'job'`) succeeds **and** client has training |
| Side effect | Create pending employee–assignment client-training record |
| To | Employee email if present |
| From | Linking actor via training outbound sender + SendGrid |
| Blocking | **None** |

---

## Step 4 — Upload signed / Preview / Resend / complete

| Rule | Detail |
|------|--------|
| Where | Employee Training dialog — **separate Client training section** |
| Actions | **Resend**, **Upload** signed doc, **Preview/View** signed doc |
| Complete | Upload sets status complete |
| Job start | Unaffected |

Two documents stay distinct: client template (Active Client) vs signed proof (employee–assignment record).

---

## Suggested record (names TBD)

```ts
{
  id: string;
  employeeId: string;
  activeClientId: string;
  assignmentId: string;         // job assignment — primary lifecycle key
  status: 'pending' | 'complete';
  sentAt?: Date | null;
  sentByUserId?: string | null;
  signedDocumentId?: string | null;
  completedAt?: Date | null;
  completedByUserId?: string | null;
}
```

---

## Full flow diagram

```text
[Step 1] Add/Edit Active Client → training? → document (R2)
                │
                ▼
[Step 2] Link to Client & Job (matching jobs carry training summary)
                │ show training + Preview (client template)
                ▼
[Step 3] targetType:job link succeeds
                ├── pending ClientTrainingAssignment row
                ├── best-effort SendGrid email (non-blocking)
                └── placement proceeds
                ▼
[Step 4] Employee Training dialog (separate section)
                ├── Resend template email
                ├── Upload signed document (even if never sent)
                ├── Preview signed document
                └── status → complete
```

---

## Product decisions (locked)

1. Template replace → snapshot: pending rows keep the **document they were sent** (not live latest).
2. Ended placement → **Upload still allowed**.
3. Email → **attachment** (PDF in inbox).
4. Status → `pending` / `signed` (UI: Pending / Signed).
5. Email copy → sensible **default for v1**, e.g. subject `Required client training — {Client Name}`; body asks employee to complete the attached training and return the signed copy to their recruiter.

---

## Plan review residual risks

- SendGrid authenticated-domain / act-as from-address failures
- Private R2 keys must never be emailed as bare permanent URLs
- Inactive Active Clients still appearing via open jobs in matching
- Concurrent placements if `allowCreate` rules change later
