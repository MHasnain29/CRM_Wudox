# Leads and pipeline — behaviour and rules

Single reference for how leads work: relation to clients, agency scoping, access by role, when other agencies can or cannot make a client their lead, and pipeline/stages. Aligns with **docs/SYSTEM_UNDERSTANDING.md** (shared clients, per-agency data).

---

## 1. What a lead is

A **lead** is a **sales opportunity** tied to:

- One **client** (shared DB: same client can be a lead in more than one agency).
- One **agency** (`subCompanyId`): the lead “belongs” to that agency only.
- One **owner** (`ownerId`): the user responsible for the lead within that agency.
- **Pipeline stage** (`stage`): e.g. New Lead, Contact Made, Qualified, Closed Won.
- **Status** (`status`): `open` | `closed_won` | `closed_lost`.
- Optional: `temperature` (hot/warm/cold), `value`, `lastActivity`, `nextFollowUp`, `notes`.

So: **Lead = Client + Agency + Owner + Stage + Status + metadata.**  
Calls, follow-ups, meetings, proposals, documents can be linked to a lead (and are agency-scoped via `subCompanyId`).

---

## 2. Client–lead association

- **Clients are shared** across agencies (one client table; all agencies see the same client list).
- **Leads are per agency.** Each lead row has `clientId` + `subCompanyId` + `ownerId`.
- The **same client** (e.g. Nestle) can have:
  - **One lead in Agency A** (owner = User 1, stage = Qualified).
  - **Another lead in Agency B** (owner = User 2, stage = New Lead).
- So: one client, many possible leads (one per agency that has chosen to work that client as a lead). There is no unique constraint on `(clientId, subCompanyId)` in the schema today: an agency could in theory have multiple open leads for the same client (e.g. different products); business rules can restrict that if needed.

**Summary:** Client is shared; lead is the “we are working this client as an opportunity” record for one agency. Other agencies do not see this lead; they only see the shared client.

---

## 3. Leads are totally agency-level

- **Only the owning agency** “knows” about a lead. List leads = filter by `subCompanyId` (current user’s agency). Other agencies never see another agency’s leads.
- **Within the agency**, who sees which leads is determined by **data scope** and **assignment**:
  - **Director / dev_team:** See all leads in the agency (`subCompanyId` only).
  - **Managers (sales_manager, recruitment_manager, operations_manager):** Agency scope; in practice often “team” (self + reportees); use `ownerId` and/or `reportingManagerIds` to restrict to their team’s leads when that’s the rule.
  - **Associates / recruiters / etc.:** Only **their own** leads (`ownerId = current user`).

So: **leads are agency-level** (other agencies don’t see them), and **within agency** visibility is by role (all vs team vs own).

---

## 4. Lead access: permissions and assignment

### Permissions (from ROLES_AND_ACCESS.md)

| Permission   | Who has it | Meaning |
|-------------|------------|--------|
| **leads:read**  | All roles that touch leads | Can list/view leads (subject to data scope). |
| **leads:write** | Director, managers, sales_associate, sales_executive, recruiter, sr_recruiter, data_entry, database_manager, operations_manager | Can create/update leads (and pipeline stage, status, notes, etc.). |
| **leads:assign** | Director, sales_manager, recruitment_manager | Can **reassign** the lead owner (`ownerId`). A sales manager can assign a lead to a **sales associate** (e.g. a reportee) or **to themselves**. |

- **Restriction by assignment:** List leads must respect data scope: for non–sub-company-wide roles, filter by `ownerId` (and optionally team via `reportingManagerIds`). Detail/update/delete must ensure the user is allowed to see that lead (same scope rules).

---

## 5. Can other agencies make the same client their lead?

**Yes, by default.**  
Because clients are shared and leads are per-agency:

- Agency A can create a lead for Client X.
- Agency B can also create a lead for the same Client X. They don’t see A’s lead; they just see “Client X” and can create “our” lead for X.

So **by default we allow** any agency to create a lead for any client. No FK or unique constraint prevents it.

---

## 6. When *not* to allow another agency to make them their lead

Meeting notes don’t spell out a single rule; the product provides a **lead request** flow. Two common policies:


### Option A — Request-based


- When an associate (or agency) wants to work a client as a lead, they **request** instead of creating a lead directly.
- **LeadRequest:** `clientId`, `requestedById`, `managerId`, `subCompanyId`, `note`, `status` (pending / approved / rejected), `reviewedById`, `reviewedAt`.
- Flow: **POST /leads/:id/request** (or POST “request lead for client”) → creates LeadRequest (pending). Manager **approves** or **rejects** (POST approve/reject). On **approve**, the system creates the lead (or assigns the existing lead to the requester).
- **When not to allow:**  
  - Do **not** create a new lead (or do not show “Create lead”) if policy is “must request first” and there is already a **pending** request for that client in that agency.  
  - Do **not** allow creating a lead for that client in that agency if the request was **rejected** (until a new request is approved).

