# Troubleshooting pgAdmin 4 Error

## Issue: "Database already exists" but I can't see it in pgAdmin

The database **does exist** on the same PostgreSQL server your app uses (localhost:5432). If you don’t see it in pgAdmin, check the following:

1. **You’re looking at the right server**  
   In the left tree, expand **Servers** and make sure the server you’re using is the one for **localhost, port 5432**. If you have several servers (e.g. "PostgreSQL 17", "Local"), the one that matches your `.env` is:
   - **Host:** `localhost`
   - **Port:** `5432`
   - **Username:** `postgres`
   - **Password:** (the one in `DATABASE_URL`, e.g. `Mehmed`)

2. **The server is actually connected**  
   Click the server (or right‑click → **Connect**). If you see "server could not be contacted", pgAdmin can’t talk to PostgreSQL and won’t show any databases. Fix that first (see sections below or use Prisma Studio).

3. **Refresh the database list**  
   Expand **Servers → [Your Server] → Databases**, then right‑click **Databases** → **Refresh**. You should see `postgres`, `wudox_crm`, `template0`, `template1`.

4. **Quick check from terminal**  
   From the project:
   ```bash
   cd backend && node -e "
   require('dotenv').config();
   const { Client } = require('pg');
   const u = new URL(process.env.DATABASE_URL);
   const c = new Client({ host: u.hostname, port: u.port || 5432, user: u.username, password: u.password, database: 'postgres' });
   c.connect().then(() => c.query('SELECT datname FROM pg_database')).then(r => { console.log(r.rows); }).finally(() => c.end());
   "
   ```
   If this lists `wudox_crm`, the DB is there; the issue is only pgAdmin’s connection or which server you’re viewing.

---

## Issue: "The pgAdmin 4 server could not be contacted"

This is a common issue on macOS with pgAdmin 4. Here are several solutions:

## Solution 1: Reset pgAdmin Configuration

1. **Close pgAdmin 4 completely** (quit from menu bar)

2. **Delete the config file:**
   ```bash
   rm -rf ~/Library/Application\ Support/pgAdmin\ 4
   ```

3. **Restart pgAdmin 4**

## Solution 2: Check Python Environment

The error shows Python path issues. Try:

1. **Check if Python is accessible:**
   ```bash
   /Library/PostgreSQL/17/pgAdmin\ 4.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 --version
   ```

2. **If Python is missing, reinstall PostgreSQL with pgAdmin**

## Solution 3: Fix Port Conflicts

pgAdmin uses port 5050 by default. Check if it's in use:

```bash
lsof -i :5050
```

If something is using it, kill the process or change pgAdmin's port.

## Solution 4: Reinstall pgAdmin (Recommended)

1. **Uninstall current pgAdmin:**
   ```bash
   # Remove application
   sudo rm -rf /Library/PostgreSQL/17/pgAdmin\ 4.app
   
   # Remove config
   rm -rf ~/Library/Application\ Support/pgAdmin\ 4
   ```

2. **Download fresh installer:**
   - Go to https://www.pgadmin.org/download/
   - Download pgAdmin 4 for macOS
   - Install fresh

## Solution 5: Use Alternative Database Tools (Quick Fix)

While fixing pgAdmin, you can use these alternatives:

### Option A: DBeaver (Free, Cross-platform)
```bash
brew install --cask dbeaver-community
```

### Option B: TablePlus (macOS native, Free tier available)
```bash
brew install --cask tableplus
```

### Option C: Postico (macOS native, Paid)
```bash
brew install --cask postico
```

### Option D: Use Prisma Studio (Already included!)
```bash
cd backend
npm run prisma:studio
```
This opens a web-based database browser at http://localhost:5555

## Solution 6: Use Command Line (psql)

You can manage the database directly via command line:

```bash
# Connect to PostgreSQL
psql -U postgres -d wudox_crm

# Or if you need to specify host/port
psql -h localhost -p 5432 -U postgres -d wudox_crm
```

## Quick Workaround: Use Prisma Studio Instead

Since you have Prisma set up, you can skip pgAdmin for now:

```bash
cd backend
npm run prisma:studio
```

This gives you a web-based GUI to:
- Browse all tables
- View and edit data
- Run queries
- Much simpler than pgAdmin!

## Recommended: Fix pgAdmin Later, Use Prisma Studio Now

For now, I recommend using **Prisma Studio** to manage your database:

1. **Start Prisma Studio:**
   ```bash
   cd backend
   npm run prisma:studio
   ```

2. **It will open in your browser** at http://localhost:5555

3. **You can:**
   - Browse all tables (users, clients, leads, etc.)
   - View and edit records
   - See relationships
   - Much easier than pgAdmin!

## After Fixing pgAdmin

Once pgAdmin is working, you can:

1. Connect to PostgreSQL server:
   - Host: `localhost`
   - Port: `5432`
   - Database: `wudox_crm`
   - Username: `postgres`
   - Password: (your PostgreSQL password)

2. Browse tables and run SQL queries

---

**For now, use Prisma Studio - it's simpler and already set up!**
