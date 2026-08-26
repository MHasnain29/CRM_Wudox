/** RBAC role key (matches `rbac_roles.key` and `users.role`). Custom roles are supported. */
export type UserRole =
  | 'super_admin'
  | 'dev_team'
  | 'sales_associate'
  | 'sales_executive'
  | 'marketing'
  | 'sales_manager'
  | 'data_entry_specialist'
  | 'database_manager'
  | 'operations_manager'
  | 'it'
  | 'director'
  | 'company_director'
  | 'recruiter'
  | 'sr_recruiter'
  | 'recruitment_manager'
  | (string & {});

export type UserType = 'Super Admin' | 'Dev Team' | 'Sales Associate' | 'Sales Executive' | 'Marketing' | 'Sales & Marketing Executive' | 'Sales Manager' | 'Data Entry Specialist' | 'Database Manager' | 'Operations Manager' | 'IT' | 'Director' | 'Company Director' | 'Recruiter' | 'Sr. Recruiter' | 'Recruitment Manager';

import type { Country } from './countries';
export type { Country };

export type LeadStage = 
  | 'new_lead' 
  | 'contacted' 
  | 'follow_up' 
  | 'meeting_scheduled' 
  | 'proposal_sent' 
  | 'closed_won' 
  | 'closed_lost'
  | string; // Allow custom stages

export type LeadStatus = 'open' | 'active' | 'closed_won' | 'closed_won_pending' | 'closed_lost';

export type Temperature = 'hot' | 'warm' | 'cold';

export interface PipelineStage {
  id: string;
  label: string;
  color: string; // hex color for badge
  order: number;
  isFixed?: boolean;
}

export type CallOutcome = 'answered' | 'no_answer' | 'voicemail' | 'busy';

export type FollowUpOutcome = 'closed_won' | 'closed_lost' | 'next_follow_up' | 'no_response';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus = 'to_do' | 'in_progress' | 'done';

export type TaskLinkType = 'client' | 'lead' | 'meeting' | 'follow_up';

export interface Location {
  id: string;
  name: string;
  address?: string;
  country: Country;
  isActive: boolean;
}

export interface SubCompany {
  id: string;
  name: string;
  mainOrgId: string;
  /** Optional company brand name for public sign-in and director/super-admin app chrome; when unset, organization `name` is used there. */
  appProjectName?: string | null;
  /** Company logo: public sign-in + in-app for super_admin and director only. */
  logoUrl?: string | null;
  /** Agency logo: sidebar for all roles at this agency; outbound emails use this image with organization `name`. */
  agencyLogoUrl?: string | null;
  /** Agency contact email (optional). */
  agencyEmail?: string | null;
  /** Agency phone (optional). */
  agencyPhone?: string | null;
  emailFooterText?: string | null;
  emailTagline?: string | null;
  emailFromAddress?: string | null;
  emailFromName?: string | null;
  emailSendAsDomain?: string | null;
  emailInboundDomain?: string | null;
  emailInboundLocalpart?: string | null;
  /** Per-agency Google Calendar integration status (token is never sent to client). */
  googleCalendarConnected?: boolean;
  googleConnectedEmail?: string | null;
}

export interface UserDailyTargets {
  dailyCalls: number;
  dailyEmails: number;
  dailyMeetingSchedule?: number;
}

export interface User {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: Country;
  userType: UserType;
  isActive: boolean;
  role: UserRole;
  subCompanyId: string;
  locationId: string; // Primary location
  accessibleLocationIds?: string[]; // For managers - locations they can access (Director/IT have all)
  reportingManagerIds: string[]; // Required - IDs of Sales Managers who are reporting managers
  avatar?: string;
  dailyTargets?: UserDailyTargets;
  startDate?: Date;
  probationOverride?: boolean;
  googleCalendarConnected?: boolean;
  googleConnectedEmail?: string | null;
  workStartTime?: string;
  workEndTime?: string;
  sendAsEmail?: string | null;
  sendAsDisabled?: boolean;
}

