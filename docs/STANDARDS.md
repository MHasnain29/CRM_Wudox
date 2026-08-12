# NA Staffing CRM — Project Standards

This document defines how the project is expected to stay **scalable**, **fast**, **secure**, **modular**, **reusable**, **clean**, and **reliable**. Use it for onboarding and as a reference for both humans and tooling (e.g. Cursor rules are derived from these).

---

## 1. Principles

| Principle | Meaning |
|-----------|--------|
| **Scalable** | Built for 500–1000 concurrent users. Stateless API, DB indexes, connection pooling, optional Redis/cache. No in-memory session store; avoid N+1 queries. |
| **Fast** | Quick responses. Pagination, lean queries, background jobs for heavy work. Don’t block the event loop. |
| **Secure** | Validate/sanitize inputs. Secrets in env only. Auth on protected routes; least privilege. No secrets in logs or client. |
| **Modular** | One concern per module. Services = business logic; routes = HTTP; config separate. Clear dependencies. |
| **Reusable** | Shared logic in services/utils; shared types. Reuse existing routes and patterns; avoid duplication. |
| **Clean code** | Readable names, small functions, minimal nesting. Explicit error handling. Comments for “why,” not “what.” |
| **Reliable** | Graceful degradation (e.g. optional Redis). Log errors with context. Schema via migrations only. |

---

## 2. Tech Context

- **Backend**: Node.js, Express, Prisma, PostgreSQL. Target: 500–1000 concurrent users. See `docs/SYSTEM_UNDERSTANDING.md`.
- **API**: Prefix `/api/v1`. Auth: JWT; optional Redis, Twilio, R2, SendGrid — app must run when these are unset.
- **Config**: All env in `backend/src/config/env.ts` (Zod). New vars go in `.env.example` and config schema.

---

## 3. Conventions

- **New features**: Add env to config and `.env.example`; document in `backend/docs/` when relevant.
- **Backend routes**: Thin handlers; business logic in services. Protected routes use `authenticate` middleware (JWT).
- **DB**: Indexes for hot paths; paginate lists; avoid N+1 (use `include` or batch queries).

---

## 4. Where This Lives

- **Cursor**: `.cursor/rules/` — `project-standards.mdc` (always apply), `backend-standards.mdc` (for `backend/**/*.ts`).
- **Repo**: This file (`docs/STANDARDS.md`) is the single source of truth; rules and onboarding can point here.

Adding new patterns or constraints: update this file and the corresponding `.cursor/rules/*.mdc` so AI and humans stay aligned.
