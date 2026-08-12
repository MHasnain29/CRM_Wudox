export type JobStatus = 'draft' | 'open' | 'closed' | 'filled';

// Job assignment for employees
export interface JobAssignment {
  id: string;
  jobId: string;
  employeeId: string;
  employeeName: string;
  isBackup: boolean;
  isActive: boolean; // Whether they're currently active on the job
  assignedAt: Date;
  assignedBy: string;
  assignedByName: string;
}

export type PublishPlatform = 'linkedin' | 'indeed' | 'glassdoor';

export type JobType = 'internal' | 'external';

export type WorkDay = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export const WORK_DAYS: WorkDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface JobTemplate {
  id: string;
  name: string;
  icon: string; // lucide icon name
  description: string;
  defaultSkills: string[];
  defaultScreeningCriteria: ScreeningCriteria;
}

export interface ScreeningCriteria {
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number;
  educationLevel?: string;
  certifications?: string[];
  salaryMin?: number;
  salaryMax?: number;
  location?: string;
  remoteOption: 'onsite' | 'remote' | 'hybrid';
}

export interface JobPublishSettings {
  linkedin: boolean;
  indeed: boolean;
  glassdoor: boolean;
  publishedAt?: Date;
}

export interface ShiftSchedule {
  startTime: string; // HH:mm format
  endTime: string; // HH:mm format
  workDays: WorkDay[];
  jobStartDate: Date;
  jobEndDate?: Date;
}

export interface Job {
  id: string;
  /** Human-friendly unique sequential job identifier (e.g. 000001). */
  jobCode?: string;
  templateId?: string;
  jobType: JobType; // internal or external
  title: string;
  company: string;
  /** Linked Active Client (recruitment demo). */
  clientId?: string;
  /** Agency that owns this job (recruitment demo scoping). */
  agencyId?: string;
  location: string;
  department?: string;
  description: string;
  requirements: string;
  responsibilities: string;
  openPositions: number;
  filledPositions: number;
  scheduledPositions: number; // employees scheduled (can exceed openPositions with backup)
  backupPercentage: number; // default 70% - set from settings, not editable per job
  status: JobStatus;
  screeningCriteria: ScreeningCriteria;
  publishSettings: JobPublishSettings;
  shiftSchedule: ShiftSchedule;
  salaryMin?: number;
  salaryMax?: number;
  employmentType: 'full-time' | 'part-time' | 'contract' | 'temporary';
  /** Whether assignees must hold valid licenses of the required types. */
  licenseRequired: boolean;
  requiredLicenseTypes: string[];
  createdById: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
  applicantCount: number;
  assignments: JobAssignment[]; // Employees assigned to this job
}

export interface JobFilterView {
  id: string;
  name: string;
  filters: JobFilters;
  createdAt: Date;
}

export interface JobFilters {
  statusFilters: JobStatus[];
  locationFilters: string[];
  departmentFilters: string[];
  employmentTypeFilters: string[];
  platformFilters: PublishPlatform[];
  jobTypeFilters: JobType[];
  /** Active Client IDs */
  clientFilters?: string[];
  searchQuery: string;
}

// Predefined job templates — skills use the same SKILL_OPTIONS as employees
export const JOB_TEMPLATES: JobTemplate[] = [
  {
    id: 'factory-worker',
    name: 'Factory Worker',
    icon: 'Factory',
    description: 'General factory and production line worker',
    defaultSkills: ['Machine Operator', 'Assembly Line', 'General Labour', 'Warehouse'],
    defaultScreeningCriteria: {
      requiredSkills: ['Machine Operator', 'Assembly Line'],
      preferredSkills: ['Warehouse', 'Forklift Operator'],
      minExperienceYears: 0,
      remoteOption: 'onsite',
    },
  },
  {
    id: 'forklift-operator',
    name: 'Forklift Operator',
    icon: 'Truck',
    description: 'Certified forklift operator for warehouse operations',
    defaultSkills: ['Forklift Operator', 'Warehouse', 'Inventory Management', 'Shipping & Receiving'],
    defaultScreeningCriteria: {
      requiredSkills: ['Forklift Operator'],
      preferredSkills: ['Warehouse', 'Inventory Management'],
      minExperienceYears: 1,
      remoteOption: 'onsite',
    },
  },
  {
    id: 'project-manager',
    name: 'Project Manager',
    icon: 'ClipboardList',
    description: 'Project management and team coordination',
    defaultSkills: ['Administrative Support', 'Customer Service', 'Data Entry'],
    defaultScreeningCriteria: {
      requiredSkills: ['Administrative Support'],
      preferredSkills: ['Customer Service', 'Data Entry'],
      minExperienceYears: 3,
      educationLevel: 'Bachelor\'s Degree',
      remoteOption: 'hybrid',
    },
  },
  {
    id: 'software-developer',
    name: 'Software Developer',
    icon: 'Code',
    description: 'Full-stack or specialized software development',
    defaultSkills: ['Data Entry', 'Administrative Support'],
    defaultScreeningCriteria: {
      requiredSkills: ['Data Entry'],
      preferredSkills: ['Administrative Support'],
      minExperienceYears: 2,
      educationLevel: 'Bachelor\'s Degree',
      remoteOption: 'remote',
    },
  },
  {
    id: 'warehouse-associate',
    name: 'Warehouse Associate',
    icon: 'Package',
    description: 'Warehouse picking, packing, and shipping',
    defaultSkills: ['Warehouse', 'Picker / Packer', 'Inventory Management', 'Shipping & Receiving'],
    defaultScreeningCriteria: {
      requiredSkills: ['Warehouse', 'Picker / Packer'],
      preferredSkills: ['Inventory Management', 'Forklift Operator'],
      minExperienceYears: 0,
      remoteOption: 'onsite',
    },
  },
  {
    id: 'administrative-assistant',
    name: 'Administrative Assistant',
    icon: 'FileText',
    description: 'Office administration and support',
    defaultSkills: ['Administrative Support', 'Data Entry', 'Reception', 'Customer Service'],
    defaultScreeningCriteria: {
      requiredSkills: ['Administrative Support', 'Data Entry'],
      preferredSkills: ['Reception', 'Customer Service'],
      minExperienceYears: 1,
      remoteOption: 'hybrid',
    },
  },
  {
    id: 'customer-service',
    name: 'Customer Service Representative',
    icon: 'Headphones',
    description: 'Customer support and service',
    defaultSkills: ['Customer Service', 'Administrative Support', 'Data Entry', 'Reception'],
    defaultScreeningCriteria: {
      requiredSkills: ['Customer Service'],
      preferredSkills: ['Administrative Support', 'Data Entry'],
      minExperienceYears: 0,
      remoteOption: 'hybrid',
    },
  },
  {
    id: 'general-laborer',
    name: 'General Laborer',
    icon: 'HardHat',
    description: 'General construction and labor work',
    defaultSkills: ['General Labour', 'Construction', 'Landscaping'],
    defaultScreeningCriteria: {
      requiredSkills: ['General Labour'],
      preferredSkills: ['Construction', 'Landscaping'],
      minExperienceYears: 0,
      remoteOption: 'onsite',
    },
  },
];
