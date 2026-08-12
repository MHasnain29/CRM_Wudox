# Recruitment Jobs Lifecycle — Active Client → Job → Placement → Close

End-to-end flow of the recruitment domain: create an active client, post a job,
place employees, manage the roster, and close (or reopen) the job.

All endpoints are under `/api/v1`, protected by `authenticate` + permissions
`jobs:read` / `jobs:write` (placements also touch `employees:*`). All data is
agency-scoped via `subCompanyId` (agency picker / act-as / linked accounts).

---

## 1. Active Client

The client the agency staffs for. Jobs must belong to one.

| Action | Endpoint | Service | UI |
|---|---|---|---|
| List / search | `GET /active-clients` | `services/activeClients.ts` | `pages/ActiveClients.tsx` |
| Create | `POST /active-clients` | `createActiveClient` | `ActiveClientFormDialog` |
| Update | `PATCH /active-clients/:id` | `updateActiveClient` | `ActiveClientFormDialog` |
| Details | `GET /active-clients/:id` | `getActiveClientById` | `ActiveClientDetailsSheet` |
| Delete | `DELETE /active-clients/:id` | `deleteActiveClient` | `DeleteActiveClientDialog` |

From a client's details sheet you can jump to its jobs (`/jobs?clientId=...`).

## 2. Job

| Action | Endpoint | Service (`services/jobs.ts`) | UI |
|---|---|---|---|
| List / filter | `GET /jobs` | `listJobs` | `pages/Jobs.tsx` + `JobsFilterBar` |
| Create (blank or template) | `POST /jobs` | `createJob` | `CreateJobDialog` |
| Edit | `PATCH /jobs/:id` | `updateJob` | `CreateJobDialog` (edit mode) |
| Change status | `PATCH /jobs/:id/status` | `updateJobStatus` | `JobDetailsSheet` Actions |
| Delete | `DELETE /jobs/:id` | `deleteJob` | details sheet |

- Statuses: `draft → open → closed | filled` (and back to `open` via Reopen).
- Capacity = `openPositions × (1 + backupPercentage/100)` — main roster plus backups.
- `draft` → **Publish Job** sets it `open`. Only `open` jobs accept placements.

## 3. Placing employees (two entry points, different approval)

Employees must be `approvalStatus: approved` before any placement.

| Target | Approval |
|---|---|
| **Job** (`targetType: 'job'`) | Instant — create then **auto-finalize** (no RM wait). Primary → `workStatus: active`, backup → `scheduled`. |
| **Active client** (`targetType: 'client'`) | Goes through workflow `employee_assignment` until RM approves. Requires full placement details + email to candidate first. |

### Entry point A — from the job (`JobEmployeesDialog`)

The job's **Manage Employees** button. Picking an employee (as **Primary** or
**Backup**) calls `POST /employees/:id/assignments` with
`{ targetType: 'job', jobId, isBackup }` and activates immediately.

Roster management on already-placed employees stays direct:

| Action | Endpoint | Service (`services/jobPlacements.ts`) |
|---|---|---|
| Toggle main/backup | `PATCH /jobs/:id/assignments/:assignmentId` | `toggleJobAssignmentRole` |
| Move to another job | `POST /jobs/:id/assignments/:assignmentId/move` | `moveJobPlacement` |
| End one placement | `POST /jobs/:id/assignments/:assignmentId/end` | `endJobPlacement` |

### Entry point B — from the employee (`LinkClientJobDialog` / `EmployeeAssignmentRequest`)

Employee details / Master → link to **Active Client + Job**. Current UI posts
`targetType: 'job'` (instant roster). Backend still accepts `targetType: 'client'`
for pending RM approval (used by dashboard + demo seed).

### Job path (instant)

1. `POST /employees/:id/assignments` → `createEmployeeAssignment`
   (`services/employeeAssignments.ts`) creates the row then calls
   `finalizeEmployeeAssignmentApproval` when `targetType === 'job'`.
2. Creates the `JobAssignment` roster row, sets `workStatus` to `active`
   (primary) or `scheduled` (backup).

### Client path (RM approval)

1. Same create endpoint with `targetType: 'client'` + placement details →
   `submitEntityForApproval` (`employee_assignment`).
2. Approval → `finalizeEmployeeAssignmentApproval`: marks the row `approved` +
   active, sets `workStatus: active`. Rejection →
   `finalizeEmployeeAssignmentRejection`.

Guards: no duplicate pending request per target; job targets are refused when
the job is `closed`/`filled`; approving a stale request returns 400 "Job is
closed" if the job closed meanwhile, or "Job roster is at capacity" if it
filled up.

---

## Demo seed (recruitment only)

