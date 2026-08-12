#!/usr/bin/env bash
# Export staffopia_crm PostgreSQL database to a plain SQL file for importing on a new server.
# Run from repo root: ./backend/scripts/export-database.sh
# Or from backend: ./scripts/export-database.sh
# Requires: pg_dump (PostgreSQL client tools)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$BACKEND_DIR"

if [ ! -f .env ]; then
  echo "❌ .env not found in $BACKEND_DIR"
  exit 1
fi

# Load only DATABASE_URL from .env (avoids issues with spaces in other vars)
DATABASE_URL=$(grep '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//' | tr -d '"' | tr -d "'")
export DATABASE_URL

if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL is not set in .env"
  exit 1
fi

OUTPUT_DIR="${EXPORT_DIR:-$BACKEND_DIR}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_FILE="$OUTPUT_DIR/staffopia_crm_export_$TIMESTAMP.sql"

echo "Exporting database to $OUTPUT_FILE ..."
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  -F p \
  -f "$OUTPUT_FILE"

echo "✅ Export complete: $OUTPUT_FILE"
echo ""
echo "To import on a new PostgreSQL server:"
echo "  1. Create the database:  psql -U postgres -c \"CREATE DATABASE staffopia_crm;\""
echo "  2. Import:               psql -U postgres -d staffopia_crm -f $OUTPUT_FILE"
echo "  Or use:                  ./scripts/import-database.sh <path-to-export.sql>"
