# Online Redis setup (free tier)

You can use a hosted Redis service so you don’t need to run Redis locally. The backend supports a single **REDIS_URL** (or host/port/password).

---

## Option 1: Upstash (recommended, free tier)

1. **Sign up**  
   Go to [console.upstash.com](https://console.upstash.com) and create an account.

2. **Create a Redis database**  
   - Click **Create Database**.  
   - Choose a name (e.g. `na-staffing-crm`), region, and **Free** plan.  
   - Create the database.

3. **Get the connection URL**  
   - Open your database in the console.  
   - In **REST API** or **Connect** you’ll see:
     - **Endpoint** (e.g. `xxx.upstash.io`)
     - **Port** (often `6379` or a TLS port)
     - **Password**
   - Build the URL (use **TLS** if your client supports it):
     - With TLS: `rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT:6379`
     - Without TLS (if offered): `redis://default:YOUR_PASSWORD@YOUR_ENDPOINT:6379`  
   - Or copy the **Redis URL** from the Upstash UI if they show it.

4. **Configure the backend**  
   In `backend/.env`:

   ```env
   REDIS_ENABLED=true
   REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379
   ```

   Leave `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` unset (or as-is); when `REDIS_URL` is set, it is used instead.

5. **Restart the server**  
   Run `npm run dev` again. You should see `✅ Redis connected` in the logs.

---

## Option 2: Redis Cloud

1. Go to [redis.com/try-free](https://redis.com/try-free/) and sign up.  
2. Create a **free** database and wait for it to become active.  
3. In the database details, find the **Public endpoint** and **Default user password**.  
4. Build the URL, for example:
   ```text
   rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.redis.cloud.com:6379
   ```
5. In `backend/.env`:
   ```env
   REDIS_ENABLED=true
   REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.redis.cloud.com:6379
   ```
6. Restart the backend.

---

## Notes

- **TLS:** Most hosted Redis use TLS. Use `rediss://` (with double “s”) in the URL; the Node Redis client will use TLS automatically.  
- **Free limits:** Upstash free tier has a small storage and command limit; enough for dev and light use. Redis Cloud free tier has similar limits.  
- **No REDIS_URL:** If you run Redis locally, keep using `REDIS_HOST`, `REDIS_PORT`, and `REDIS_PASSWORD` and leave `REDIS_URL` unset.
