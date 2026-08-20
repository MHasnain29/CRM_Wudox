# Wudox CRM

CRM for [Wudox](https://wudox.ca/): **backend** (Node/Express/Prisma/PostgreSQL) in `backend/`, **frontend** (React/Vite) in `frontend/`. Spec: **docs/SYSTEM_UNDERSTANDING.md**. Standards: **docs/STANDARDS.md**.

## Repository structure

- **`frontend/`** — React (Vite, TypeScript, shadcn-ui, Tailwind)
- **`backend/`** — Node, Express, Prisma, PostgreSQL, JWT auth
- **`docs/`** — System understanding + ops checklists; topic detail in `backend/docs/`

## Run locally

**Prerequisites:** Node.js & npm (e.g. [nvm](https://github.com/nvm-sh/nvm)), Docker (Postgres/Redis).

```sh
# Start isolated Docker DB + Redis (host ports 5433 / 6380 — does not clash with Wudox on 5432 / 6379)
cd backend && docker compose up -d && cd ..

# Install dependencies (root + frontend + backend)
npm run install:all

# Run frontend (default: http://localhost:8080)
npm run dev:frontend
# or from frontend folder:
cd frontend && npm install && npm run dev

# Run backend (default: http://localhost:3001)
npm run dev:backend
# or from backend folder:
cd backend && npm install && npm run dev
```

From repo root you can also run `npm run dev` to start the frontend only.

**Login:** `hassan@wudox.com` / `Wudox-SuperAdmin-2025!` or any demo user (`*@wudox.ca`) / `password123` (see `backend/SETUP.md`).

**Reset all DB data:** `npm run db:reset` (from repo root).

## Edit and deploy

**Use Lovable**

Visit the [Lovable Project](https://lovable.dev/projects/fec56589-b79c-4484-a616-221135541617); changes can be committed to this repo.

**Use your IDE**

Clone the repo, then install and run as above. Frontend lives in `frontend/`, backend in `backend/`.

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/fec56589-b79c-4484-a616-221135541617) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