export interface Client {
  id: string;
  /** Stable per-client serial for cross-associate verbal references. Permanent. */
  serialNumber?: number;
  name: string;
  industry: string;
  location: string;
  address: string;
  companySize: string;
  tags: string[];
  contacts: ClientContact[];
  lastActivity?: Date;
  status: 'contacted' | 'active' | 'lost' | 'ex' | 'unsubscribed' | 'permanently_closed';
  createdAt: Date;
  restrictedUsers?: string[]; // Array of user IDs who cannot access this client
  notes: ClientNote[];
  contactedByMe?: boolean;
  contactedByName?: string;
  hasOutreach?: boolean;
  latestOutreachByName?: string;
  hasOpenLead?: boolean;
  /** Active Closed Won clients cannot be unsubscribed (server-enforced). */
  unsubscribeRestricted?: boolean;
  /** Associate view: open lead owned by another user — show row, block detail/actions, hide owner. */
  heldByOtherAssociate?: boolean;
  activeLeadId?: string;
  activeLeadOwnerId?: string;
  activeLeadOwnerName?: string;
  assignedOwnerId?: string;
  assignedOwnerName?: string;
  latestLostLeadId?: string;
  latestLostById?: string;
  latestLostByName?: string;
  latestLostAt?: Date;
  latestLossReason?: string;
  /** Total positions secured — populated only for Closed Won clients. */
  positionsClosed?: number;
  /** True when the client has an active Lead with status closed_won. Server-derived. */
  isClosedWon?: boolean;
  ownershipType?: 'management' | 'associate';
  ownershipUserId?: string | null;
  /** Denormalised owner name from backend — present whenever ownershipUserId is set. */
  ownershipUserName?: string | null;
  /** Set when this client was transferred via employee offboarding. */
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export interface ClientNote {
  id: string;
  clientId: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  content: string;
  /** Legacy boolean (kept in sync with `visibility==='public'`). */
  isPublic: boolean;
  isPinned: boolean;
  /** Modern visibility: "only_me" | "public" | "shared" | "public_global". */
  visibility?: 'only_me' | 'public' | 'shared' | 'public_global';
  /** User IDs — populated only when `visibility === 'shared'`. */
  sharedWith?: string[];
  createdAt: Date;
}

export interface ClientContact {
  id: string;
  clientId: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  phoneExtension?: string;
  linkedin?: string;
  website?: string;
  isPrimary: boolean;
  isUnsubscribed?: boolean;
}

export interface ProposalAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url: string;
}

export interface ProposalDocument {
  id: string;
  proposalId: string;
  category: 'sent_to_client' | 'received_from_client' | 'generated_for_review';
  name: string;
  size: number;
  type: string;
  url: string;
  uploadedById: string;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
  sentAt?: string;
  deliveryStatus?: string;
  createdAt: string;
}

export type PricingType = 'markup' | 'bill_rate';
export type PaymentTerms = 'net_7' | 'net_15' | 'net_30' | 'net_45' | 'net_60';
export type AgreementType = 'temp' | 'direct_placement';

export interface AgreementPricing {
  pricingType: PricingType;
  pricingValue: number;
  minimumHours?: number; // Only for temp agreements
}