Wipe and reseed Active Clients, Jobs, Employees, and placements against existing
agencies/users (does not touch sales/leads):

```bash
cd backend && npm run prisma:seed-recruitment
```

Requires a prior full seed (`npm run prisma:seed`) so agencies and demo users
exist. Covers Draft / Needs Action / Pending / Master / Active / history, plus
pending **client** assignment cards for the RM dashboard. Job placements in the
seed are already approved (matching instant job flow).

Rules-aligned fixtures:

- Every job is `external` and linked to an Active Client (`activeClientId`).
- Rosters respect capacity `ceil(openPositions × 1.7)` with `isBackup` on both
  job roster and employee assignment rows.
- Submitted pending + approved employees include required docs, agreement, and
  completed default trainings (4 Steps + WHMIS) so RM can approve via the live
  path. One pending demo (`blake.pendinggate.demo@mail.demo`) leaves trainings
  incomplete to show the training gate.

## 4. Working state

- Employees page **Master** tab = `workStatus: none` (available).
  **Active/Scheduled** reflect current placements.
- Employment history per employee: `GET /employees/:id/assignments` →
  `EmploymentHistoryPanel`.
- End a single placement anytime (rating 1–5 + end reason, notes required for
  "other"): `EndPlacementDialog` (employee side) or per-row end in
  `JobEmployeesDialog`. The employee returns to `workStatus: none`.

## 5. Closing a job

Two entry points, one dialog (`EndJobPlacementsDialog`):

- **Jobs table**: X button on `open`/`draft` rows (needs `jobs:write`).
- **Job details sheet**: **Close** or **Mark Filled** under Actions.

The dialog collects an **end reason + star rating** (+ optional notes) for every
active assignee, then calls:

- Roster not empty → `POST /jobs/:id/end-placements` → `endAllJobPlacements`
- Roster empty → `PATCH /jobs/:id/status` → `updateJobStatus`

Both run one transaction that:

1. Deactivates all `JobAssignment` roster rows.
2. Ends each active `EmployeeAssignment` (`endedAt`, `endReason`, `rating`) —
   preserved as employment history.
3. Resets every assignee to `workStatus: none` (back to the Master list).
4. **Auto-rejects all pending requests** targeting the job
   (`status: rejected`, `rejectionReason: 'Job was closed'`).
5. Sets the job `closed`/`filled` with `closedAt`, zeroes counters.

Closed/filled jobs refuse new placements, moves, and requests (400 errors).
`updateJobStatus` refuses to close a job that still has an active roster unless
called through the end-placements flow (409 "End all placements first").

## 6. Reopen

`JobDetailsSheet` → **Reopen Job** (shown for `closed`/`filled`) →
`PATCH /jobs/:id/status { status: 'open' }` → clears `closedAt`. The job accepts
placements again; previously rejected requests stay rejected (submit new ones).

---

## 7. Notifications

All flow events create in-app notifications (bell icon; templates editable per
agency under **Settings → Notifications → Jobs / Approvals**). Logic lives in
`services/jobFlowNotifications.ts`; the actor never gets notified about their
own action.

| Event | Who is notified | Event key |
|---|---|---|
| Assignment request submitted (pending) | Users of the chain's approver role | `approval_employee_assignment_submit` |
| Request approved | Requester | `approval_employee_assignment_approved` |
| Request rejected | Requester | `approval_employee_assignment_rejected` |
| Pending requests auto-rejected on close | Each requester ("Reason: Job was closed") | `approval_employee_assignment_rejected` |
| Employee placed on roster (direct or approved) | Job creator | `job_placement_added` |
| Placement ended (single or bulk) | Request submitter + job creator | `job_placement_ended` |
| Job closed / marked filled | Job creator | `job_closed` / `job_filled` |
| Job reopened | Job creator | `job_reopened` |

## Quick reference — files

| Layer | Files |
|---|---|
| Backend services | `services/activeClients.ts`, `services/jobs.ts`, `services/jobPlacements.ts`, `services/employeeAssignments.ts` |
| Backend routes | `routes/activeClients.ts`, `routes/jobs.ts`, `routes/employees.ts` |
| Frontend API | `lib/activeClientsApi.ts`, `lib/jobsApi.ts` |
| Pages | `pages/ActiveClients.tsx`, `pages/Jobs.tsx`, `pages/Employees.tsx` |
| Key components | `CreateJobDialog`, `JobDetailsSheet`, `JobEmployeesDialog`, `EndJobPlacementsDialog`, `MoveToJobDialog`, `EmployeeAssignmentRequest`, `EndPlacementDialog`, `EmploymentHistoryPanel` |