So: “Other agencies could still make them lead” remains true (they can request); “when not to allow” = when the **request** is pending or rejected under a request-first policy.

### Option B — One active lead per client (global or per-agency)

- **Stricter rule:** Only one “active” lead per client **globally** (or per agency).
- **When not to allow:**  
  - If **global:** Reject “create lead” for Client X if **any** agency already has an open lead for Client X.  
  - If **per-agency:** Reject “create lead” for Client X in Agency B if Agency B already has an open lead for Client X.

Implementation would be a check before create: e.g. `Lead` where `clientId = X` and `status = 'open'` (and optionally `subCompanyId = current agency`). If one exists and policy says “one only”, return 409 or a clear error.

**Recommendation:** Implement **Option A** (lead request + approve/reject) first; add Option B only if the business explicitly wants “one lead per client” (global or per-agency).

---

## 7. Lead pipeline and stages

### Pipeline stages (PipelineStage)

- **id** (e.g. `new_lead`, `qualified`, `closed_won`): used as `Lead.stage`.
- **label**, **color**, **orderIndex**: for UI (kanban, list).
- **isFixed**: typically true for terminal stages (e.g. Closed Won, Closed Lost) so they can’t be removed.
- **subCompanyId**: **optional**; if set, the stage is **agency-specific**; if null, the stage can be treated as **global** (shared across agencies).

So:

- **Per-agency pipeline:** Each agency has its own stages (`subCompanyId` set). Lead stages are only valid within that agency.
- **Global pipeline:** All agencies share the same stages (`subCompanyId` null). Same stage ids everywhere.

### Lead.stage

- Stores the **stage id** (string) from the pipeline (e.g. `qualified`, `closed_won`).
- Moving a lead in the pipeline = update `Lead.stage` (and optionally `status` when moving to closed_won/closed_lost). Only users with `leads:write` (and within data scope) can change stage.

### Pipeline management

- **List stages:** GET pipeline stages for the current agency (filter by `subCompanyId` or global stages).
- **Create/update/reorder stages:** Requires permission (e.g. `settings:write` or a dedicated `pipeline:write`). Only non-fixed stages can be edited/deleted; reorder by updating `orderIndex`.
- **Moving leads:** PATCH lead with new `stage` (and `status` if moving to closed). Enforce `leads:write` and data scope (user can only move leads they’re allowed to see).

---

## 8. Summary table

| Topic | Rule |
|-------|------|
| **Lead belongs to** | One client, one agency (`subCompanyId`), one owner (`ownerId`). |
| **Who sees a lead** | Only that agency; within agency by role (all / team / own). |
| **Can another agency create a lead for the same client?** | Yes, by default (no cross-agency visibility of leads). |
| **When not to allow** | (1) Request-first policy: pending or rejected LeadRequest for that client/agency. (2) Optional: “one active lead per client” (global or per-agency) and one already exists. |
| **Permissions** | leads:read (list/view), leads:write (create/update/stage), leads:assign (reassign owner). |
| **Pipeline** | PipelineStage (id, label, color, orderIndex, isFixed, subCompanyId); Lead.stage = stage id; stages can be per-agency or global. |
| **Assignment** | ownerId = responsible user; only roles with leads:assign can change owner. |

---

## 9. API (implemented)

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/leads | List leads (agency-scoped; data scope: director all, manager team+self, associate own). Query: `page`, `limit`, `status`, `stage`, `clientId`, `ownerId`. |
| GET | /api/v1/leads/pipeline-stages | List pipeline stages for current agency (stages where subCompanyId = agency or null). |
| GET | /api/v1/leads/:id | Lead detail (client, owner, calls, followUps, meetings). Must be in agency and within data scope. |
| POST | /api/v1/leads | Create lead. Body: `clientId`, `ownerId` (optional; default self; if set requires leads:assign), `stage`, `status`, `temperature?`, `value?`, `notes?`, `nextFollowUp?`. Requires leads:write. |
| PATCH | /api/v1/leads/:id | Update lead (stage, status, ownerId, temperature, value, notes, nextFollowUp, lastActivity). Changing ownerId requires leads:assign. Requires leads:write. |

Sales manager (or director / recruitment_manager) can assign a lead to a sales associate or to themselves via PATCH with `ownerId` or on create with `ownerId`.

---

## 10. References

- **backend/prisma/schema.prisma:** `Lead`, `PipelineStage`, `LeadRequest`, `LeadRequestComment`.
- **backend/src/config/permissions.ts:** `leads:read`, `leads:write`, `leads:assign` by role.
- **backend/src/config/dataScope.ts:** subCompanyId, ownerId, allowedUserIds for list/detail scope.
- **backend/docs/ROLES_AND_ACCESS.md:** Role labels and data scope.
- **backend/docs/CLIENT_AGENCY_MODEL.md:** Shared clients, per-agency data.
- **docs/SYSTEM_UNDERSTANDING.md** / schema: Leads table, pipeline_stages, lead_requests, API (GET/POST/PUT leads, request/approve/reject).
