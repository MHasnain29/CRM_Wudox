# Approval routes — how to use

This guide is for **admins** configuring approvals and **managers** acting on pending items.

Approval is configured in one place:

1. **Settings → Approvals** — bypass or ordered route (1–5 roles) per workflow. Saving sets each role’s forward/final capability from its step position.
2. **Settings → Roles → Permissions** — grant keys such as `leads:approve` and `clients:manager_recommend` for roles in the route.

Routes are **explicit role lists** (1–5 roles). You can skip middle roles (e.g. Associate submits → Director approves with no Manager step).

---

## First-time setup (dev / new environment)

From the `backend` folder:

```bash
npx prisma migrate deploy
npm run prisma:seed
```

`prisma:seed` includes RBAC, agency approval policies, and workflow demo data. You only need the separate commands below if repairing an existing database without a full re-seed:

```bash
npm run prisma:seed-rbac
npm run prisma:seed-approval
```

Then restart the API. Without seed data, approval capabilities in the UI may show `none` and queues will not route correctly.

To restore built-in roles after changes: **Settings → Roles → Reset system roles to defaults** (permissions + approval capabilities).

---

## Configure approval routes (agency)

**Settings → Approvals**

For each workflow:

| Setting | Meaning |
|--------|---------|
| **Require approval** off | Bypass — action applies immediately when the user is allowed. |
| **Require approval** on | Build an ordered route of 1–5 roles. Earlier roles **Forward**; the last role **Final approves**. |
| **Allow lead self-assign** | When off, associates must submit a **lead request** instead of creating a lead directly. |

**Examples**

- Lead request, skip manager: route = `Company Director` or `Director` only.
- Client add: route = `Sales Manager` → `Company Director` (per agency).
- No approval: toggle **Require approval** off.

**Route order (junior → senior)**

Each step must be **lower** in the org than the next step. The UI and API validate this using **Settings → Roles** hierarchy (parent links). Steps do not need to be direct parent/child — you can skip levels (e.g. Associate → Director). Invalid examples: Director before Sales Manager; Sales Manager before Recruitment Manager (sibling branches).

Save when done. This applies to the current agency (sub-company).

---

## Configure roles (who can act at each step)

**Settings → Roles** — select a role, then use the three tabs:

### 1. Data access

- **Parent role** — used for org structure and data scope (not for building approval routes).
- **Data scope** — who sees which records (`own`, `team`, `agency`, `global`).
- Users with scope **above `own`** (team/agency/global) bypass the approval queue for their own submissions.

### 2. Permissions

Grant the permission keys needed for approval actions, for example:

- `clients:manager_recommend` — forward client pending items
- `clients:approve` — final-approve clients
- `leads:manager_recommend` / `leads:approve` — lead workflows
- `proposals:manager_recommend` / `proposals:review` — proposals

### 3. Permissions (Roles tab)

Grant the permission keys shown on the Approvals screen for each role in a route (e.g. `leads:manager_recommend` to forward, `leads:approve` to final-approve).

---

## Daily use (managers)

### Actions

- **Forward** — move to the next role in the route.
- **Approve** — complete the workflow (last step in the route).
- **Direct approve** — Company Director (per-agency final approver), org **Director**, or **Super Admin** may final-approve while the item waits on a junior step — including when they are not listed in the route. Intermediate steps are skipped. History shows **Directly approved by {name} on {date}**.
- **Reject** — cancel the pending action.

Buttons appear only when it is your turn and your role + permissions allow the action.

### Where queues appear

| Workflow | Where it shows up |
|----------|-------------------|
| Client manual add / edit | Clients → Pending |
| Client CSV import | Pending import rows |
| Lead request | Leads → Pending Review |
| Lead extension | Leads → Lead Extensions |
| Lead reassignments | Leads → Reassignments |
| Proposal review / extension | Proposals |

---

## How the two settings work together

Example: **Client manual add**, route `Sales Manager` → `Company Director`.

```
Sales Associate (submits)
    → Sales Manager (forward_only + clients:manager_recommend)
    → Company Director (forward_final + clients:approve)
```

Company Director or org Director may **Direct approve** before the manager forwards. Super Admin may direct-approve any pending item.

Example: **Lead request**, route `Sales Manager` only — Company Director or Director can direct-approve without a manager forward.

---

## Troubleshooting

| Problem | What to check |
|--------|----------------|
| Cannot save route | Each role must exist and be active; route must go junior → senior per Settings → Roles hierarchy. Re-save after adding a new custom role to the route. |
| User cannot see Forward/Approve | Role actor mode; permissions; item must be at their step in the route. |
| Wrong step count in UI | Save **Settings → Approvals**; pending items resync to the new route. |

---

## API reference (for developers)

- `GET /api/v1/approvals/metadata` — workflows, permission keys, assignable roles.
- `GET/PUT /api/v1/settings/approval-policy` — agency approval routes.
- `GET/PUT /api/v1/roles/:id/approval-capabilities` — per-role actor modes.
- `POST /api/v1/approvals/:workflow/:entityId/forward|approve|reject` — act on an item.

See also [ROLES_AND_ACCESS.md](./ROLES_AND_ACCESS.md).
