# Setup Guide - Wudox CRM Backend

This guide will walk you through setting up the backend for Wudox CRM.

## Step 1: Prerequisites Installation

### Install Node.js
1. Download Node.js 20+ LTS from https://nodejs.org/
2. Verify installation:
   ```bash
   node --version  # Should be v20.x.x or higher
   npm --version
   ```

### Install Docker (recommended for Postgres + Redis)

From `backend/`:

```bash
docker compose up -d
```

This starts an **isolated** stack that can run beside NA Staffing on the same machine:

| Service | Container | Host port |
|---|---|---|
| Postgres 15 | `wudox_crm_postgres` | `5433` |
| Redis 7 | `wudox_crm_redis` | `6380` |
| pgAdmin | `wudox_crm_pgadmin` | `5051` |

Database name: `wudox_crm` (user/password: `postgres` / `postgres`).

### Install PostgreSQL (optional — if not using Docker)
1. **macOS:**
   ```bash
   brew install postgresql@15
   brew services start postgresql@15
   ```

2. **Windows:**
   - Download from https://www.postgresql.org/download/windows/
   - Run the installer
   - Remember the password you set for the `postgres` user

3. **Linux (Ubuntu/Debian):**
   ```bash
   sudo apt update
   sudo apt install postgresql-15
   sudo systemctl start postgresql
   ```

### Install Redis (optional — if not using Docker)
1. **macOS:**
   ```bash
   brew install redis
   brew services start redis
   ```

2. **Windows:**
   - Download from https://github.com/microsoftarchive/redis/releases
   - Or use WSL (Windows Subsystem for Linux)

3. **Linux:**
   ```bash
   sudo apt install redis-server
   sudo systemctl start redis
   ```

### Install pgAdmin 4
1. Download from https://www.pgadmin.org/download/
2. Install and launch pgAdmin 4
3. Or use Docker pgAdmin at http://localhost:5051 (`admin@wudox.local` / `admin123`)

## Step 2: Database Setup

### Using Docker Compose (recommended)

No manual DB create is needed — `POSTGRES_DB=wudox_crm` is created on first start. Connect with:

- Host: `localhost`
- Port: `5433`
- Database: `wudox_crm`
- User / password: `postgres` / `postgres`

### Create Database in pgAdmin 4 (non-Docker)

1. **Open pgAdmin 4**

2. **Connect to PostgreSQL server:**
   - Right-click "Servers" → "Create" → "Server"
   - General tab:
     - Name: `Local PostgreSQL`
   - Connection tab:
     - Host: `localhost`
     - Port: `5433` (Docker) or `5432` (local install)
     - Maintenance database: `postgres`
     - Username: `postgres`
     - Password: (your PostgreSQL password)
   - Click "Save"

3. **Create the database:**
   - Expand "Local PostgreSQL" → "Databases"
   - Right-click "Databases" → "Create" → "Database"
   - General tab:
     - Database: `wudox_crm`
   - Owner: `postgres`
   - Click "Save"

## Step 3: Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create environment file:**
   ```bash
   cp .env.example .env
   ```

4. **Edit `.env` file:**
   ```env
   # Docker Compose defaults (isolated ports):
   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/wudox_crm?schema=public
   
   # Generate secure secrets (you can use: openssl rand -base64 32)
   JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long
   JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters-long
   
   # Redis (Docker maps host 6380 → container 6379)
   REDIS_HOST=localhost
   REDIS_PORT=6380
   ```

5. **Generate Prisma Client:**
   ```bash
   npm run prisma:generate
   ```

6. **Run database migrations:**
   ```bash
   npm run prisma:migrate
   ```
   
   When prompted, enter a migration name like: `init`

7. **Seed the database:**
   ```bash
   npm run prisma:seed
   ```
   
   This will populate the database with dummy data including:
   - 1 sub-company (Wudox - Mississauga)
   - Demo users for every role (`hassan@wudox.com` + `*@wudox.ca` personas)
   - Clients, leads, calls, follow-ups, tasks, meetings
   - Jobs, employees, approvals, and more...

## Step 4: Verify Setup

