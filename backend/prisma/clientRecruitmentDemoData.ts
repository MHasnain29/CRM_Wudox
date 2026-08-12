/**
 * Static fixtures for the client-facing recruitment demo package.
 * Compiled from Recruitment_Demo_Data/*.xlsx and employes/*.pdf.
 * Employee profiles fill every commonly shown form field for live demos.
 */

export type ClientDemoActiveClient = {
  key: string;
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes?: string;
};

export type ClientDemoJob = {
  clientKey: string;
  title: string;
  location: string;
  department: string;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions: number;
  employmentType: 'full_time' | 'part_time' | 'contract';
  shift: { startTime: string; endTime: string; workDays: string[] };
  salaryMin: number;
  salaryMax: number | null;
  minExperienceYears: number;
  educationLevel: string;
  requiredSkills: string[];
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
};

export type ClientDemoWorkExperience = {
  companyName: string;
  contactNumber: string;
  position: string;
  duration: string;
  sortOrder: number;
};

export type ClientDemoEmployee = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  alternatePhone: string;
  /** ISO date only: YYYY-MM-DD */
  dateOfBirth: string;
  gender: 'male' | 'female' | 'other';
  address: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  educationLevel: string;
  educationFromYear: number;
  educationEndYear: number;
  graduated: boolean;
  courseStudied: string;
  diplomaName: string;
  experienceDuties: string;
  /** Days from seed day when available (0 = today). */
  availableFromDaysOffset: number;
  availabilityTypes: Array<'full_time' | 'part_time'>;
  skills: string[];
  residencyStatus: 'citizen' | 'pr' | 'student' | 'refugee' | 'work_permit';
  shiftsAvailable: string[];
  ableTwelveHourShift: boolean;
  englishProficiency: string[];
  position: string;
  department: string;
  hourlyRate: number;
  salaryPaymentMethod: 'cheque' | 'deposit';
  bankName: string;
  bankInstitutionNumber: string;
  bankTransitNumber: string;
  bankAccountNumber: string;
  workExperiences: ClientDemoWorkExperience[];
  /** Optional sticky note on the employee profile. */
  profileNote: string;
  /** Relative to Recruitment_Demo_Data/ */
  packagePdfRelativePath: string;
};

export const CLIENT_DEMO_ACTIVE_CLIENTS: ClientDemoActiveClient[] = [
  {
    key: 'osmows',
    name: "Osmow's Shawarma",
    industry: 'Food Distribution / Restaurant',
    location: '407 Matheson Blvd E, Mississauga, ON L4Z 2H2',
    contactName: 'Gurpreet Singh',
    contactEmail: 'gurpreet@osmows.com',
    contactPhone: '(905) 624-5546 EXT. 241',
  },
  {
    key: 'awfi',
    name: 'All Wood Fine Interiors Ltd',
    industry: 'Manufacturing / Millwork',
    location: '81 Akron Rd, Toronto, ON M8W 1T3',
    contactName: 'Rhonda Kelly',
    contactEmail: 'Rhonda@awfiltd.com',
    contactPhone: '416-252-2552 ex. 225',
    notes:
      'Client training docs: https://drive.google.com/file/d/1B-rdpMutv2R9ckIz_CG10djF7DmAP3g2/view?usp=sharing',
  },
  {
    key: 'vmpl',
    name: 'Vaughan Mills Packaging',
    industry: 'Food Packaging',
    location: '60 Courtland Ave, Concord, ON L4K 5B3',
    contactName: 'Kamal Gill',
    contactEmail: 'kamalg@vmfoodgroup.com',
    contactPhone: '(905) 915-7555',
  },
];