export interface ProposalData {
  locationType: 'single' | 'multiple';
  selectedClients: string[];
  agreementTypes: AgreementType[]; // Now supports multiple selections
  tempPricing?: AgreementPricing; // Pricing for temp agreement
  directPricing?: AgreementPricing; // Pricing for direct placement agreement
  // Legacy fields for backwards compatibility
  pricingType?: PricingType;
  pricingValue?: number;
  paymentTerms: PaymentTerms;
  agreementType?: AgreementType; // Deprecated, use agreementTypes
  comment: string;
  attachments: ProposalAttachment[];
  createdAt: Date;
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected';

export interface Lead {
  id: string;
  clientId: string;
  clientName?: string; // from API when listing leads; avoids "Unknown" when clients store not populated
  ownerId: string;
  ownerName: string;
  subCompanyId: string;
  subCompanyName: string;
  stage: LeadStage;
  status: LeadStatus;
  temperature: Temperature;
  value?: number;
  lastActivity?: Date;
  nextFollowUp?: Date;
  createdAt: Date;
  updatedAt: Date;
  notes?: string;
  closedAt?: Date;
  closedById?: string;
  lossReason?: string;
  reassignedFromLeadId?: string;
  reassignedById?: string;
  proposalData?: ProposalData;
  latestProposalId?: string | null;
  latestProposalStatus?: ProposalStatus | null;
  latestRejectionComment?: string | null;
  latestProposalIsForReview?: boolean;
  latestProposalReviewEmailSentAt?: string | null;
  leadDeadline?: Date;
  extensionRequested?: boolean;
  extensionReason?: string;
  extensionDays?: number;
  extensionStatus?: 'pending' | 'approved' | 'rejected' | null;
  extensionRequestedAt?: Date;
  extensionReviewedAt?: Date;
  reviewedBy?: string;
  managerRemarks?: string;
  reassignmentLocked?: boolean;
  lockedAssociateId?: string;
  requiresDeadlineAction?: boolean;
  /** Set when this lead was transferred via employee offboarding. */
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export interface Call {
  id: string;
  clientId: string;
  leadId?: string;
  ownerId: string;
  ownerName: string;
  outcome: CallOutcome;
  duration?: number;
  notes: string;
  recordingUrl?: string;
  timestamp: Date;
}

export interface FollowUpComment {
  id: string;
  followUpId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
}

export interface FollowUp {
  id: string;
  clientId: string;
  clientName?: string;
  leadId?: string;
  contactId?: string;
  subCompanyId: string;
  subCompanyName?: string;
  ownerId: string;
  ownerName: string;
  dueDate: Date;
  notes: string;
  completed: boolean;
  outcome?: FollowUpOutcome;
  completedAt?: Date;
  createdAt: Date;
  comments: FollowUpComment[];
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export interface Meeting {
  id: string;
  clientId: string;
  leadId?: string;
  ownerId: string;
  ownerName: string;
  title: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  meetingLink?: string;
  agenda?: string;
  attendees: string[];
  notes?: string;
  createdAt: Date;
  /** Set when this meeting was transferred via employee offboarding. */
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
}

export interface ApprovalRequest {
  id: string;
  type: 'client_contact_edit';
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedAt?: Date;
  comments?: string;
  changes: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  resourceId: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: Date;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  mimeType: string;
  size?: number | null;
  uploadedBy: string;
  createdAt: Date;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  dueDate: Date;
  priority: TaskPriority;
  status: TaskStatus;
  ownerId: string;
  ownerName: string;
  assignedById: string;
  assignedByName: string;
  subCompanyId: string;
  subCompanyName: string;
  reminderEnabled: boolean;
  reminderDate?: Date;
  linkType?: TaskLinkType;
  linkId?: string;
  linkedClient?: { id: string; name: string; industry: string; location: string; status: string } | null;
  linkedLead?: { id: string; stage: string; status: string; temperature: string; ownerName: string; clientId: string; clientName: string; clientIndustry: string; clientLocation: string } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  comments: TaskComment[];
  attachments: TaskAttachment[];
  /** Set when this task was transferred via employee offboarding. */
  forwardedFromName?: string | null;
  forwardedFromSubCompanyId?: string | null;
  /** Set when this task belongs to a project. */
  projectId?: string | null;
  projectName?: string | null;
}

export interface LeadRequest {
  id: string;
  clientId: string;
  clientName: string;
  primaryContactName: string;
  requestedBy: string;
  requestedByName: string;
  managerId: string;
  managerName: string;
  note: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  reviewedByName?: string;
  reviewedAt?: Date;
  comments: Array<{
    id: string;
    userId: string;
    userName: string;
    text: string;
    createdAt: Date;
  }>;
  subCompanyId: string;
}

export type BreakType = 'coaching' | 'meeting';

export type ActivityType = 
  | 'lead_request'
  | 'lead_request_approved'
  | 'lead_request_rejected'
  | 'comment_added'
  | 'call_made'
  | 'email_sent'
  | 'break_detected'
  | 'idle_detected'
  | 'pipeline_moved'
  | 'task_created'
  | 'task_status_changed'
  | 'task_completed'
  | 'meeting_scheduled'
  | 'follow_up_created'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'lead_won'
  | 'lead_lost'
  | 'client_contacted'
  | 'client_unsubscribed'
  | 'client_resubscribed'
  | 'client_permanently_closed'
  | 'client_reopened'
  | 'client_marked_ex'
  | 'client_unmarked_ex'
  | 'contact_unsubscribed'
  | 'ownership_changed'
  | 'ownership_auto_skipped';

export interface ActivityLog {
  id: string;
  type: ActivityType;
  userId: string;
  userName: string;
  subCompanyId: string;
  timestamp: Date;
  description: string;
  metadata?: {
    clientName?: string;
    clientId?: string;
    leadId?: string;
    taskId?: string;
    duration?: number;
    fromStage?: string;
    toStage?: string;
    recipientEmail?: string;
    oldStatus?: string;
    newStatus?: string;
    breakType?: BreakType;
    [key: string]: any;
  };
}

export interface ActivityLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  resourceType: 'client' | 'lead' | 'call' | 'follow_up' | 'meeting';
  resourceId: string;
  timestamp: Date;
  details?: Record<string, any>;
}

export interface FilterView {
  id: string;
  name: string;
  type: 'clients' | 'leads';
  filters: {
    industryFilters?: string[];
    cityFilters?: string[];
    provinceFilters?: string[];
    locationFilters?: string[];
    temperatureFilters?: string[];
    companySizeFilters?: string[];
    tagFilters?: string[];
    availabilityFilter?: string;
    stageFilters?: string[];
    ownerFilter?: string;
  };
  createdAt: Date;
}

export interface EmailAttachment {
  id: string;
  name: string;
  size: number;
  type: string;
  url?: string;
}

export interface Email {
  id: string;
  from: {
    name: string;
    email: string;
    userId?: string;
  };
  to: {
    name: string;
    email: string;
    clientId?: string;
    contactId?: string;
  }[];
  cc?: {
    name: string;
    email: string;
  }[];
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  timestamp: Date;
  isRead: boolean;
  folder: 'inbox' | 'sent' | 'drafts';
  clientId?: string;
  leadId?: string;
  inReplyTo?: string;
}

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'failed';
export type EmailRecipientStatus = 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'failed';

export interface EmailCampaign {
  id: string;
  name: string;
  listId: string;
  listName: string;
  subject: string;
  body: string;
  templateId?: string;
  scheduledDate: Date;
  status: CampaignStatus;
  createdAt: Date;
  sentAt?: Date;
  totalRecipients: number;
  attachments?: EmailAttachment[];
  stats: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    failed: number;
  };
}

export interface EmailRecipient {
  id: string;
  campaignId: string;
  clientId: string;
  clientName: string;
  email: string;
  status: EmailRecipientStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  openedAt?: Date;
  clickedAt?: Date;
  errorMessage?: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  category: string;
  createdAt: Date;
}

export type ClientStatusType = 'contacted' | 'active' | 'lost' | 'ex' | 'unsubscribed' | 'permanently_closed';

export interface CallScript {
  id: string;
  name: string;
  clientStatus?: ClientStatusType | null;
  content: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

// Meeting & Availability Types
export type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface TimeSlot {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  isEnabled: boolean;
}

export interface UserAvailability {
  userId: string;
  meetingDuration: number; // in minutes
  bufferTime: number; // minutes between meetings
  slots: TimeSlot[];
  bookingLinkSlug: string; // unique slug for booking URL
  timezone: string;
}

export interface BookedMeeting {
  id: string;
  hostUserId: string;
  guestName: string;
  guestEmail: string;
  guestCompany?: string;
  startTime: Date;
  endTime: Date;
  meetingLink?: string;
  notes?: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  createdAt: Date;
}

export type NoticeType = 'info' | 'warning' | 'holiday' | 'urgent';

export interface Notice {
  id: string;
  subCompanyId: string;
  createdById: string;
  type: NoticeType;
  title: string;
  message: string;
  pinned: boolean;
  expiresAt: string;
  createdAt: string;
  createdBy: {
    id: string;
    firstName: string;
    lastName: string;
  };
}
