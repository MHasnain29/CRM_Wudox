# Roles and access levels

Implements RBAC. Roles are stored in the `users` table (`role` = UserRole enum). JWT includes `role`; the API checks permissions and applies data scope.

---

## Roles (UserRole enum)

| Role | Label | Access level (what they see) |
|------|--------|------------------------------|
| **super_admin** | Super Admin | **Org-global** (no home agency): all data across all agencies; full permissions. |
| **dev_team** | Dev Team | Read-most + settings (support/debug); no write on users/clients/leads. |
| **director** | Director | **Org-wide** (no home agency): full access across agencies via cross-org scope. |
| **sales_manager** | Sales Manager | Same as director but **no user write, no settings write**; typically see their team's data. |
| **recruitment_manager** | Recruitment Manager | Same as director; recruitment-focused (jobs, employees, leads). |
| **sales_associate** | Sales Associate | Own clients, leads, calls, tasks, meetings; can use voice. No users list, no settings, no analytics. |
| **sales_executive** | Sales Executive | Same as Sales Associate. |
| **recruiter** | Recruiter | Clients (read), leads, jobs, employees, tasks, meetings, voice. |
| **sr_recruiter** | Senior Recruiter | Same as Recruiter + client write. |
| **data_entry_specialist** | Data Entry Specialist | **Org-wide** (no home agency): clients, leads, calls, tasks (read/write). |
| **database_manager** | Database Manager | **Org-global** (no agency): global client DB read/write; client adds use org approval policy (**require approval** or **direct add**); created on Super Users page only. |
| **operations_manager** | Operations Manager | **Org-wide** (no home agency): broad read/write; assigned agencies via Super Users; users read, settings read; no user write. |

### Operations Manager — agency assignments (production)

Operations Managers have `subCompanyId: null` and `agencies:cross_org`, but **list routes only resolve agency context from `operations_manager_sub_companies` rows**. Without at least one assignment, `resolveAllowedSubCompanyIds` returns `[]` and tasks/emails/calls return **403 Agency context required**.

- **Assign agencies:** Settings → Super Users → edit the OM → assign Toronto/Vancouver (or other agencies). This writes `operations_manager_sub_companies` (`userId`, `subCompanyId`).
- **Dev seed:** `backend/prisma/seed.ts` assigns the demo OM (`operations@nastaffing.com`) to both seeded agencies.
- **Existing production OMs:** Super Admin must add agency rows manually; there is no automatic backfill from `cross_org` alone.
- **List API:** Tasks, emails, calls, meetings, and follow-ups use `resolveListAgencyScope` so Director/OM do not need a home `subCompanyId` when allowed agencies exist.
| **it** | IT | Read-most + settings read/write (support). |

---

## Permissions (resource:action)

Used by middleware `requirePermission('resource:action')` and returned in **GET /auth/me** and **GET /users/me** as `permissions: string[]` so the frontend can show/hide features.

- **users:** read, write, delete  
- **clients:** read, write, contacts:edit (edit contact fields on client sheet; default Super Users only), delete, manager_recommend, approve, ownership 
- **leads:** read, write, assign, manager_recommend, approve, reassign, reassign_approve  
- **proposals:** read, write, review, manager_recommend  

## Approval routes

**User guide:** [APPROVAL_CHAINS_GUIDE.md](./APPROVAL_CHAINS_GUIDE.md) — how to configure Settings and use pending queues.

Per-agency explicit routes (1–5 roles per workflow): **Settings → Approvals** (`AgencyApprovalPolicy`). Forward/final capabilities are synced automatically from each role’s position in the route (`RoleApprovalCapability`). Grant approval permission keys per role under **Settings → Roles → Permissions**.

Unified API: `POST /api/v1/approvals/:workflow/:entityId/forward|approve|reject`. Metadata: `GET /api/v1/approvals/metadata`.
- **calls:** read, write  
- **tasks:** read, write  
- **meetings:** read, write, add_participants (invite internal staff; granted to all roles by default; toggle in Settings → Roles)  
- **jobs:** read, write  
- **employees:** read, write  
- **analytics:** read  
- **settings:** read, write  
- **voice:** use (in-app calling)

---

## Data scope (what they see)

- **Super Admin:** No scope; can see all sub-companies (users list not filtered by sub-company).  
- **Director / Dev team:** Scoped to their **sub-company** (e.g. users list filtered by `subCompanyId`).  
- **Managers (sales_manager, recruitment_manager, operations_manager):** Sub-company scope; in future can be narrowed to **team** (self + `reportingManagerIds`) when we use that in list queries.  
- **Associates / Recruiters / etc.:** Sub-company scope; for **own** records we use `ownerId` (e.g. leads, tasks) where the schema has it.

Current route behavior:

- **GET /users:** Requires `users:read`. Non–super_admin users only see users in their `subCompanyId`.  
- **GET /clients:** Requires `clients:read`. (Client table has no sub_company_id in current schema; scope can be added later if needed.)  
- **Voice routes:** Require `voice:use`.

---

## Auth responses (role + permissions for UI)

- **POST /auth/login** returns: `user`, `token`, `refreshToken`, `expiresIn`, **`roleLabel`**, **`permissions`** (array of permission strings).  
- **GET /auth/me** and **GET /users/me** return the user object plus **`roleLabel`** and **`permissions`**.

Frontend can:

- Show the current role as `roleLabel`.  
- Show/hide menus and actions using `permissions` (e.g. show "Users" only if `permissions.includes('users:read')`, show "Settings" only if `permissions.includes('settings:read')`).

---

## Daily Agenda (`GET /api/v1/daily-activity/*`)

Unified feed of tasks, meetings, follow-ups, leads, proposals, calls, emails, notes, requests, approvals, reminders, notifications, and activity logs.

| Viewer role | Visible users |
|-------------|----------------|
| Associates, recruiters, etc. | Own records only |
| `sales_manager`, `recruitment_manager` | Self + users with `reportingManagerIds` containing the manager |
| `director`, `super_admin`, `operations_manager` | Full agency tree (managers → associates; orphans under “Unassigned”) |
| `dev_team`, `it` | All agency users (flat list in hierarchy panel) |
| `database_manager` | Own records only (no agency hierarchy) |

Item types are gated by the viewer’s existing `permissions` (e.g. no `employees:read` → no employee approval rows). Managers cannot pass arbitrary `userId` on `/items` or `/summary` outside their visible set.

---

## Adding a new route or feature

1. Choose the permission(s) (e.g. `leads:write`).  
2. Add `requirePermission('leads:write')` (or multiple) after `authenticate` on the route.  
3. In list endpoints, apply data scope using `getDataScope(req.user)` and filter by `subCompanyId` / `ownerId` / `allowedUserIds` as needed.  
4. Update this doc and `src/config/permissions.ts` if you add a new permission or change role mapping.
