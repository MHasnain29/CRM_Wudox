# Setup Guide - NA Staffing CRM Backend

This guide will walk you through setting up the backend for NA Staffing CRM.

## Step 1: Prerequisites Installation

### Install Node.js
1. Download Node.js 20+ LTS from https://nodejs.org/
2. Verify installation:
   ```bash
   node --version  # Should be v20.x.x or higher
   npm --version
   ```

### Install PostgreSQL
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

### Install Redis
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

## Step 2: Database Setup

### Create Database in pgAdmin 4

1. **Open pgAdmin 4**

2. **Connect to PostgreSQL server:**
   - Right-click "Servers" → "Create" → "Server"
   - General tab:
     - Name: `Local PostgreSQL`
   - Connection tab:
     - Host: `localhost`
     - Port: `5432`
     - Maintenance database: `postgres`
     - Username: `postgres`
     - Password: (your PostgreSQL password)
   - Click "Save"

3. **Create the database:**
   - Expand "Local PostgreSQL" → "Databases"
   - Right-click "Databases" → "Create" → "Database"
   - General tab:
     - Database: `na_staffing_crm`
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
   # Update these values:
   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/na_staffing_crm?schema=public
   
   # Generate secure secrets (you can use: openssl rand -base64 32)
   JWT_SECRET=your-super-secret-jwt-key-min-32-characters-long
   JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-characters-long
   
   # Redis (defaults should work if Redis is running locally)
   REDIS_HOST=localhost
   REDIS_PORT=6379
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
   - 2 sub-companies
   - 7 users (director, managers, associates, recruiters)
   - 8 clients
   - 6 leads
   - 20 calls
   - 15 follow-ups
   - 12 tasks
   - 8 meetings
   - 3 jobs
   - 8 employees
   - And more...

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

1. Expand `na_staffing_crm` database
2. Expand "Schemas" → "public" → "Tables"
3. You should see all the tables:
   - users
   - clients
   - leads
   - calls
   - tasks
   - etc.

4. Right-click on `users` table → "View/Edit Data" → "All Rows"
   - You should see 7 users including:
     - director@nastaffing.com
     - manager1@nastaffing.com
     - associate1@nastaffing.com
     - etc.

## Step 6: Cloudflare R2 Setup (Optional - for file storage)

1. **Create Cloudflare account** (if you don't have one)
   - Go to https://dash.cloudflare.com/

2. **Enable R2:**
   - Go to R2 section in dashboard
   - Click "Create bucket"
   - Name: `na-staffing-crm-documents`
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
   R2_BUCKET_NAME=na-staffing-crm-documents
   R2_PUBLIC_URL=https://your-bucket.r2.cloudflarestorage.com
   ```

## Step 7: SendGrid Setup (Optional - for emails)

1. **Create SendGrid account:**
   - Go to https://sendgrid.com/
   - Sign up for free account

2. **Create API key:**
   - Go to Settings → API Keys
   - Click "Create API Key"
   - Name: `NA Staffing CRM`
   - Permissions: Full Access (or Mail Send)
   - Copy the API key

3. **Update `.env`:**
   ```env
   SENDGRID_API_KEY=your-api-key-here
   EMAIL_FROM=noreply@nastaffing.com
   EMAIL_FROM_NAME=NA Staffing CRM
   ```

## Troubleshooting

### "Cannot connect to database"
- Check PostgreSQL is running
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
- Check Redis is running: `redis-cli ping`
- Should return: `PONG`
- Verify REDIS_HOST and REDIS_PORT in .env

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

After seeding, you can use these credentials (when auth is implemented):

- **Director**: `director@nastaffing.com` / `password123`
- **Sales Manager**: `manager1@nastaffing.com` / `password123`
- **Sales Associate**: `associate1@nastaffing.com` / `password123`
- **Recruiter**: `recruiter1@nastaffing.com` / `password123`

---

**Need Help?** Check the main README.md or `docs/SYSTEM_UNDERSTANDING.md`.
