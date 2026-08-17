/**
 * Clean seed — no demo data.
 * Creates: Wudox CRM sub-company + one super_admin user.
 * Run: npm run prisma:seed-clean
 * After this, always run: npm run prisma:seed-rbac
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting clean seed...');

  // Wipe all tables
  console.log('🧹 Clearing all data...');
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE
      r RECORD;
    BEGIN
      FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' CASCADE';
      END LOOP;
    END $$;
  `);

  // Create company
  console.log('🏢 Creating Wudox CRM company...');
  const company = await prisma.subCompany.create({
    data: {
      name: 'Wudox CRM',
      appProjectName: 'Wudox CRM',
      mainOrgId: 'wudox-main-org',
    },
  });

  // Create super admin
  console.log('👤 Creating super admin...');
  const passwordHash = await bcrypt.hash('password123', 12);
  await prisma.user.create({
    data: {
      email: 'hassan@wudox.com',
      passwordHash,
      firstName: 'Hassan',
      lastName: 'Admin',
      country: 'Canada',
      role: 'super_admin',
      userType: 'Super Admin',
      subCompanyId: company.id,
      isActive: true,
    },
  });

  console.log('✅ Clean seed complete');
  console.log('');
  console.log('🔑 Login: hassan@wudox.com / password123');
  console.log('🏢 Company: Wudox CRM');
  console.log('');
  console.log('Next: npm run prisma:seed-rbac');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
