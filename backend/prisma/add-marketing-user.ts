/**
 * Adds marketing@wudox.ca (password123). Safe on existing data — does not wipe.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { ensureMissingSystemRoles } from '../src/services/ensureMissingSystemRoles';

const prisma = new PrismaClient();

async function main() {
  await ensureMissingSystemRoles();

  const company = await prisma.subCompany.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!company) {
    console.error('No agency found. Seed the database first.');
    process.exit(1);
  }

  const marketingRole = await prisma.rbacRole.findUnique({ where: { key: 'marketing' } });
  const manager = await prisma.user.findFirst({
    where: { role: 'sales_manager', isActive: true, subCompanyId: company.id },
    select: { id: true },
  });
  const location = await prisma.location.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  const passwordHash = await bcrypt.hash('password123', 12);

  const user = await prisma.user.upsert({
    where: { email: 'marketing@wudox.ca' },
    update: {
      passwordHash,
      isActive: true,
      role: 'marketing',
      userType: 'Marketing',
      roleId: marketingRole?.id ?? undefined,
      subCompanyId: company.id,
    },
    create: {
      email: 'marketing@wudox.ca',
      passwordHash,
      firstName: 'Maya',
      lastName: 'Patel',
      phone: '+1-416-555-0120',
      country: 'Canada',
      role: 'marketing',
      userType: 'Marketing',
      roleId: marketingRole?.id ?? null,
      subCompanyId: company.id,
      locationId: location?.id ?? null,
      reportingManagerIds: manager ? [manager.id] : [],
      dailyCallsTarget: 100,
      dailyEmailsTarget: 50,
      isActive: true,
    },
  });

  console.log('Marketing user ready');
  console.log(`  Email: ${user.email}`);
  console.log('  Password: password123');
  console.log(`  Agency: ${company.name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
