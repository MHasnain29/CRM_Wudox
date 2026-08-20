# Wudox CRM Backend

Backend API for Wudox CRM - A comprehensive staffing agency management system built with Node.js, Express, PostgreSQL, and Prisma.

## 🚀 Quick Start

### Prerequisites

- Node.js 20+ (LTS recommended)
- PostgreSQL 15+
- Redis (optional; set `REDIS_ENABLED=false` in `.env` to run without it)
- pgAdmin 4 or Prisma Studio (for database management)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and update the following:
   - `DATABASE_URL` - Your PostgreSQL connection string
   - `JWT_SECRET` - Generate a secure random string (min 32 characters)
   - `JWT_REFRESH_SECRET` - Generate another secure random string
   - `REDIS_HOST` and `REDIS_PORT` - Your Redis connection details

3. **Set up the database:**
   ```bash
   # Generate Prisma Client
   npm run prisma:generate

   # Run migrations
   npm run prisma:migrate

   # Seed the database with dummy data
   npm run prisma:seed
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3001`

## 📁 Project Structure

```
backend/
├── src/
│   ├── config/          # Configuration files (database, redis, env)
│   ├── controllers/     # Request handlers
│   ├── services/        # Business logic
│   ├── middleware/      # Custom middleware
│   ├── routes/         # API routes
│   ├── utils/          # Utility functions
│   ├── types/          # TypeScript types
│   └── server.ts       # Main server file
├── prisma/
│   ├── migrations/     # Database migrations
│   ├── schema.prisma   # Database schema
│   └── seed.ts         # Seed data script
├── tests/              # Test files
└── package.json
```

## 🗄️ Database Setup

### Using pgAdmin 4

1. **Create a new database:**
   - Open pgAdmin 4
   - Right-click on "Databases" → "Create" → "Database"
   - Name: `wudox_crm`
   - Owner: `postgres` (or your user)
   - Click "Save"

2. **Update DATABASE_URL in .env:**
   ```
   DATABASE_URL=postgresql://postgres:your_password@localhost:5432/wudox_crm?schema=public
   ```

3. **Run migrations:**
   ```bash
   npm run prisma:migrate
   ```

4. **Seed the database:**
   ```bash
   npm run prisma:seed
   ```

### Default Credentials

After seeding, you can login with:
- **Director**: `director@wudox.ca` / `password123`
- **Sales Associate**: `associate1@wudox.ca` / `password123`
- **Manager**: `manager1@wudox.ca` / `password123`

## 📝 Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm run prisma:generate` - Generate Prisma Client
- `npm run prisma:migrate` - Run database migrations
- `npm run prisma:studio` - Open Prisma Studio (database GUI)
- `npm run prisma:seed` - Seed database with dummy data
- `npm run db:reset` - Reset database (⚠️ deletes all data)
- `npm test` - Run tests
- `npm run lint` - Lint code
- `npm run format` - Format code with Prettier

## 🔧 Configuration

### Environment Variables

Key environment variables (see `.env.example` for full list):

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT tokens
- `REDIS_HOST` - Redis host
- `SENDGRID_API_KEY` - SendGrid API key for emails
- `R2_*` - Cloudflare R2 storage configuration

### Database Schema

The database schema is defined in `prisma/schema.prisma`. Key entities:

- **Users** - System users with roles
- **Clients** - Client companies
- **Leads** - Sales leads
- **Calls** - Call logs
- **Follow-ups** - Follow-up reminders
- **Tasks** - Task management
- **Meetings** - Meeting scheduling
- **Jobs** - Job postings
- **Employees** - Employee records
- **Emails** - Email tracking
- **Activity Logs** - System activity tracking

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## 📦 Production Deployment

### Recommended Platform: AWS

**Why AWS?**
- Scalable infrastructure
- Managed PostgreSQL (RDS)
- Managed Redis (ElastiCache)
- S3 for file storage
- Easy integration with Cloudflare R2
- Comprehensive monitoring and logging

**Alternative Platforms:**
- **Vercel** - Good for serverless, but requires PostgreSQL on separate service
- **Railway** - Easy deployment, includes PostgreSQL
- **DigitalOcean** - Simple VPS with managed databases
- **Google Cloud Platform** - Similar to AWS
- **Azure** - Microsoft cloud platform

### Build for Production

```bash
npm run build
npm start
```

## 🔐 Security

- JWT authentication with refresh tokens
- Password hashing with bcrypt
- Rate limiting
- CORS configuration
- Helmet for security headers
- Input validation with Zod

## 📊 Monitoring

Health check endpoint: `GET /health`

Returns:
```json
{
  "status": "ok",
  "timestamp": "2026-02-20T...",
  "uptime": 123.45
}
```

## 🐛 Troubleshooting

### Database Connection Issues

1. Check PostgreSQL is running:
   ```bash
   # macOS
   brew services list | grep postgresql
   
   # Linux
   sudo systemctl status postgresql
   ```

2. Verify DATABASE_URL format:
   ```
   postgresql://username:password@host:port/database?schema=public
   ```

3. Check PostgreSQL logs for errors

### Redis Connection Issues

1. Check Redis is running:
   ```bash
   redis-cli ping
   # Should return: PONG
   ```

2. Verify REDIS_HOST and REDIS_PORT in .env

### Migration Issues

If migrations fail:
```bash
# Reset database (⚠️ deletes all data)
npm run db:reset

# Or manually reset in pgAdmin
# Then run migrations again
npm run prisma:migrate
```

## 📚 API Endpoints

Base URL: `http://localhost:3001/api/v1`

### Public
- `GET /health` – Health check (no auth)
- `GET /api/v1` – API info (no auth)

### Auth
- `POST /api/v1/auth/login` – Login (body: `{ "email", "password" }`) → returns `{ user, token, refreshToken }`
- `GET /api/v1/auth/me` – Current user (requires `Authorization: Bearer <token>`)

### Clients (require auth)
- `GET /api/v1/clients` – List clients (query: `page`, `limit`, `status`, `search`)
- `GET /api/v1/clients/:id` – Get client by ID

### Users (require auth)
- `GET /api/v1/users/me` – Current user
- `GET /api/v1/users` – List users (no password)

Use the `token` from login in the header: `Authorization: Bearer <token>`.

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Run tests and linting
4. Submit a pull request

## 📄 License

ISC

## 🆘 Support

For issues or questions:
1. Check the troubleshooting section
2. Review `docs/SYSTEM_UNDERSTANDING.md` and `backend/docs/`
3. Check Prisma documentation: https://www.prisma.io/docs
4. Check Express documentation: https://expressjs.com/

---

**Next Steps:**
1. ✅ Database schema created
2. ✅ Seed data script ready
3. ⏳ API routes implementation
4. ⏳ Authentication system
5. ⏳ CRUD operations for all entities
