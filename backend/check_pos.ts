import prisma from './src/config/database';
async function main() {
  const leads = await prisma.lead.findMany({
    where: { status: 'closed_won' },
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: {
      id: true, closedAt: true, ownerId: true,
      proposals: {
        select: {
          id: true, status: true, activatedAt: true,
          positions: { select: { name: true, count: true } }
        }
      }
    }
  });
  console.log(JSON.stringify(leads, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
