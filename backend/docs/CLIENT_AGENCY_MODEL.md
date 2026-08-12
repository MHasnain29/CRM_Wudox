# Client and agency (sub-company) model

Multiple **agencies** (sub-companies) are overseen by IT Director or Operations Manager. They **share the same clients database**: one global client list. All agency-specific data is scoped so each agency sees only its own.

## Client identity vs DB id

- **DB row id** (`id`, UUID) — Primary key; use as **foreign key** everywhere (e.g. `clientId` in leads, notes, etc.). Do not expose as the “client identifier” to users.
- **Corporate code** (`corporateCode`) — **Business identity** for the client (e.g. `NESTLE`, `COCA_COLA`). Unique, not a FK. Use for display, linking, and “this is the same client across locations.” GET `/clients/:id` accepts either the UUID or the corporateCode.

So: one client row per corporate entity; the row has its own `id` (FK) and a distinct `corporateCode` (identity).

## Multiple locations per client

Clients like Nestle or Coca Cola can have **multiple locations** (same city or different). They share one client row (same `corporateCode`); each physical site is a **ClientLocation** (name, address, city, region, postalCode, country, isPrimary). So you can tell that several locations belong to the same client.

## Shared vs agency-scoped

| Data | Scope | Notes |
|------|--------|------|
| **Client** (id, corporateCode, name, industry, location, contacts) | Shared | One record per corporate client; `corporateCode` = business identity (not FK). |
| **ClientLocation** (multiple sites per client) | Shared | Same client row; multiple locations (e.g. same city) linked by clientId. |
| **Status / tabs** (Active, Ex, Contacted, Lost, etc.) | Per agency | Stored in `client_sub_companies` (clientId + subCompanyId → status). |
| **Tags** | Per agency | `client_tags` has subCompanyId; each agency has its own tags on a client. |
| **Notes** | Per agency + override | Stored with subCompanyId. **Director / super_admin** notes are always visible in every agency. Managers may set `isPublic` for associates. |
| **Calls, follow-ups, meetings** | Per agency + override | Agency-scoped; also shown in every agency when **owner** is director/super_admin. |
| **Documents (attachments)** | Per agency + override | `documents.subCompanyId`; director/super_admin uploads set `isPublic` and appear in every agency. |
| **Activity logs** | Per agency + override | Filtered by agency + clientId; director/super_admin entries visible in all agencies. |
| **Proposals** | Per agency + override | Via lead; `?allAgencies=true` merges agencies; director/super_admin lead owners visible cross-agency. |
| **Leads** | Per agency + override | Per agency; lead history includes director/super_admin leads from other agencies. |

So: Agency A and Agency B see the same client record, but each has its own status/tabs, tags, notes (unless a note is made global), and interactions. A director (or change at “global level”) can make a note visible to all by setting `isPublic: true`.

**Director / super_admin overrides**

- Content **created by director or super_admin** (notes, calls, follow-ups, meetings, activity, attachments) is visible in **every agency’s** client detail, not only the creating agency.
- Director/super_admin notes are stored with `isPublic: true` automatically.
- Director/super_admin document uploads use `documents.is_public: true`.
- Elevated users may pass **`?allAgencies=true`** on client detail endpoints (and the frontend does this in the “All Agencies” clients view) to load **merged** data from all agencies they are allowed to access.

## DB (summary)

- **clients** — id (PK, FK target), **corporate_code** (unique business identity, not a FK), name, industry, location, etc.
- **client_locations** — id, client_id (FK), name, address, city, region, postal_code, country, is_primary. Multiple locations per client.
- **client_sub_companies** — (clientId, subCompanyId) → status, lastActivity. One row per client per agency when the agency has set a status.
- **client_tags** — (clientId, subCompanyId, tag). Tags are per agency.
- **client_notes** — subCompanyId + isPublic. List: `subCompanyId = current agency OR isPublic`.
- **calls, follow_ups, meetings** — subCompanyId; backfilled from lead or owner.
- **documents** — subCompanyId; backfilled from lead or activity log on upload.

## API (clients)

- **GET /api/v1/clients** — List clients. Query: `status`, `search`, `corporateCode`, **`subCompanyId`** (optional, "view as" agency: super_admin may pass any; director/operations_manager may pass one in same main org). Status filter uses the effective agency. Response includes agency-scoped status and tags.
- **GET /api/v1/clients/:id** — Detail. Same optional **`subCompanyId`** for "view as" agency. `:id` can be UUID or **corporateCode**. Response includes that agency's status, tags, notes (agency + isPublic), calls, follow-ups, meetings.
- **PATCH /api/v1/clients/:id/agency-status** — Set status for this agency (body: `{ status }`). Upserts `client_sub_companies`. Requires `clients:write`.
- **POST /api/v1/clients/:id/notes** — Add note (body: `{ content, isPinned?, isPublic? }`). Only director/operations_manager/super_admin can set `isPublic`. Requires `clients:write`.
- **POST /api/v1/clients/:id/tags** — Add tag for this agency (body: `{ tag }`). Requires `clients:write`.
- **DELETE /api/v1/clients/:id/tags/:tag** — Remove tag for this agency. Requires `clients:write`.

When creating **calls**, **follow-ups**, or **meetings** in future routes, set `subCompanyId` from the authenticated user’s agency (or from the lead’s subCompanyId when linked to a lead).

---

## How client tabs (Contacted, Active, Ex, etc.) work per agency

- **One client list, many agencies:** All agencies share the same **clients** table. Tabs (Contacted, Active, Ex, Lost, Unsubscribed, Permanently closed) are **per agency**.
- **Storage:** Status is in **client_sub_companies**: (clientId, subCompanyId) → status, lastActivity. Agency 1 can have "Contacted" for client X while Agency 2 has "Active" (or no row).
- **Who sees what:** List and detail use an **agency context** (the user's agency from JWT). GET /clients?status=contacted returns only clients **this agency** has in Contacted. PATCH agency-status only updates **this agency's** row. Other agencies never see or change your tab.
- **"View as" agency:** Super Admin can pass query param **subCompanyId** on GET /clients and GET /clients/:id to view another agency's client list and tabs (see API).
