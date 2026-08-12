# If Something Gets Stuck

## Stop the stuck process
Press **Ctrl+C** in the terminal to stop whatever is running.

---

## Run steps one at a time

### Step 1: Create the database
```bash
cd backend
node scripts/create-database.js
```
- If it **hangs**: PostgreSQL may not be running. Start it (e.g. from Services or `brew services start postgresql`).
- If it **fails**: Check `.env` – `DATABASE_URL` must use your real postgres password.

### Step 2: Generate Prisma Client
```bash
npm run prisma:generate
```
This should finish in a few seconds.

### Step 3: Run migrations
```bash
npx prisma migrate dev --name init
```
- If it **asks for a migration name**: type `init` and press Enter.
- It should not hang; if it does, stop with Ctrl+C and check that the database exists and is reachable.

### Step 4: Seed data
```bash
npm run prisma:seed
```
Runs for ~10–30 seconds.

### Step 5: Start the server
```bash
npm run dev
```
- If it **hangs on “Redis connected” or “Database connected”**: Redis or PostgreSQL may not be running.
- **Redis**: Start with `brew services start redis` (or your OS equivalent).
- **PostgreSQL**: Start the postgres service (e.g. from macOS Services or `brew services start postgresql`).

---

## Skip Redis for now (optional)

If the server hangs waiting for Redis, you can temporarily disable Redis so the server starts without it. Say "disable Redis temporarily" and we can adjust the server code to make Redis optional.

---

## Quick checklist

1. **Ctrl+C** to stop any stuck process.
2. PostgreSQL running? (e.g. check Activity Monitor for `postgres`).
3. `.env` has the correct `DATABASE_URL` and postgres password.
4. Run the steps above **one by one** and see which step hangs or errors.
