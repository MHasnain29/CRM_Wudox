# IP-based restriction

Two layers:

1. **Global allowlist** (env) — optional; restricts which IPs can hit the API at all.
2. **Role/country rules** (DB) — restrict **login** by role (and optional country) so e.g. sales associates in Pakistan can only login from specific IPs.

---

## 1. Global allowlist (env)

Optional. When `IP_ALLOWLIST` is set, only those IPs can access the API (except `/health`). Management: edit `.env`, restart.

- **IP_ALLOWLIST** — Comma-separated IPs and/or CIDRs. Empty = no global restriction.
- **TRUST_PROXY** — Set when behind a reverse proxy so client IP is from `X-Forwarded-For`.

See “Configuration” in the previous version of this doc for examples.

---

## 2. Role/country-based login restriction (DB)

Rules are stored in **ip_restriction_rules**: each rule has **role**, optional **country**, and **allowedIps** (comma-separated IPs/CIDRs). Users matching that role (and country, if set) can **only log in** from an IP in the rule’s list.

- **Role only** (country = null): rule applies to that role in any country.
- **Role + country**: e.g. “sales_associate” + “Pakistan” → only these IPs can login for that combination.

**Matching:** For a user with role R and country C we load rules where `role = R` and (`country` is null or `country = C`). If **any** such rule exists, the client IP must be in **at least one** rule’s `allowedIps`; otherwise login is rejected with 401.

**Management:** CRUD API (requires `settings:write`).

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/ip-restriction-rules | List all rules |
| POST | /api/v1/ip-restriction-rules | Create rule. Body: `{ role, country?, allowedIps, name? }` |
| PUT | /api/v1/ip-restriction-rules/:id | Update rule. Body: `{ allowedIps?, name? }` |
| DELETE | /api/v1/ip-restriction-rules/:id | Delete rule |

**Example:** Restrict sales associates in Pakistan to office IPs:

```json
POST /api/v1/ip-restriction-rules
{ "role": "sales_associate", "country": "Pakistan", "allowedIps": "203.0.113.10,203.0.113.11", "name": "Pakistan sales associates" }
```

**Example:** Restrict all recruiters (any country) to VPN CIDR:

```json
POST /api/v1/ip-restriction-rules
{ "role": "recruiter", "allowedIps": "10.0.0.0/24", "name": "Recruiters VPN" }
```

No rule for (role, country) = no login IP restriction for that user.

---

## Summary

- **Global:** Env `IP_ALLOWLIST`; restricts who can hit the API.
- **Per role/country:** DB table + CRUD API; restricts **login** for users matching role (and optional country). Easy to manage via API or a small admin UI that calls these endpoints.
