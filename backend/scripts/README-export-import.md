# Database export / import

Create a portable SQL dump of `staffopia_crm` for restoring on a new PostgreSQL server.

## Requirements

- **PostgreSQL client tools** must be installed (`pg_dump`, `psql`). On macOS with Homebrew: `brew install libpq` then ensure `pg_dump` is on your PATH (e.g. `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`).

## Export (create file to import elsewhere)

From the **backend** directory:

```bash
npm run db:export
# or
./scripts/export-database.sh
```

This writes a timestamped file like `staffopia_crm_export_20260306_131824.sql` in the backend folder. The dump uses plain SQL with `--no-owner` and `--no-acl` so it can be imported on any PostgreSQL server without role conflicts.

To write the file to a different directory:

```bash
EXPORT_DIR=/path/to/backups ./scripts/export-database.sh
```

## Import on a new server

1. **Copy the `.sql` file** to the new server.

2. **Create the database** (if it doesn’t exist):

   ```bash
   psql -U postgres -c "CREATE DATABASE staffopia_crm;"
   ```

3. **Import the dump**:

   ```bash
   psql -U postgres -d staffopia_crm -f staffopia_crm_export_YYYYMMDD_HHMMSS.sql
   ```

   Or, if the new server’s `.env` already has `DATABASE_URL` pointing at this database:

   ```bash
   cd backend
   ./scripts/import-database.sh /path/to/staffopia_crm_export_YYYYMMDD_HHMMSS.sql
   # or, to use the latest export in the backend dir:
   ./scripts/import-database.sh
   ```

4. **Point the app** at the new DB by setting `DATABASE_URL` in `.env` on the new server.
