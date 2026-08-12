/**
 * Fill / refresh demo employee profiles so edit form opens fully prefilled.
 * Updates ALL employees with complete demo data (keeps name/email/phone/address/skills).
 * Never writes SIN digits.
 *
 * Run: npx tsx prisma/backfillEmployeeDemoProfiles.ts
 */
import type { Prisma } from '@prisma/client';
import prisma from '../src/config/database';

const DEMO_FEMALE_FIRST = new Set([
  'Priya', 'Sofia', 'Hannah', 'Ava', 'Mia', 'Isla', 'Emma', 'Chloe', 'Zoe', 'Grace',
  'Nina', 'Sara', 'Fatima', 'Amelia', 'Layla', 'Ella', 'Hana', 'Maya', 'Leah', 'Ivy',
  'Nora', 'Ruby', 'Alice', 'Elena', 'Tara', 'Julia', 'Nadia', 'Carmen', 'Rita', 'Paula',
  'Monica', 'Irene', 'Diana', 'Helen', 'Wendy', 'Olivia', 'Aria', 'Sienna', 'Freya',
  'Quinn', 'Luna', 'Casey', 'Riley', 'Jordan', 'Sam', 'Blake',
]);

const PHOTO_ID_TYPES = ['drivers_license', 'passport', 'provincial_id', 'other_government_id'] as const;
const EDUCATION_LEVELS = ['High School', "Bachelor's", 'College Diploma', 'Trade Certificate'] as const;
const COURSES = [
  'Business Administration',
  'Supply Chain Management',
  'Health Care Aide',
  'Industrial Mechanics',
  'Early Childhood Education',
  'Computer Networking',
  'Culinary Arts',
  'General Arts & Science',
];
const COMPANIES_A = [
  'Maple Leaf Logistics',
  'Harbour View Manufacturing',
  'Summit Care Homes',
  'Northline Packaging',
  'Cedar Grove Foods',
];
const COMPANIES_B = [
  'TempForce Staffing',
  'QuickHire Solutions',
  'Urban Works Agency',
  'Prime Shift Labour',
];

