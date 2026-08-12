# System roles — RBAC reference

All **14** built-in roles are defined in `prisma/rbacDemoData.ts` (`ROLE_HIERARCHY`) and seeded by `npm run prisma:seed-rbac`.

Default permission grants live in **`backend/src/config/systemRolePermissions.ts`** (single source of truth for seed + static API fallback).

## How effective permissions are resolved

| Situation | Effective permissions |
|-----------|----------------------|
| **super_admin** | Full catalog (always); middleware also bypasses checks |
| **System/custom role with DB `role_permissions` rows** | **DB only** — unchecked boxes in Settings → Roles are removed (no static union) |
| **Role missing in DB or zero grants** | Static matrix from `systemRolePermissions.ts` |

After changing grants in **Settings → Roles**, users must **log out and log back in**.

**Warning:** `npm run prisma:seed-rbac` **replaces** all system-role `role_permissions` with the defaults in `systemRolePermissions.ts`. UI customizations are lost until you save them again in Settings.

**Settings → Roles:** users with `roles:write` can use **Reset system roles to defaults** (same result as seed for permissions on the 14 system roles; custom roles unchanged).

## Hierarchy and data scope

| Role | Scope | Parent |
|------|-------|--------|
| super_admin | global | — |
| dev_team | agency | super_admin |
| director | agency | super_admin |
| company_director | agency | director |
| it | agency | super_admin |
| sales_manager | team | company_director |
| sales_associate | own | sales_manager |
| sales_executive | own | sales_manager |
| recruitment_manager | team | director |
| recruiter | own | recruitment_manager |
| sr_recruiter | own | recruitment_manager |
| operations_manager | team | director |
| data_entry_specialist | own | director |
| database_manager | global | director |

**Database Manager (org-global):** Created only on **Super Users** by Super Admin (`subCompanyId` null). Submits clients to the **global database** via org approval (`database_client_add` / `database_client_import`); route configured under **Settings → Approvals → Global Database** (require approval with Director/OM route, or **direct add** with bypass). Destination mode (`global` / `agency` / `both`) is configured separately under **Database Manager — add & import destination**. Productivity report: `GET /reports/database-managers`.

**Super Users screen roles** (`super_admin`, `director`, `company_director`, `operations_manager`): A separate org setting **Super Users — add & import destination** (`global` / `agency` / `both`) controls whether Add Client and CSV import go to the global database queue or an agency. Agency path always respects **Client Visibility** (Settings → Client Visibility per agency) before org-wide promotion, including for director/super_admin.

## Default grants summary

| Role | Pipeline move | Proposals | Users admin | Agencies cross-org | Roles admin |
|------|---------------|-----------|-------------|-------------------|-------------|
| super_admin | yes | full | full | global + cross | full |
| director | yes | full | write + directory | cross_org | full |
| company_director | yes | full | write + directory | — (single agency) | full |
| sales_manager | yes | review + write | write + directory | — | — |
| recruitment_manager | yes | — | write + directory | — | — |
| sales_associate | yes | — | read only | — | — |
| sales_executive | yes | — | read + directory | — | — |
| recruiter / sr_recruiter | yes | — | read + directory | — | — |
| operations_manager | yes | review | read + directory | cross_org | — |
| data_entry_specialist | yes | — | read + directory | — | — |
| database_manager | — | — | — | — | — |
| dev_team | — (read pipeline) | — | read + directory | — | read |
| it | — (read pipeline) | — | read + directory | — | read |

**Pipeline move** requires `pipeline:write` or `leads:write`. **Pipeline view** requires `pipeline:read`.

**sales_associate** baseline includes `leads:write` and `pipeline:write`. To block pipeline drag (as in your test), uncheck both in Settings → Roles, save, then re-login.

## Associate test role (custom)

Custom roles (e.g. `hasnain_ass`) use **DB grants only** — never merged with `sales_associate` static defaults. Clone grants from **sales_associate** in the Roles UI, then remove what you do not want.

## Related docs

- `backend/docs/DYNAMIC_RBAC.md` — auth payload, route guards, pipeline/users/proposals
- `docs/SYSTEM_UNDERSTANDING.md` — roles overview
