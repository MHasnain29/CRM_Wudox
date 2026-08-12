/**
 * Purely fictional fixtures for local/dev recruitment seeding.
 * No real company names, contacts, or PDFs — safe for demos and QA.
 */

export type DummyActiveClient = {
  key: string;
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes?: string;
  status?: 'active' | 'inactive';
};

export type DummyJob = {
  clientKey: string;
  title: string;
  location: string;
  department: string;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions: number;
  employmentType: 'full_time' | 'part_time' | 'contract' | 'temporary';
  shift: { startTime: string; endTime: string; workDays: string[] };
  salaryMin: number;
  salaryMax: number | null;
  minExperienceYears: number;
  educationLevel: string;
  requiredSkills: string[];
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
};

export type DummyEmployee = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  province: string;
  postalCode: string;
  address: string;
  position: string;
  skills: string[];
  /** Optional variety: default Master (approved + docs + trainings). */
  tier?: 'master' | 'pending' | 'unregistered';
};

const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const MON_SAT = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DUMMY_ACTIVE_CLIENTS: DummyActiveClient[] = [
  {
    key: 'northstar',
    name: 'Northstar Packaging Co (Dummy)',
    industry: 'Food Packaging',
    location: '120 Dummy Parkway, Mississauga, ON L5B 0A1',
    contactName: 'Alex Rivera',
    contactEmail: 'alex.rivera@northstar-dummy.example',
    contactPhone: '+1-905-555-0101',
  },
  {
    key: 'lakeside',
    name: 'Lakeside Millwork (Dummy)',
    industry: 'Manufacturing / Millwork',
    location: '88 Sample Rd, Etobicoke, ON M8W 1T3',
    contactName: 'Jordan Lee',
    contactEmail: 'jordan.lee@lakeside-dummy.example',
    contactPhone: '+1-416-555-0102',
  },
  {
    key: 'harbor',
    name: 'Harbor Line Logistics (Dummy)',
    industry: 'Logistics & Warehousing',
    location: '45 Test Court, Brampton, ON L6T 0A1',
    contactName: 'Sam Okonkwo',
    contactEmail: 'sam.okonkwo@harbor-dummy.example',
    contactPhone: '+1-905-555-0103',
  },
  {
    key: 'citycare',
    name: 'CityCare Clinics (Dummy)',
    industry: 'Healthcare',
    location: '200 Demo Ave, Toronto, ON M5H 2N2',
    contactName: 'Dr. Priya Shah',
    contactEmail: 'priya.shah@citycare-dummy.example',
    contactPhone: '+1-416-555-0104',
  },
  {
    key: 'brightpath',
    name: 'BrightPath Learning (Dummy)',
    industry: 'Education',
    location: '15 Fiction Blvd, North York, ON M2N 5W9',
    contactName: 'Casey Morgan',
    contactEmail: 'casey.morgan@brightpath-dummy.example',
    contactPhone: '+1-416-555-0105',
  },
  {
    key: 'summit',
    name: 'Summit Retail Hub (Dummy)',
    industry: 'Retail',
    location: '900 Placeholder St, Scarborough, ON M1B 2K1',
    contactName: 'Taylor Kim',
    contactEmail: 'taylor.kim@summit-dummy.example',
    contactPhone: '+1-416-555-0106',
  },
  {
    key: 'aurora',
    name: 'Aurora Foods Plant (Dummy)',
    industry: 'Food Production',
    location: '77 Mock Lane, Markham, ON L3R 0B2',
    contactName: 'Morgan Ellis',
    contactEmail: 'morgan.ellis@aurora-dummy.example',
    contactPhone: '+1-905-555-0107',
  },
  {
    key: 'pinnacle',
    name: 'Pinnacle Guard Services (Dummy)',
    industry: 'Security',
    location: '3 Example Way, Toronto, ON M5V 2T6',
    contactName: 'Riley Chen',
    contactEmail: 'riley.chen@pinnacle-dummy.example',
    contactPhone: '+1-416-555-0108',
  },
  {
    key: 'seasonal',
    name: 'Seasonal Textiles Inc (Dummy)',
    industry: 'Manufacturing',
    location: '55 Offseason Dr, Mississauga, ON L5N 1A1',
    contactName: 'Quinn Patel',
    contactEmail: 'quinn.patel@seasonal-dummy.example',
    contactPhone: '+1-905-555-0109',
    status: 'inactive',
    notes: 'Dummy inactive client — for filter/status QA only.',
  },
];

