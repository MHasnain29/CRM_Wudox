/**
 * One-off: reset the super admin's password in an existing database.
 *
 * Needed after the NA Staffing → Wudox rebrand changed the documented default
 * password — databases seeded before the rename still hold the old hash.
 *
 * Usage (from backend/):
 *   npx tsx scripts/reset-super-admin-password.ts
 *   npx tsx scripts/reset-super-admin-password.ts someone@wudox.com 'Custom-Password!'
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2] ?? 'hassan@wudox.com';
  const newPassword = process.argv[3] ?? 'Wudox-SuperAdmin-2025!';

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { email }, data: { passwordHash } });
  console.log(`Password updated for ${email}. They can log in with the new password immediately.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