1. **Start the development server:**
   ```bash
   npm run dev
   ```

2. **Check health endpoint:**
   ```bash
   curl http://localhost:3001/health
   ```
   
   Should return:
   ```json
   {
     "status": "ok",
     "timestamp": "...",
     "uptime": ...
   }
   ```

3. **Check API endpoint:**
   ```bash
   curl http://localhost:3001/api/v1
   ```

4. **Open Prisma Studio (optional):**
   ```bash
   npm run prisma:studio
   ```
   
   This opens a web interface at http://localhost:5555 to browse your database

## Step 5: Test Database Connection

In pgAdmin 4:

1. Expand `wudox_crm` database
2. Expand "Schemas" → "public" → "Tables"
3. You should see all the tables:
   - users
   - clients
   - leads
   - calls
   - tasks
   - etc.

4. Right-click on `users` table → "View/Edit Data" → "All Rows"
   - You should see seeded users including:
     - hassan@wudox.com
     - director@wudox.ca
     - manager1@wudox.ca
     - associate1@wudox.ca
     - etc.

## Step 6: Cloudflare R2 Setup (Optional - for file storage)

1. **Create Cloudflare account** (if you don't have one)
   - Go to https://dash.cloudflare.com/

2. **Enable R2:**
   - Go to R2 section in dashboard
   - Click "Create bucket"
   - Name: `wudox-crm-documents`
   - Choose location

3. **Get API credentials:**
   - Go to "Manage R2 API Tokens"
   - Click "Create API token"
   - Permissions: Object Read & Write
   - Save the credentials

4. **Update `.env`:**
   ```env
   R2_ACCOUNT_ID=your-account-id
   R2_ACCESS_KEY_ID=your-access-key
   R2_SECRET_ACCESS_KEY=your-secret-key
   R2_BUCKET_NAME=wudox-crm-documents
   R2_PUBLIC_URL=https://your-bucket.r2.cloudflarestorage.com
   ```

## Step 7: SendGrid Setup (Optional - for emails)

1. **Create SendGrid account:**
   - Go to https://sendgrid.com/
   - Sign up for free account

2. **Create API key:**
   - Go to Settings → API Keys
   - Click "Create API Key"
   - Name: `Wudox CRM`
   - Permissions: Full Access (or Mail Send)
   - Copy the API key

3. **Update `.env`:**
   ```env
   SENDGRID_API_KEY=your-api-key-here
   EMAIL_FROM=noreply@wudox.ca
   EMAIL_FROM_NAME=Wudox CRM
   ```

## Troubleshooting

### "Cannot connect to database"
- Check Docker Postgres is running: `docker compose ps` (port `5433`)
- Verify DATABASE_URL in .env
- Check password is correct
- Try connecting with pgAdmin 4 first

### "Prisma Client not generated"
```bash
npm run prisma:generate
```

### "Migration failed"
```bash
# Reset and try again (⚠️ deletes all data)
npm run db:reset
npm run prisma:migrate
```

### "Redis connection error"
- Check Docker Redis: `docker exec wudox_crm_redis redis-cli ping`
- Should return: `PONG`
- Verify REDIS_HOST=`localhost` and REDIS_PORT=`6380` in .env (or REDIS_URL)

### "Port 3001 already in use"
- Change PORT in .env to another port (e.g., 3002)
- Or kill the process using port 3001

## Next Steps

Once setup is complete:

1. ✅ Database is ready
2. ✅ Dummy data is loaded
3. ⏳ Start implementing API routes
4. ⏳ Add authentication
5. ⏳ Connect frontend

## Default Login Credentials

After seeding:

- **Super Admin**: `hassan@wudox.com` / `NA-Staffing-SuperAdmin-2025!` (or `SUPER_ADMIN_INITIAL_PASSWORD`)
- **Director**: `director@wudox.ca` / `password123`
- **Sales Manager**: `manager1@wudox.ca` / `password123`
- **Sales Associate**: `associate1@wudox.ca` / `password123`
- **Recruiter**: `recruiter1@wudox.ca` / `password123`

---

**Need Help?** Check the main README.md or `docs/SYSTEM_UNDERSTANDING.md`.
