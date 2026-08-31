/**
 * Idempotent Mississauga dummy team used by CLI and Settings → Danger Zone.
 * No env gates. Does not go through user-create approval.
 */
import type { Country } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import prisma from '../config/database';

export const SEED_TEAM_PASSWORD = 'Password@123';
const AGENCY_MATCH = 'Mississauga';

type SeedRole =
  | 'company_director'
  | 'sales_manager'
  | 'marketing'
  | 'sales_associate'
  | 'sales_executive';

interface SeedUser {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  role: SeedRole;
  userType: string;
  country: Country;
  dailyCalls: number;
  dailyEmails: number;
}

const TEAM: SeedUser[] = [
  {
    email: 'ayesha.raza@wudox.ca',
    firstName: 'Ayesha',
    lastName: 'Raza',
    phone: '+1 (416) 555-0188',
    role: 'company_director',
    userType: 'Company Director',
    country: 'Canada',
    dailyCalls: 0,
    dailyEmails: 0,
  },
  {
    email: 'bilal.hussain@wudox.ca',
    firstName: 'Bilal',
    lastName: 'Hussain',
    phone: '+1 (416) 555-0199',
    role: 'sales_manager',
    userType: 'Sales Manager',
    country: 'Canada',
    dailyCalls: 40,
    dailyEmails: 20,
  },
  {
    email: 'marketing@wudox.ca',
    firstName: 'Nadia',
    lastName: 'Malik',
    phone: '+1 (647) 615-5582',
    role: 'marketing',
    userType: 'Sales & Marketing Executive',
    country: 'Canada',
    dailyCalls: 40,
    dailyEmails: 25,
  },
  {
    email: 'omar.farooq@wudox.ca',
    firstName: 'Omar',
    lastName: 'Farooq',
    phone: '+1 (416) 555-0142',
    role: 'sales_associate',
    userType: 'Sales Associate',
    country: 'Canada',
    dailyCalls: 50,
    dailyEmails: 30,
  },
  {
    email: 'zara.ahmed@wudox.ca',
    firstName: 'Zara',
    lastName: 'Ahmed',
    phone: '+1 (416) 555-0143',
    role: 'sales_executive',
    userType: 'Sales Executive',
    country: 'Canada',
    dailyCalls: 45,
    dailyEmails: 25,
  },
];

export type SeedTeamRow = {
  email: string;
  name: string;
  role: string;
  action: string;
};

export type SeedTeamResult = {
  agencyName: string;
  directorName: string;
  directorEmail: string;
  locationName: string;
  password: string;
  rows: SeedTeamRow[];
};

async function roleIdFor(key: string): Promise<string | null> {
  const row = await prisma.rbacRole.findFirst({
    where: { key, isActive: true },
    select: { id: true },
  });
  return row?.id ?? null;
}

export async function seedMississaugaTeam(): Promise<SeedTeamResult> {
  const agency = await prisma.subCompany.findFirst({
    where: { name: { contains: AGENCY_MATCH, mode: 'insensitive' } },
    select: { id: true, name: true },
  });
  if (!agency) {
    throw new Error(`No agency matching "${AGENCY_MATCH}" found. Create it in Settings first.`);
  }

  const director =
    (await prisma.user.findFirst({
      where: {
        role: 'director',
        isActive: true,
        OR: [
          { firstName: { contains: 'Saad', mode: 'insensitive' } },
          { lastName: { contains: 'Abdullah', mode: 'insensitive' } },
          { lastName: { contains: 'Masood', mode: 'insensitive' } },
        ],
      },
      select: { id: true, firstName: true, lastName: true, email: true },
    })) ??
    (await prisma.user.findFirst({
      where: { role: 'director', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, firstName: true, lastName: true, email: true },
    }));
  if (!director) {
    throw new Error('No org Director found. Add a Director in Super Users first.');
  }

  const location =
    (await prisma.location.findFirst({
      where: { isActive: true, country: 'Canada' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, country: true },
    })) ??
    (await prisma.location.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, country: true },
    }));
  if (!location) {
    throw new Error('No active location found. Add a location in Settings first.');
  }

  const passwordHash = await bcrypt.hash(SEED_TEAM_PASSWORD, 12);
  const rows: SeedTeamRow[] = [];
  const ids: Partial<Record<SeedRole, string>> = {};

  const existingCd = await prisma.user.findFirst({
    where: { subCompanyId: agency.id, role: 'company_director', isActive: true },
    select: { id: true, email: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existingCd) ids.company_director = existingCd.id;

  for (const u of TEAM) {
    const email = u.email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });

    if (u.role === 'company_director' && existingCd && !existing) {
      rows.push({
        email: existingCd.email,
        name: `${existingCd.firstName} ${existingCd.lastName}`,
        role: u.userType,
        action: 'skipped (agency already has a Company Director)',
      });
      continue;
    }

    const rbacId = await roleIdFor(u.role);
    const reportingManagerIds =
      u.role === 'company_director'
        ? [director.id]
        : u.role === 'sales_manager'
          ? ids.company_director
            ? [ids.company_director]
            : [director.id]
          : ids.sales_manager
            ? [ids.sales_manager]
            : ids.company_director
              ? [ids.company_director]
              : [director.id];

    if (existing) {
      ids[u.role] = existing.id;
      if (u.role === 'marketing') {
        await prisma.user.update({
          where: { id: existing.id },
          data: {
            passwordHash,
            phone: u.phone,
            reportingManagerIds,
            isActive: true,
          },
        });
        rows.push({
          email,
          name: `${u.firstName} ${u.lastName}`,
          role: u.userType,
          action: 'updated password / phone / reporting',
        });
      } else {
        rows.push({
          email,
          name: `${u.firstName} ${u.lastName}`,
          role: u.userType,
          action: `skipped (already exists as ${existing.role})`,
        });
      }
      continue;
    }

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: u.firstName,
        lastName: u.lastName,
        phone: u.phone,
        country: u.country,
        role: u.role,
        roleId: rbacId,
        userType: u.userType,
        subCompanyId: agency.id,
        locationId: u.role === 'company_director' ? null : location.id,
        reportingManagerIds,
        accessibleLocationIds: [],
        dailyCallsTarget: u.dailyCalls,
        dailyEmailsTarget: u.dailyEmails,
        isActive: true,
      },
    });
    ids[u.role] = user.id;
    rows.push({
      email,
      name: `${u.firstName} ${u.lastName}`,
      role: u.userType,
      action: 'created',
    });
  }

  const cdId = ids.company_director;
  if (cdId) {
    const sms = await prisma.user.findMany({
      where: { subCompanyId: agency.id, role: 'sales_manager', isActive: true },
      select: { id: true, reportingManagerIds: true },
    });
    for (const sm of sms) {
      if (sm.reportingManagerIds.includes(cdId)) continue;
      await prisma.user.update({
        where: { id: sm.id },
        data: { reportingManagerIds: [cdId] },
      });
    }
  }

  return {
    agencyName: agency.name,
    directorName: `${director.firstName} ${director.lastName}`,
    directorEmail: director.email,
    locationName: location.name,
    password: SEED_TEAM_PASSWORD,
    rows,
  };
}
