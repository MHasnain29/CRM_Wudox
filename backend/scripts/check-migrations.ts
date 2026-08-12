import '../src/loadEnv';
import prisma from '../src/config/database';

async function main() {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
    SELECT migration_name, finished_at FROM _prisma_migrations
    WHERE migration_name LIKE '%inbound%' OR migration_name LIKE '%phone%'
    ORDER BY finished_at
  `;
  console.log('Migrations:', rows);

  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_name IN ('inbound_calls', 'inbound_call_participants', 'phone_call_sessions', 'phone_numbers', 'phone_agency_configs')
    ORDER BY table_name
  `;
  console.log('Tables:', tables.map((t) => t.table_name));
}

main().finally(() => prisma.$disconnect());
