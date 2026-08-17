/**
 * Adds cto@wudox.com (password123) to the existing Wudox CRM company.
 * Safe to run on top of existing data — does NOT wipe anything.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.subCompany.findFirst({
    where: { name: 'Wudox CRM' },
  });

  if (!company) {
    console.error('❌ Wudox CRM company not found. Run prisma:seed-clean first.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'cto@wudox.com' },
    update: { passwordHash, isActive: true, role: 'cto', subCompanyId: company.id },
    create: {
      email: 'cto@wudox.com',
      passwordHash,
      firstName: 'Ali',
      lastName: 'CTO',
      country: 'Pakistan',
      role: 'cto',
      userType: 'CTO',
      subCompanyId: company.id,
      isActive: true,
    },
  });

  console.log('✅ CTO user ready');
  console.log(`   Email: ${user.email}`);
  console.log(`   Password: password123`);
  console.log(`   Company: ${company.name} (${company.id})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
