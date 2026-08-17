# Getting Started — Wudox CRM

## Requirements

Install these before anything else:

- [Node.js 20+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

---

## Setup (do this once)

### 1. Start the database

```bash
cd backend
docker compose up -d
```

Wait ~10 seconds for it to start.

### 2. Backend setup

```bash
cd backend
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

### 3. Frontend setup (new terminal)

```bash
cd frontend
npm install
```

---

## Running the project

Open **two terminals**:

**Terminal 1 — Backend**
```bash
cd backend
npm run dev
```
Runs at http://localhost:3001

**Terminal 2 — Frontend**
```bash
cd frontend
npm run dev
```
Runs at http://localhost:5173

---

## Login credentials

| Role | Email | Password |
|---|---|---|
| Super Admin | hassan@wudox.com | `NA-Staffing-SuperAdmin-2025!` |
| Director | director@wudox.ca | `password123` |
| Manager | manager1@wudox.ca | `password123` |
| Associate | associate1@wudox.ca | `password123` |
| Recruiter | recruiter1@wudox.ca | `password123` |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Database won't connect | Make sure Docker Desktop is open and running |
| `npm install` fails | Make sure you're on Node.js 20+ (`node --version`) |
| Port already in use | Press Ctrl+C to stop, then try again |
| Everything is broken | Run `docker compose ps` in `backend/` to check services |