function daysFromNow(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function licensesFromDocs(
  docs: Array<{ id: string; name: string; expiryDate: Date | null }>,
): Array<{ licenseType: string; expiryDate: string; docId: string | null }> {
  const prefix = 'license — ';
  const byType = new Map<string, { licenseType: string; expiryDate: string; docId: string | null }>();
  for (const d of docs) {
    if (!d.name.toLowerCase().startsWith(prefix)) continue;
    const rest = d.name.slice(prefix.length);
    const licenseType = (rest.split(' — ')[0] ?? rest).trim();
    if (!licenseType) continue;
    byType.set(licenseType, {
      licenseType,
      expiryDate: d.expiryDate ? d.expiryDate.toISOString().slice(0, 10) : daysFromNow(180).toISOString().slice(0, 10),
      docId: d.id,
    });
  }
  return [...byType.values()];
}

async function main() {
  const all = await prisma.employee.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      position: true,
      skills: true,
      city: true,
      province: true,
      documents: { select: { id: true, type: true, name: true, expiryDate: true } },
      workExperiences: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Filling ${all.length} employees with full demo profiles…`);
  let updated = 0;

  for (let index = 0; index < all.length; index++) {
    const emp = all[index]!;
    const gender = DEMO_FEMALE_FIRST.has(emp.firstName) ? ('female' as const) : ('male' as const);
    const birthYear = 1984 + (index % 20);
    const birthMonth = (index % 12) + 1;
    const birthDay = (index % 27) + 1;
    const dateOfBirth = new Date(
      `${birthYear}-${String(birthMonth).padStart(2, '0')}-${String(birthDay).padStart(2, '0')}T12:00:00.000Z`,
    );
    const eduLevel = EDUCATION_LEVELS[index % EDUCATION_LEVELS.length]!;
    const fromYear = 2004 + (index % 12);
    const graduated = index % 5 !== 0;
    const endYear = graduated ? fromYear + 2 + (index % 3) : null;
    const course = COURSES[index % COURSES.length]!;
    const photoIdType = PHOTO_ID_TYPES[index % PHOTO_ID_TYPES.length]!;
    const photoIdExpiry = daysFromNow(365 + (index % 400));
    const statusDocExpiry = daysFromNow(450 + (index % 200));
    const sinDocExpiry = daysFromNow(700 + (index % 300));
    const photoIdExpiryStr = photoIdExpiry.toISOString().slice(0, 10);
    const statusDocExpiryStr = statusDocExpiry.toISOString().slice(0, 10);
    const sinDocExpiryStr = sinDocExpiry.toISOString().slice(0, 10);
    const licenses = licensesFromDocs(emp.documents);
    const english = index % 3 === 0 ? ['All'] : index % 3 === 1 ? ['Speak', 'Read', 'Write'] : ['Speak', 'Read'];
    const payment = index % 2 === 0 ? ('cheque' as const) : ('deposit' as const);
    const ableTwelve = index % 3 !== 0;
    const residency = (['citizen', 'pr', 'work_permit', 'citizen'] as const)[index % 4]!;

    const uiExtras = {
      skills: emp.skills ?? [],
      noWorkExperience: false,
      extraEducation: [] as unknown[],
      extraExperiences: [] as unknown[],
      assignedClientId: '',
      assignedClientName: '',
      photoIdType,
      photoIdNumber: `${photoIdType === 'passport' ? 'P' : 'DL'}-${200000 + index}`,
      photoIdExpiry: photoIdExpiryStr,
      statusDocExpiry: statusDocExpiryStr,
      sinDocExpiry: sinDocExpiryStr,
      licensesNotApplicable: licenses.length === 0,
      licenses,
      profilePhotoDocId: null as string | null,
    };

    await prisma.employee.update({
      where: { id: emp.id },
      data: {
        gender,
        dateOfBirth,
        addressLine2: index % 4 === 0 ? `Unit ${100 + index}` : null,
        country: 'Canada',
        emergencyContactName: `${emp.firstName}'s Emergency Contact`,
        emergencyContactPhone: `+1-416-555-${String(3100 + (index % 6800)).padStart(4, '0')}`,
        educationLevel: eduLevel,
        educationFromYear: fromYear,
        educationEndYear: endYear,
        graduated,
        courseStudied: course,
        diplomaName: graduated ? `${eduLevel} — ${course}` : null,
        experienceDuties:
          'Reliable team member with experience in warehouse, production, and client-facing support. Comfortable with shift work and safety procedures.',
        availableFrom: daysFromNow(index % 28),
        ableTwelveHourShift: ableTwelve,
        englishProficiency: english,
        residencyStatus: residency,
        shiftsAvailable: index % 2 === 0 ? ['Day', 'Afternoon'] : ['Day', 'Afternoon', 'Night'],
        salaryPaymentMethod: payment,
        bankName: payment === 'deposit' ? 'Royal Demo Bank' : null,
        bankInstitutionNumber: payment === 'deposit' ? '003' : null,
        bankTransitNumber: payment === 'deposit' ? String(10000 + (index % 89999)).padStart(5, '0') : null,
        bankAccountNumber: payment === 'deposit' ? `22${String(3000000 + index).slice(-7)}` : null,
        uiExtras: uiExtras as unknown as Prisma.InputJsonValue,
      },
    });

    for (const doc of emp.documents) {
      let expiry: Date | null = null;
      if (doc.type === 'photo_id') expiry = photoIdExpiry;
      else if (doc.type === 'sin') expiry = sinDocExpiry;
      else if (doc.type === 'proof_of_status') expiry = statusDocExpiry;
      else if (doc.name.toLowerCase().startsWith('license — ') && !doc.expiryDate) {
        expiry = daysFromNow(200 + (index % 100));
      }
      if (!expiry) continue;
      await prisma.employeeDocument.update({
        where: { id: doc.id },
        data: { expiryDate: expiry },
      });
    }

    // Replace work experiences with two solid demo rows
    await prisma.employeeWorkExperience.deleteMany({ where: { employeeId: emp.id } });
    await prisma.employeeWorkExperience.createMany({
      data: [
        {
          employeeId: emp.id,
          companyName: COMPANIES_A[index % COMPANIES_A.length]!,
          contactNumber: `+1-416-555-${String(4000 + (index % 500)).padStart(4, '0')}`,
          position: emp.position || 'Associate',
          duration: `${1 + (index % 4)} years`,
          sortOrder: 1,
        },
        {
          employeeId: emp.id,
          companyName: COMPANIES_B[index % COMPANIES_B.length]!,
          contactNumber: `+1-647-555-${String(5000 + (index % 400)).padStart(4, '0')}`,
          position: 'General Labour',
          duration: `${6 + (index % 10)} months`,
          sortOrder: 2,
        },
      ],
    });

    // Void cheque / deposit form required when payment method is deposit
    if (payment === 'deposit') {
      const hasDeposit = emp.documents.some((d) => d.type === 'bank_deposit');
      if (!hasDeposit) {
        const addedBy = await prisma.employee.findUnique({
          where: { id: emp.id },
          select: { addedById: true },
        });
        if (addedBy?.addedById) {
          await prisma.employeeDocument.create({
            data: {
              employeeId: emp.id,
              type: 'bank_deposit',
              name: 'deposit — void-cheque.pdf',
              fileName: 'void-cheque.pdf',
              fileSize: 10_000,
              mimeType: 'application/pdf',
              url: `seed://employees/${emp.id}/void-cheque.pdf`,
              uploadedById: addedBy.addedById,
            },
          });
        }
      }
    }

    updated += 1;
    console.log(`  ✓ ${emp.firstName} ${emp.lastName}`);
  }

  console.log(`\nDone — filled ${updated}/${all.length} employees`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
