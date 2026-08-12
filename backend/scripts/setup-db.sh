#!/bin/bash
# Run this script to create DB + migrate + seed (no prompts)
set -e
cd "$(dirname "$0")/.."

echo "1. Creating database (if not exists)..."
node scripts/create-database.js || true

echo "2. Generating Prisma Client..."
npm run prisma:generate

echo "3. Running migrations..."
npx prisma migrate dev --name init

echo "4. Seeding database..."
npm run prisma:seed

echo "Done. Start server with: npm run dev"