const MON_FRI = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const CLIENT_DEMO_JOBS: ClientDemoJob[] = [
  {
    clientKey: 'osmows',
    title: 'Warehouse Associate',
    location: 'Mississauga, Ontario',
    department: 'Production',
    description:
      'Operate packaging equipment and machinery efficiently while maintaining quality standards. Support meat processing activities, including butchery and meat cutting under supervision. Maintain cleanliness and sanitation of work areas to comply with food safety regulations. Perform general labor tasks such as lifting, moving products, and organizing materials within the production line. Follow all safety protocols and procedures to ensure a safe working environment for yourself and colleagues.',
    requirements: 'Prior Warehouse experience',
    responsibilities: 'Order picking, packing, Cleaning',
    openPositions: 3,
    employmentType: 'full_time',
    shift: { startTime: '06:30', endTime: '15:00', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: null,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'General Labour'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'awfi',
    title: 'Sander',
    location: 'Toronto, Ontario',
    department: 'Manufacturing',
    description:
      'Sanded wood surfaces using hand tools and power sanders to achieve smooth, even finishes. Prepared wood products for finishing by removing imperfections, rough edges, and excess material. Applied stains, varnishes, sealants, and coatings to enhance appearance and durability. Inspected finished products to ensure quality standards and specifications were met. Operated sanding and finishing equipment safely and efficiently. Selected appropriate sandpaper grades and finishing materials based on project requirements.',
    requirements: 'Prior wood working experience in similar industry',
    responsibilities: 'Sanding, Finishing, Wood Working',
    openPositions: 1,
    employmentType: 'full_time',
    shift: { startTime: '07:00', endTime: '17:00', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: null,
    minExperienceYears: 0.5,
    educationLevel: 'High School',
    requiredSkills: ['General Labour'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
  {
    clientKey: 'vmpl',
    title: 'Warehouse Associate',
    location: 'Concord, Ontario',
    department: 'Production',
    description:
      'Label, wrap, and stack finished products on pallets. Maintain accurate inventory records using scanners or warehouse systems. Keep the warehouse clean and organized. Follow food safety, sanitation, and workplace safety procedures. Report damaged products or equipment to supervisors.',
    requirements: 'Warehouse experience in similar industry',
    responsibilities: 'Order packing, Labelling and Cleaning. Working on production lines',
    openPositions: 1,
    employmentType: 'full_time',
    // Excel time fractions: 0.25 = 06:00, 0.75 = 18:00
    shift: { startTime: '06:00', endTime: '18:00', workDays: MON_FRI },
    salaryMin: 17.6,
    salaryMax: null,
    minExperienceYears: 1,
    educationLevel: 'High School',
    requiredSkills: ['Warehouse', 'General Labour'],
    licenseRequired: false,
    requiredLicenseTypes: [],
  },
];

/** Shared sample document attachments (root of Recruitment_Demo_Data). */
export const CLIENT_DEMO_SHARED_PHOTO_ID = 'photo-id.pdf';
export const CLIENT_DEMO_SHARED_TRAINING_CERT = 'training-certificate.pdf';

/** Master pool: approved, workStatus none, agreement + trainings complete. Full profile fields. */
export const CLIENT_DEMO_EMPLOYEES: ClientDemoEmployee[] = [
  {
    firstName: 'Jashanpreet',
    lastName: 'Kaur',
    email: 'jashanpreet.kaur.demo@mail.demo',
    phone: '+1-416-555-7101',
    alternatePhone: '+1-905-555-7101',
    dateOfBirth: '1996-03-14',
    gender: 'female',
    address: '120 Square One Dr',
    addressLine2: 'Unit 604',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5B 1M2',
    country: 'Canada',
    emergencyContactName: 'Harpreet Kaur',
    emergencyContactPhone: '+1-416-555-8101',
    educationLevel: 'High School / GED',
    educationFromYear: 2010,
    educationEndYear: 2014,
    graduated: true,
    courseStudied: 'General Studies',
    diplomaName: 'Ontario Secondary School Diploma',
    experienceDuties:
      'Warehouse picking and packing, label verification, forklift assist, end-of-line cleaning, and food-safety sanitation procedures.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time', 'part_time'],
    skills: ['Warehouse', 'General Labour', 'Picker / Packer'],
    residencyStatus: 'pr',
    shiftsAvailable: ['Day', 'Afternoon'],
    ableTwelveHourShift: true,
    englishProficiency: ['Speak', 'Read', 'Write'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.6,
    salaryPaymentMethod: 'deposit',
    bankName: 'TD Canada Trust',
    bankInstitutionNumber: '004',
    bankTransitNumber: '12345',
    bankAccountNumber: '9876543',
    workExperiences: [
      {
        companyName: 'Metro Distribution Centre',
        contactNumber: '+1-905-555-2201',
        position: 'Warehouse Associate',
        duration: '1 year 4 months',
        sortOrder: 0,
      },
      {
        companyName: 'FreshPack Logistics',
        contactNumber: '+1-416-555-2202',
        position: 'Picker / Packer',
        duration: '8 months',
        sortOrder: 1,
      },
    ],
    profileNote:
      'Document package on file. WHMIS and Ontario 4 Steps complete. Ready for Osmow / VMPL warehouse placements.',
    packagePdfRelativePath: 'employes/Jashanpreet Kaur Docs....pdf',
  },
  {
    firstName: 'Harjappreet',
    lastName: 'Kaur',
    email: 'harjappreet.kaur.demo@mail.demo',
    phone: '+1-416-555-7102',
    alternatePhone: '+1-647-555-7102',
    dateOfBirth: '1995-07-19',
    gender: 'female',
    address: '88 Dundas St E',
    addressLine2: 'Apt 210',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5A 1W6',
    country: 'Canada',
    emergencyContactName: 'Gurpreet Singh',
    emergencyContactPhone: '+1-905-555-8102',
    educationLevel: 'College Diploma',
    educationFromYear: 2014,
    educationEndYear: 2017,
    graduated: true,
    courseStudied: 'Supply Chain Operations',
    diplomaName: 'Business – Supply Chain and Operations',
    experienceDuties:
      'Order picking, packing, inventory counts, staging for shipping, and sanitizing production areas.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time'],
    skills: ['Warehouse', 'General Labour', 'Shipping & Receiving'],
    residencyStatus: 'pr',
    shiftsAvailable: ['Day', 'Afternoon'],
    ableTwelveHourShift: true,
    englishProficiency: ['Speak', 'Read', 'Write'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.75,
    salaryPaymentMethod: 'deposit',
    bankName: 'RBC Royal Bank',
    bankInstitutionNumber: '003',
    bankTransitNumber: '03252',
    bankAccountNumber: '1122334',
    workExperiences: [
      {
        companyName: 'GTA Cold Storage',
        contactNumber: '+1-905-555-2210',
        position: 'Warehouse Associate',
        duration: '1 year 6 months',
        sortOrder: 0,
      },
    ],
    profileNote: 'Full package on file. Prefers day/afternoon. Strong match for Osmow warehouse line.',
    packagePdfRelativePath: 'employes/Harjappreet  Kaur Docs.pdf',
  },
  {
    firstName: 'Daljit',
    lastName: 'Kaur',
    email: 'daljit.kaur.demo@mail.demo',
    phone: '+1-416-555-7103',
    alternatePhone: '+1-289-555-7103',
    dateOfBirth: '1993-01-28',
    gender: 'female',
    address: '15 Peak Point Blvd',
    addressLine2: 'Unit 9',
    city: 'Vaughan',
    province: 'Ontario',
    postalCode: 'L4H 0A1',
    country: 'Canada',
    emergencyContactName: 'Sukhdeep Kaur',
    emergencyContactPhone: '+1-416-555-8103',
    educationLevel: 'High School / GED',
    educationFromYear: 2008,
    educationEndYear: 2012,
    graduated: true,
    courseStudied: 'General Studies',
    diplomaName: 'Ontario Secondary School Diploma',
    experienceDuties:
      'Labeling, wrapping, stacking pallets, production line support, and following food-packaging SOPs.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time', 'part_time'],
    skills: ['Warehouse', 'General Labour', 'Food Production', 'Picker / Packer'],
    residencyStatus: 'citizen',
    shiftsAvailable: ['Day', 'Afternoon', 'Night'],
    ableTwelveHourShift: true,
    englishProficiency: ['All'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.6,
    salaryPaymentMethod: 'deposit',
    bankName: 'Scotiabank',
    bankInstitutionNumber: '002',
    bankTransitNumber: '47691',
    bankAccountNumber: '5566778',
    workExperiences: [
      {
        companyName: 'Vaughan Foods Co-Pack',
        contactNumber: '+1-905-555-4401',
        position: 'Packaging Associate',
        duration: '2 years',
        sortOrder: 0,
      },
      {
        companyName: 'Maple Line Packaging',
        contactNumber: '+1-905-555-4402',
        position: 'General Labour',
        duration: '9 months',
        sortOrder: 1,
      },
    ],
    profileNote: 'Preferred VMPL candidate — prior Concord packaging experience. Flexible shifts including nights.',
    packagePdfRelativePath: 'employes/Daljit Kaur Docs... VMPL .pdf',
  },
  {
    firstName: 'Monika',
    lastName: 'Sharma',
    email: 'monika.sharma.demo@mail.demo',
    phone: '+1-416-555-7104',
    alternatePhone: '+1-905-555-7104',
    dateOfBirth: '1997-05-09',
    gender: 'female',
    address: '42 Keele St',
    addressLine2: 'Basement',
    city: 'Concord',
    province: 'Ontario',
    postalCode: 'L4K 2B3',
    country: 'Canada',
    emergencyContactName: 'Anil Sharma',
    emergencyContactPhone: '+1-416-555-8104',
    educationLevel: 'High School / GED',
    educationFromYear: 2011,
    educationEndYear: 2015,
    graduated: true,
    courseStudied: 'Hospitality Basics',
    diplomaName: 'Ontario Secondary School Diploma',
    experienceDuties:
      'Production packaging, quality label checks, cleanup, and warehouse organization for food products.',
    availableFromDaysOffset: 1,
    availabilityTypes: ['full_time'],
    skills: ['Warehouse', 'General Labour', 'Food Production'],
    residencyStatus: 'work_permit',
    shiftsAvailable: ['Day', 'Afternoon'],
    ableTwelveHourShift: false,
    englishProficiency: ['Speak', 'Read'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.6,
    salaryPaymentMethod: 'deposit',
    bankName: 'CIBC',
    bankInstitutionNumber: '010',
    bankTransitNumber: '00420',
    bankAccountNumber: '3344556',
    workExperiences: [
      {
        companyName: 'NorthLine Foods',
        contactNumber: '+1-905-555-4410',
        position: 'Packager',
        duration: '11 months',
        sortOrder: 0,
      },
    ],
    profileNote: 'VMPL-oriented package. Reliable on mid-week day shifts; work permit valid.',
    packagePdfRelativePath: 'employes/Monika VMPL .pdf',
  },
  {
    firstName: 'Rajdeep',
    lastName: 'Biswas',
    email: 'rajdeep.biswas.demo@mail.demo',
    phone: '+1-416-555-7105',
    alternatePhone: '+1-647-555-7105',
    dateOfBirth: '1991-12-02',
    gender: 'male',
    address: '300 Steeles Ave W',
    addressLine2: 'Apt 1508',
    city: 'Thornhill',
    province: 'Ontario',
    postalCode: 'L4J 1A1',
    country: 'Canada',
    emergencyContactName: 'Priya Biswas',
    emergencyContactPhone: '+1-647-555-8105',
    educationLevel: 'Bachelor’s Degree',
    educationFromYear: 2009,
    educationEndYear: 2013,
    graduated: true,
    courseStudied: 'Business Administration',
    diplomaName: 'Bachelor of Business Administration',
    experienceDuties:
      'Shipping/receiving, RF scanning, pallet builds, inventory adjustments, and production support.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time'],
    skills: ['Warehouse', 'Shipping & Receiving', 'Inventory Management', 'General Labour'],
    residencyStatus: 'pr',
    shiftsAvailable: ['Day', 'Afternoon', 'Night'],
    ableTwelveHourShift: true,
    englishProficiency: ['All'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 18.25,
    salaryPaymentMethod: 'deposit',
    bankName: 'BMO Bank of Montreal',
    bankInstitutionNumber: '001',
    bankTransitNumber: '24182',
    bankAccountNumber: '9988776',
    workExperiences: [
      {
        companyName: 'Amazon DSP Partner Hub',
        contactNumber: '+1-416-555-4501',
        position: 'Warehouse Associate',
        duration: '1 year 8 months',
        sortOrder: 0,
      },
      {
        companyName: 'Concord Packaging Co',
        contactNumber: '+1-905-555-4502',
        position: 'Shipper / Receiver',
        duration: '1 year',
        sortOrder: 1,
      },
    ],
    profileNote: 'Strong VMPL match — shipping/receiving + packaging experience. Available all shifts.',
    packagePdfRelativePath: 'employes/Rajdeep Biswas VMPL .pdf',
  },
  {
    firstName: 'Satwinder',
    lastName: 'Singh',
    email: 'satwinder.singh.demo@mail.demo',
    phone: '+1-416-555-7106',
    alternatePhone: '+1-905-555-7106',
    dateOfBirth: '1990-09-17',
    gender: 'male',
    address: '75 Lakeshore Blvd W',
    addressLine2: 'Unit 3',
    city: 'Etobicoke',
    province: 'Ontario',
    postalCode: 'M8V 1A1',
    country: 'Canada',
    emergencyContactName: 'Jaspreet Singh',
    emergencyContactPhone: '+1-416-555-8106',
    educationLevel: 'College Diploma',
    educationFromYear: 2010,
    educationEndYear: 2013,
    graduated: true,
    courseStudied: 'Woodworking & Cabinetry',
    diplomaName: 'Carpentry and Renovation Techniques',
    experienceDuties:
      'Sanding and finishing wood components, surface prep, stain/varnish application, quality inspection, and shop floor cleanup.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time'],
    skills: ['General Labour', 'Machine Operator', 'Warehouse'],
    residencyStatus: 'work_permit',
    shiftsAvailable: ['Day'],
    ableTwelveHourShift: false,
    englishProficiency: ['Speak', 'Read'],
    position: 'Sander',
    department: 'Manufacturing',
    hourlyRate: 18.0,
    salaryPaymentMethod: 'deposit',
    bankName: 'TD Canada Trust',
    bankInstitutionNumber: '004',
    bankTransitNumber: '10202',
    bankAccountNumber: '4455667',
    workExperiences: [
      {
        companyName: 'Maple Cabinets Inc',
        contactNumber: '+1-905-555-3301',
        position: 'Sander / Finisher',
        duration: '2 years 3 months',
        sortOrder: 0,
      },
      {
        companyName: 'WoodTech Fabrication',
        contactNumber: '+1-416-555-3302',
        position: 'Production Labourer',
        duration: '1 year',
        sortOrder: 1,
      },
    ],
    profileNote:
      'AWFI-preferred. Dust-comfortable woodworking background. Day shift only. Ideal for Sander role.',
    packagePdfRelativePath: 'employes/Satwinder Singh - AWFI.pdf',
  },
  {
    firstName: 'Kamaljot',
    lastName: 'Singh',
    email: 'kamaljot.singh.demo@mail.demo',
    phone: '+1-416-555-7107',
    alternatePhone: '+1-647-555-7107',
    dateOfBirth: '1994-04-30',
    gender: 'male',
    address: '500 Hurontario St',
    addressLine2: 'Unit 1204',
    city: 'Mississauga',
    province: 'Ontario',
    postalCode: 'L5B 1H3',
    country: 'Canada',
    emergencyContactName: 'Navjot Singh',
    emergencyContactPhone: '+1-905-555-8107',
    educationLevel: 'High School / GED',
    educationFromYear: 2009,
    educationEndYear: 2013,
    graduated: true,
    courseStudied: 'General Studies',
    diplomaName: 'Ontario Secondary School Diploma',
    experienceDuties:
      'Heavy lifting, order packing, line feed for food production, cleaning stations, and following PPE/GMP rules.',
    availableFromDaysOffset: 0,
    availabilityTypes: ['full_time', 'part_time'],
    skills: ['Warehouse', 'General Labour', 'Food Production', 'Assembly Line'],
    residencyStatus: 'pr',
    shiftsAvailable: ['Day', 'Afternoon', 'Night'],
    ableTwelveHourShift: true,
    englishProficiency: ['Speak', 'Read', 'Write'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.85,
    salaryPaymentMethod: 'cheque',
    bankName: 'RBC Royal Bank',
    bankInstitutionNumber: '003',
    bankTransitNumber: '05933',
    bankAccountNumber: '2211009',
    workExperiences: [
      {
        companyName: 'Osmow Production Support (contract)',
        contactNumber: '+1-905-555-4601',
        position: 'General Labour',
        duration: '7 months',
        sortOrder: 0,
      },
      {
        companyName: 'LineRight Logistics',
        contactNumber: '+1-416-555-4602',
        position: 'Warehouse Associate',
        duration: '1 year 1 month',
        sortOrder: 1,
      },
    ],
    profileNote: 'Flexible warehouse candidate — good fit Osmow or VMPL. Prior food-env experience.',
    packagePdfRelativePath: 'employes/Kamaljot Singh .pdf',
  },
  {
    firstName: 'Jasmine',
    lastName: 'Dhillon',
    email: 'jasmine.dhillon.demo@mail.demo',
    phone: '+1-416-555-7108',
    alternatePhone: '+1-289-555-7108',
    dateOfBirth: '1999-06-11',
    gender: 'female',
    address: '210 Queen St S',
    addressLine2: 'Apt 5',
    city: 'Brampton',
    province: 'Ontario',
    postalCode: 'L6W 2A9',
    country: 'Canada',
    emergencyContactName: 'Simran Dhillon',
    emergencyContactPhone: '+1-905-555-8108',
    educationLevel: 'High School / GED',
    educationFromYear: 2013,
    educationEndYear: 2017,
    graduated: true,
    courseStudied: 'Customer Service Certificate',
    diplomaName: 'Ontario Secondary School Diploma',
    experienceDuties:
      'Packaging support, labeling accuracy checks, organizing materials, and general warehouse cleanliness.',
    availableFromDaysOffset: 2,
    availabilityTypes: ['full_time', 'part_time'],
    skills: ['Warehouse', 'General Labour', 'Picker / Packer', 'Customer Service'],
    residencyStatus: 'citizen',
    shiftsAvailable: ['Day', 'Afternoon'],
    ableTwelveHourShift: false,
    englishProficiency: ['All'],
    position: 'Warehouse Associate',
    department: 'Production',
    hourlyRate: 17.6,
    salaryPaymentMethod: 'deposit',
    bankName: 'Scotiabank',
    bankInstitutionNumber: '002',
    bankTransitNumber: '51234',
    bankAccountNumber: '6677889',
    workExperiences: [
      {
        companyName: 'Brampton Retail DC',
        contactNumber: '+1-905-555-4701',
        position: 'Picker / Packer',
        duration: '10 months',
        sortOrder: 0,
      },
    ],
    profileNote: 'New to demo pool. Onboarding package complete. Available in 2 days for placement.',
    packagePdfRelativePath: 'employes/Jasmine Docs..pdf',
  },
];

/** Default onboarding trainings (mirror of employeeDefaultTraining.DEFAULT_EMPLOYEE_TRAININGS). */
export const CLIENT_DEMO_DEFAULT_TRAININGS = [
  {
    title: 'Ontario Health & Safety — 4 Steps',
    url: 'https://www.labour.gov.on.ca/english/hs/elearn/worker/foursteps.php',
  },
  {
    title: 'WHMIS',
    url: 'https://aixsafety.com/',
  },
] as const;

export const CLIENT_DEMO_REQUIRED_DOC_TYPES = [
  { type: 'photo_id' as const, name: 'Photo ID', fileName: 'photo-id.pdf' },
  { type: 'sin' as const, name: 'SIN Document', fileName: 'sin.pdf' },
  { type: 'proof_of_status' as const, name: 'Proof of Status', fileName: 'status.pdf' },
  // Intentionally no `agreement` — onboarding agreement is PandaDoc only (send manually in demo).
  { type: 'resume' as const, name: 'Resume', fileName: 'resume.pdf' },
  { type: 'bank_deposit' as const, name: 'Direct Deposit Form', fileName: 'bank-deposit.pdf' },
];

export const DEFAULT_BACKUP_PERCENTAGE = 70;
