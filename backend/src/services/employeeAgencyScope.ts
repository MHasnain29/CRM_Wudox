/**
 * Resolve the agency that owns an employee / assignment (via adder's subCompanyId).
 * Used so multi-agency approvers always act against the entity's agency, not agencyIds[0].
 */
import prisma from '../config/database';

export async function getEmployeeAgencyId(employeeId: string): Promise<string | null> {
  const row = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { addedBy: { select: { subCompanyId: true } } },
  });
  return row?.addedBy?.subCompanyId ?? null;
}

export async function getAssignmentAgencyId(assignmentId: string): Promise<string | null> {
  const row = await prisma.employeeAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      employee: { select: { addedBy: { select: { subCompanyId: true } } } },
    },
  });
  return row?.employee?.addedBy?.subCompanyId ?? null;
}