export const DUMMY_JOBS: DummyJob[] = [
  {
    clientKey: 'northstar',
    title: 'Warehouse Associate',
    location: 'Mississauga, Ontario',
    department: 'Production',
    description:
      'Pick, pack, and stage finished goods. Keep work areas clean and follow food-safety rules. Use scanners for inventory moves and report damaged stock.',
    requirements: 'Prior warehouse or general labour experience preferred',
    responsibilities: 'Order picking, packing, sanitation, pallet staging',
    openPositions: 4,
    employmentType: 'full_time',
    shift: { startTime: '06:30', endTime: '15:00', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: 19.5,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'General Labour'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'northstar',
    title: 'Line Packer',
    location: 'Mississauga, Ontario',
    department: 'Production',
    description:
      'Work on a packaging line: label, wrap, and stack products. Maintain pace and quality checks under supervisor direction.',
    requirements: 'Ability to stand for full shift; lifting up to 40 lbs',
    responsibilities: 'Labelling, wrapping, stacking, quality checks',
    openPositions: 2,
    employmentType: 'full_time',
    shift: { startTime: '14:00', endTime: '22:30', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: 18.5,
    minExperienceYears: 0,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'Picker / Packer'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'lakeside',
    title: 'Sander / Finisher',
    location: 'Etobicoke, Ontario',
    department: 'Manufacturing',
    description:
      'Sand wood surfaces, prep for finish, and apply stains/sealants. Inspect pieces against quality standards.',
    requirements: 'Woodworking or millwork experience preferred',
    responsibilities: 'Sanding, finishing, quality inspection',
    openPositions: 2,
    employmentType: 'full_time',
    shift: { startTime: '07:00', endTime: '17:00', workDays: MON_FRI },
    salaryMin: 18.0,
    salaryMax: 22.0,
    minExperienceYears: 0.5,
    educationLevel: 'High School',
    requiredSkills: ['General Labour', 'Woodworking'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'harbor',
    title: 'Forklift Operator',
    location: 'Brampton, Ontario',
    department: 'Warehouse',
    description:
      'Move pallets with forklift, load/unload trailers, and keep staging areas organized. Follow site safety rules.',
    requirements: 'Valid forklift certification required',
    responsibilities: 'Forklift moves, dock loading, inventory staging',
    openPositions: 3,
    employmentType: 'full_time',
    shift: { startTime: '06:00', endTime: '14:30', workDays: MON_SAT },
    salaryMin: 20.0,
    salaryMax: 24.0,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'Forklift'],
    licenseRequired: true,
    requiredLicenseTypes: ['Forklift'],
  },
  {
    clientKey: 'harbor',
    title: 'Warehouse Associate',
    location: 'Brampton, Ontario',
    department: 'Warehouse',
    description:
      'Receive inbound freight, put away stock, and support outbound picks. Maintain clean aisles and accurate counts.',
    requirements: 'Warehouse experience; scanner comfort a plus',
    responsibilities: 'Receiving, put-away, picking, housekeeping',
    openPositions: 5,
    employmentType: 'full_time',
    shift: { startTime: '07:00', endTime: '15:30', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: 19.0,
    minExperienceYears: 0,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'General Labour'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'citycare',
    title: 'Personal Support Worker',
    location: 'Toronto, Ontario',
    department: 'Clinical',
    description:
      'Assist patients with daily living activities, document care notes, and work with nursing staff on shift goals.',
    requirements: 'PSW certificate preferred; reliable attendance',
    responsibilities: 'ADL support, documentation, team handoffs',
    openPositions: 3,
    employmentType: 'full_time',
    shift: { startTime: '07:00', endTime: '19:00', workDays: MON_FRI },
    salaryMin: 22.0,
    salaryMax: 26.0,
    minExperienceYears: 1,
    educationLevel: 'Certificate',
    requiredSkills: ['Healthcare', 'PSW'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'citycare',
    title: 'Clinic Receptionist',
    location: 'Toronto, Ontario',
    department: 'Administration',
    description:
      'Greet patients, schedule appointments, and manage front-desk intake. Handle phone inquiries professionally.',
    requirements: 'Customer service experience; EMR comfort a plus',
    responsibilities: 'Scheduling, intake, phones, filing',
    openPositions: 1,
    employmentType: 'part_time',
    shift: { startTime: '09:00', endTime: '14:00', workDays: MON_FRI },
    salaryMin: 18.5,
    salaryMax: 21.0,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Customer Service', 'Admin'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'brightpath',
    title: 'Teaching Assistant',
    location: 'North York, Ontario',
    department: 'Education',
    description:
      'Support classroom teachers with small-group activities, supervision, and materials prep.',
    requirements: 'Experience with children; vulnerable sector check required on hire',
    responsibilities: 'Classroom support, supervision, materials',
    openPositions: 2,
    employmentType: 'contract',
    shift: { startTime: '08:30', endTime: '15:30', workDays: MON_FRI },
    salaryMin: 19.0,
    salaryMax: 22.0,
    minExperienceYears: 0.5,
    educationLevel: 'College',
    requiredSkills: ['Education', 'Childcare'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'summit',
    title: 'Retail Associate',
    location: 'Scarborough, Ontario',
    department: 'Sales Floor',
    description:
      'Help customers, restock shelves, and process POS transactions. Keep the floor presentation-ready.',
    requirements: 'Retail or customer service experience preferred',
    responsibilities: 'Customer service, stocking, POS',
    openPositions: 4,
    employmentType: 'part_time',
    shift: { startTime: '12:00', endTime: '20:00', workDays: MON_SAT },
    salaryMin: 17.2,
    salaryMax: 18.5,
    minExperienceYears: 0,
    educationLevel: 'High School',
    requiredSkills: ['Customer Service', 'Retail'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'aurora',
    title: 'Production Worker',
    location: 'Markham, Ontario',
    department: 'Production',
    description:
      'Operate or tend food production equipment, follow HACCP steps, and keep stations sanitized.',
    requirements: 'Food plant or manufacturing experience preferred',
    responsibilities: 'Line work, sanitation, quality checks',
    openPositions: 6,
    employmentType: 'full_time',
    shift: { startTime: '06:00', endTime: '14:30', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: 20.0,
    minExperienceYears: 0,
    educationLevel: 'High School',
    requiredSkills: ['General Labour', 'Food Production'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'aurora',
    title: 'Sanitation Associate',
    location: 'Markham, Ontario',
    department: 'Sanitation',
    description:
      'Deep-clean production areas after shifts. Follow chemical handling and lockout procedures.',
    requirements: 'Comfortable with chemicals and wet environments',
    responsibilities: 'Cleaning, chemical use, equipment washdowns',
    openPositions: 2,
    employmentType: 'full_time',
    shift: { startTime: '22:00', endTime: '06:00', workDays: MON_FRI },
    salaryMin: 18.0,
    salaryMax: 20.5,
    minExperienceYears: 0,
    educationLevel: 'High School',
    requiredSkills: ['General Labour', 'Sanitation'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'pinnacle',
    title: 'Security Guard',
    location: 'Toronto, Ontario',
    department: 'Site Security',
    description:
      'Monitor access points, patrol premises, and write incident reports. Professional presence required.',
    requirements: 'Valid Ontario Security Guard License',
    responsibilities: 'Access control, patrols, reporting',
    openPositions: 3,
    employmentType: 'full_time',
    shift: { startTime: '18:00', endTime: '06:00', workDays: MON_FRI },
    salaryMin: 18.5,
    salaryMax: 21.0,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Security', 'Customer Service'],
    licenseRequired: true,
    requiredLicenseTypes: ['Security Guard'],
  },
];

/** Master / pending / unregistered pool for link-to-job QA. */
export const DUMMY_EMPLOYEES: DummyEmployee[] = [
  // Master — warehouse / general labour (match Northstar + Harbor + Aurora)
  {
    firstName: 'Ava',
    lastName: 'Nguyen',
    email: 'ava.nguyen.dummy@mail.example',
    phone: '+1-416-555-7001',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5B 1M2',
    address: '10 Dummy Cres, Mississauga',
    position: 'Warehouse Associate',
    skills: ['Warehouse', 'General Labour', 'Picker / Packer'],
  },
  {
    firstName: 'Liam',
    lastName: 'Patel',
    email: 'liam.patel.dummy@mail.example',
    phone: '+1-416-555-7002',
    city: 'Brampton',
    province: 'Ontario',
    postalCode: 'L6T 0A1',
    address: '22 Sample St N, Brampton',
    position: 'Warehouse Associate',
    skills: ['Warehouse', 'General Labour'],
  },
  {
    firstName: 'Mia',
    lastName: 'Singh',
    email: 'mia.singh.dummy@mail.example',
    phone: '+1-416-555-7003',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M9W 1A1',
    address: '100 Rexdale Dummy Blvd, Toronto',
    position: 'Line Packer',
    skills: ['Warehouse', 'Picker / Packer', 'Food Production'],
  },
  {
    firstName: 'Noah',
    lastName: 'Brooks',
    email: 'noah.brooks.dummy@mail.example',
    phone: '+1-416-555-7004',
    city: 'Brampton',
    province: 'Ontario',
    postalCode: 'L6Y 2T4',
    address: '55 Forklift Dummy Rd, Brampton',
    position: 'Forklift Operator',
    skills: ['Warehouse', 'Forklift'],
  },
  {
    firstName: 'Sofia',
    lastName: 'Martinez',
    email: 'sofia.martinez.dummy@mail.example',
    phone: '+1-416-555-7005',
    city: 'Etobicoke',
    province: 'Ontario',
    postalCode: 'M8W 1T3',
    address: '81 Wood Dummy Rd, Etobicoke',
    position: 'Sander',
    skills: ['General Labour', 'Woodworking'],
  },
  {
    firstName: 'Ethan',
    lastName: 'Kim',
    email: 'ethan.kim.dummy@mail.example',
    phone: '+1-416-555-7006',
    city: 'Markham',
    province: 'Ontario',
    postalCode: 'L3R 0B2',
    address: '40 Plant Dummy Ave, Markham',
    position: 'Production Worker',
    skills: ['General Labour', 'Food Production', 'Sanitation'],
  },
  {
    firstName: 'Olivia',
    lastName: 'Chen',
    email: 'olivia.chen.dummy@mail.example',
    phone: '+1-416-555-7007',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M5H 2N2',
    address: '200 Clinic Dummy Ave, Toronto',
    position: 'Personal Support Worker',
    skills: ['Healthcare', 'PSW'],
  },
  {
    firstName: 'Lucas',
    lastName: 'Wright',
    email: 'lucas.wright.dummy@mail.example',
    phone: '+1-416-555-7008',
    city: 'North York',
    province: 'Ontario',
    postalCode: 'M2N 5W9',
    address: '15 School Dummy Blvd, North York',
    position: 'Teaching Assistant',
    skills: ['Education', 'Childcare'],
  },
  {
    firstName: 'Emma',
    lastName: 'Lopez',
    email: 'emma.lopez.dummy@mail.example',
    phone: '+1-416-555-7009',
    city: 'Scarborough',
    province: 'Ontario',
    postalCode: 'M1B 2K1',
    address: '90 Retail Dummy St, Scarborough',
    position: 'Retail Associate',
    skills: ['Customer Service', 'Retail', 'Admin'],
  },
  {
    firstName: 'James',
    lastName: 'Okoro',
    email: 'james.okoro.dummy@mail.example',
    phone: '+1-416-555-7010',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M5V 2T6',
    address: '3 Guard Dummy Way, Toronto',
    position: 'Security Guard',
    skills: ['Security', 'Customer Service'],
  },
  {
    firstName: 'Hannah',
    lastName: 'Ali',
    email: 'hannah.ali.dummy@mail.example',
    phone: '+1-416-555-7011',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5N 1A1',
    address: '12 Labour Dummy Dr, Mississauga',
    position: 'General Labourer',
    skills: ['General Labour', 'Warehouse', 'Sanitation'],
  },
  {
    firstName: 'Owen',
    lastName: 'Park',
    email: 'owen.park.dummy@mail.example',
    phone: '+1-416-555-7012',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M4C 1B5',
    address: '70 Admin Dummy Rd, Toronto',
    position: 'Office Administrator',
    skills: ['Admin', 'Customer Service'],
  },
  // Pending — incomplete Master gate (docs only, no trainings)
  {
    firstName: 'Zoe',
    lastName: 'Harris',
    email: 'zoe.harris.dummy@mail.example',
    phone: '+1-416-555-7013',
    city: 'Brampton',
    province: 'Ontario',
    postalCode: 'L6P 0A2',
    address: '8 Pending Dummy Lane, Brampton',
    position: 'Warehouse Associate',
    skills: ['Warehouse', 'General Labour'],
    tier: 'pending',
  },
  // Unregistered — no docs / trainings
  {
    firstName: 'Leo',
    lastName: 'Garcia',
    email: 'leo.garcia.dummy@mail.example',
    phone: '+1-416-555-7014',
    city: 'Toronto',
    province: 'Ontario',
    postalCode: 'M6H 1A1',
    address: '19 Newhire Dummy St, Toronto',
    position: 'Warehouse Associate',
    skills: ['Warehouse'],
    tier: 'unregistered',
  },
];

/** Mirror of employeeDefaultTraining.DEFAULT_EMPLOYEE_TRAININGS */
export const DUMMY_DEFAULT_TRAININGS = [
  {
    title: 'Ontario Health & Safety — 4 Steps',
    url: 'https://www.labour.gov.on.ca/english/hs/elearn/worker/foursteps.php',
  },
  {
    title: 'WHMIS',
    url: 'https://aixsafety.com/',
  },
] as const;

export const DUMMY_REQUIRED_DOC_TYPES = [
  { type: 'photo_id' as const, name: 'Photo ID', fileName: 'photo-id.pdf' },
  { type: 'sin' as const, name: 'SIN Document', fileName: 'sin.pdf' },
  { type: 'proof_of_status' as const, name: 'Proof of Status', fileName: 'status.pdf' },
  { type: 'agreement' as const, name: 'Employment Agreement', fileName: 'agreement.pdf' },
];

export const DEFAULT_BACKUP_PERCENTAGE = 70;
