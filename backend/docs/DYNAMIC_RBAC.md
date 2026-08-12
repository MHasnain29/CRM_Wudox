# Dynamic RBAC

## Auth payload (login / me)

- `permissions` — effective permission keys from `rbac_roles` + `role_permissions`
- `dataScopeLevel` — `own` | `team` | `agency` | `global` (from role’s `scope_level`)
- `roleLabel` — display name from `rbac_roles.name`
- `user.role` — role **key** (e.g. `sales_associate`, `hasnain_ass`)

After changing permissions in **Settings → Roles**, users must **log out and log back in**.

## Three uses of “role”

| Use | Source | Example |
|-----|--------|---------|
| **Access** (pages, API) | `permissions` + `dataScopeLevel` | `requirePermission('leads:assign')`, `pipeline:read`, `useCanViewTeamScope()` |
| **Role dropdown** (assign to user) | `GET /api/v1/roles/assignable` + `filterRolesForActor` | Super admin sees all; sales manager sees only `sales_associate` |
| **Form UX** (reporting manager, location) | Role key heuristics in Users form | Unchanged from legacy CRM |

## System roles (built-in)

There are **13** system roles (`super_admin` through `database_manager`). Defaults and scope levels: **`backend/docs/SYSTEM_ROLES_RBAC.md`**.

Source file: `backend/src/config/systemRolePermissions.ts`. Re-apply defaults: `npm run prisma:seed-rbac`.

## Custom roles

1. Create role in **Settings → Roles** (key must be lowercase, e.g. `hasnain_ass`).
2. Assign permissions and scope level.
3. Run `npm run prisma:seed-rbac` only when updating seed catalog; UI roles persist in DB.
4. `users.role` is `varchar` — no Prisma enum migration per custom role.
5. Create user with that role; backend sets `roleId` from `rbac_roles`.

## API

- `GET /roles/assignable` — flat active roles (`users:read`)
- `GET /roles` — tree (`roles:read`)
- `POST /roles` — create custom role (`roles:create` or `roles:write`)
- `DELETE /roles/:id` — deactivate custom role only (`roles:delete` or `roles:write`; no users, no active children)
- User create/update validates role key against active `rbac_roles`

**Settings → Roles:** Directors with `roles:write` can create and delete custom roles. System roles cannot be deleted.

## Frontend helpers

- `frontend/src/lib/access.ts` — permission and scope hooks
- `frontend/src/hooks/useAssignableRoles.ts` — role dropdown options
- `frontend/src/lib/roleLabels.ts` — labels, actor filter, performance-target role list

## Notifications (backend)

Recipients use **permissions** or **user links**, not hardcoded role names:

| Event | Recipients |
|-------|------------|
| Client pending / created (agency) | `clients:approve` — `getClientApproverUserIds()` |
| Client pending after manager OK | Same + submitter |
| Proposal review / PandaDoc live refresh | `proposals:review` — `proposalReviewerIds()` |
| Lead reassignment request | `leads:reassign_approve` |
| Proposal submit / extension | Lead owner `reportingManagerIds` |
| Daily report email | Team+ scope — `getUserIdsWithMinScope(..., 'team')` |
| Bug reports (submit) | `bug_reports:submit` — header button, `POST /bug-reports` |
| Bug reports (admin page) | `bug_reports:read` — sidebar, list/close |
| Settings requests | `settings:write` |

Grant the permission on a custom role in **Settings → Roles** to include those users in alerts.

## Pipeline permissions

| Permission | Controls |
|------------|----------|
| `pipeline:read` | Sidebar **Pipeline** link, `/pipeline` page, lead list API for the board |
| `pipeline:write` | Drag leads between stages on the pipeline board |
| `pipeline:configure` | **Settings → Pipeline** tab (agency stage setup) |

Pipeline **view** requires `pipeline:read` only — `leads:read` and agency/team scope do **not** grant the Pipeline page or sidebar link.

Pipeline **move** (drag between stages) requires `pipeline:write` **or** `leads:write` (legacy). View-only roles can use `pipeline:read` without either write permission.

**Settings → Roles** saved permissions are authoritative for system and custom roles (unchecked `pipeline:write` / `leads:write` are not restored from static defaults). Users must **re-login** after role permission changes.

**Proposals** (`proposals:read`, `proposals:write`, `proposals:review`) do **not** control pipeline drag. Dragging to **Send Proposal** requires `proposals:write`; other stage moves use `pipeline:write` or `leads:write`.

## Users permissions

| Permission | Controls |
|------------|----------|
| `users:directory` | Sidebar **Users** link and `/users` route only |
| `users:read` | `GET /users`, `GET /users/hierarchy`, `GET /users/locations` — list and hierarchy on the Users page |
| `users:write` | Create user, edit fields, targets, admin password/reset, managed agencies |
| `users:delete` | Deactivate / reactivate (`isActive`); legacy roles with only `users:write` may still toggle status |

Assignee dropdowns and filters elsewhere use `users:read` on `GET /users` without requiring `users:directory`.

Frontend helpers: `canAccessUsersDirectory`, `canViewUsersList`, `canWriteUsers`, `canDeleteUsers` in `frontend/src/lib/access.ts`.

## Proposals permissions

| Permission | Controls |
|------------|----------|
| `proposals:read` | List/view proposals (with write or review, grants module access) |
| `proposals:write` | Submit proposals, upload attachments, document edits, awaiting-client decisions |
| `proposals:review` | Approve/reject, activate, extension decisions, send-to-client |

Sidebar and `/proposals` require at least one of `proposals:read`, `proposals:write`, or `proposals:review`. Manager/reviewer UI uses `proposals:review` (not team scope alone).

## Calls vs voice

| Permission | Controls |
|------------|----------|
| `calls:read` | Calls page, `GET /voice/calls` (or `voice:use`) |
| `calls:write` | Log/edit calls, `PATCH /voice/calls/:id` (or `voice:use`) |
| `voice:use` | Twilio token, place call, in-app dialer from leads/pipeline |

## Route guards

`App.tsx` uses `PermissionRoute` so deep links match sidebar permissions (clients, leads, tasks, meetings, proposals, settings, reports, etc.).
