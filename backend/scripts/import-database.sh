#!/usr/bin/env bash
# Import a staffopia_crm SQL export into a PostgreSQL database.
# Usage: ./scripts/import-database.sh [path-to-export.sql]
# If no file is given, uses the most recent staffopia_crm_export_*.sql in backend dir.
# Reads DATABASE_URL from backend/.env for the target connection.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "❌ .env not found in $BACKEND_DIR"
  exit 1
fi

DATABASE_URL=$(grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
export DATABASE_URL
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set in .env"
  exit 1
fi

if [ -n "$1" ]; then
  SQL_FILE="$1"
  if [ ! -f "$SQL_FILE" ]; then
    echo "❌ File not found: $SQL_FILE"
    exit 1
  fi
else
  # Use latest export in backend dir
  SQL_FILE=$(ls -t staffopia_crm_export_*.sql 2>/dev/null | head -1)
  if [ -z "$SQL_FILE" ] || [ ! -f "$SQL_FILE" ]; then
    echo "❌ No export file found. Run export-database.sh first or pass a file:"
    echo "   ./scripts/import-database.sh /path/to/export.sql"
    exit 1
  fi
  echo "Using latest export: $SQL_FILE"
fi

echo "Importing into database from $DATABASE_URL ..."
psql "$DATABASE_URL" -f "$SQL_FILE"
echo "✅ Import complete."
