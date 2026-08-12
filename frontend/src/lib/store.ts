import { create } from 'zustand';
import { User, SubCompany, Client, Lead, Call, FollowUp, Meeting, ApprovalRequest, Task, LeadRequest, ActivityLog, PipelineStage, FollowUpComment, UserAvailability, TimeSlot, BookedMeeting, DayOfWeek, ClientNote } from './types';
import { users, subCompanies, clients, calls, meetings, approvalRequests } from './mockData';
import { activityLogs as mockActivityLogs } from './activityData';
import { SELECTED_AGENCY_KEY } from './sessionKeys';

const defaultTimeSlots: TimeSlot[] = [
  { id: 'mon-1', dayOfWeek: 'monday', startTime: '09:00', endTime: '17:00', isEnabled: true },
  { id: 'tue-1', dayOfWeek: 'tuesday', startTime: '09:00', endTime: '17:00', isEnabled: true },
  { id: 'wed-1', dayOfWeek: 'wednesday', startTime: '09:00', endTime: '17:00', isEnabled: true },
  { id: 'thu-1', dayOfWeek: 'thursday', startTime: '09:00', endTime: '17:00', isEnabled: true },
  { id: 'fri-1', dayOfWeek: 'friday', startTime: '09:00', endTime: '17:00', isEnabled: true },
  { id: 'sat-1', dayOfWeek: 'saturday', startTime: '09:00', endTime: '12:00', isEnabled: false },
  { id: 'sun-1', dayOfWeek: 'sunday', startTime: '09:00', endTime: '12:00', isEnabled: false },
];

interface AppState {
  // Current user context (agency = sub-company)
  currentUser: User;
  currentSubCompany: SubCompany;
  
  // Data
  users: User[];
  subCompanies: SubCompany[];
  setSubCompanies: (list: SubCompany[]) => void;
  clients: Client[];
  setClients: (clients: Client[]) => void;
  leads: Lead[];
  setLeads: (leads: Lead[]) => void;
  leadRequests: LeadRequest[];
  setLeadRequests: (requests: LeadRequest[]) => void;
  calls: Call[];
  followUps: FollowUp[];
  setFollowUps: (followUps: FollowUp[]) => void;
  meetings: Meeting[];
  approvalRequests: ApprovalRequest[];
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
  unreadMessagesCount: number;
  setUnreadMessagesCount: (n: number) => void;
  unreadEmailsCount: number;
  setUnreadEmailsCount: (n: number) => void;
  unreadNotificationsCount: number;
  setUnreadNotificationsCount: (n: number) => void;
  pendingProposalsCount: number;
  setPendingProposalsCount: (n: number) => void;
  cwpProposalsCount: number;
  setCwpProposalsCount: (n: number) => void;
  pendingReassignmentsCount: number;
  setPendingReassignmentsCount: (n: number) => void;
  isOnBreak: boolean;
  setIsOnBreak: (value: boolean) => void;
  activityLogs: ActivityLog[];
  availableTags: string[];
  pipelineStages: PipelineStage[];
  userAvailabilities: UserAvailability[];
  bookedMeetings: BookedMeeting[];
  
  // Viewed agency (null = own agency; set when director/super_admin switches agency)
  viewedSubCompanyId: string | null;
  setViewedSubCompanyId: (id: string | null) => void;

  // Actions
  setCurrentUser: (user: User) => void;
  setCurrentSubCompany: (subCompany: SubCompany) => void;
  addClient: (client: Client) => void;
  updateLead: (leadId: string, updates: Partial<Lead>) => void;
  addCall: (call: Call) => void;
  addFollowUp: (followUp: FollowUp) => void;
  updateFollowUp: (followUpId: string, updates: Partial<FollowUp>) => void;
  addFollowUpComment: (followUpId: string, content: string) => void;
  completeFollowUp: (followUpId: string, note: string) => void;
  rescheduleFollowUp: (followUpId: string, newDate: Date, reason: string) => void;
  setMeetings: (meetings: Meeting[]) => void;
  addMeeting: (meeting: Meeting) => void;
  approveRequest: (requestId: string, comments?: string) => void;
  rejectRequest: (requestId: string, comments: string) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  deleteTask: (taskId: string) => void;
  requestLead: (clientId: string, managerId: string, note: string) => void;
  assignLead: (clientId: string, salesAssociateId: string, note: string) => void;
  approveLeadRequest: (requestId: string, comments?: string) => void;
  rejectLeadRequest: (requestId: string, comments: string) => void;
  addLeadRequestComment: (requestId: string, text: string) => void;
  addTag: (tag: string) => void;
  deleteTag: (tag: string) => void;
  updateTag: (oldTag: string, newTag: string) => void;
  addPipelineStage: (label: string, color: string) => void;
  updatePipelineStage: (stageId: string, label: string, color: string) => void;
  deletePipelineStage: (id: string) => void;
  reorderPipelineStages: (stages: PipelineStage[]) => void;
  updateClientAccess: (clientId: string, userId: string, hasAccess: boolean) => void;
  addClientNote: (clientId: string, content: string, isPublic: boolean, author?: { id: string; name: string; role: string }) => void;
  toggleNotePin: (clientId: string, noteId: string) => void;
  // Availability actions
  getUserAvailability: (userId: string) => UserAvailability;
  updateUserAvailability: (userId: string, updates: Partial<Omit<UserAvailability, 'userId'>>) => void;
  updateTimeSlot: (userId: string, slotId: string, updates: Partial<TimeSlot>) => void;
  addBookedMeeting: (meeting: Omit<BookedMeeting, 'id' | 'createdAt'>) => void;
  generateMeetingLink: () => string;
  // Task refresh trigger (incremented by socket events to signal task re-fetch)
  refreshTasksTrigger: number;
  triggerTasksRefresh: () => void;
  // Proposal refresh trigger (incremented by socket events to signal proposal re-fetch)
  refreshProposalsTrigger: number;
  triggerProposalsRefresh: () => void;
  // Reports refresh trigger (incremented by any data-change socket event to signal report re-fetch)
  refreshReportsTrigger: number;
  triggerReportsRefresh: () => void;

  // User management actions
  addUser: (user: Omit<User, 'id'>) => void;
  updateUser: (userId: string, updates: Partial<User>) => void;
  deleteUser: (userId: string) => void;

  /** Wipe in-memory session data on logout. */
  resetSessionData: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  // Initialize with first user (sales associate)
  currentUser: users[0],
  currentSubCompany: subCompanies[0],
  
  users,
  subCompanies,
  clients,
  leads: [],
  setLeads: (leads) => set({ leads }),
  leadRequests: [],
  setLeadRequests: (leadRequests) => set({ leadRequests }),
  calls,
  followUps: [],
  setFollowUps: (followUps) => set({ followUps }),
  meetings,
  approvalRequests,
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
  unreadMessagesCount: 0,
  setUnreadMessagesCount: (n) => set({ unreadMessagesCount: n }),
  unreadEmailsCount: 0,
  setUnreadEmailsCount: (n) => set({ unreadEmailsCount: n }),
  unreadNotificationsCount: 0,
  setUnreadNotificationsCount: (n) => set({ unreadNotificationsCount: n }),
  pendingProposalsCount: 0,
  setPendingProposalsCount: (n) => set({ pendingProposalsCount: n }),
  cwpProposalsCount: 0,
  setCwpProposalsCount: (n) => set({ cwpProposalsCount: n }),
  pendingReassignmentsCount: 0,
  setPendingReassignmentsCount: (n) => set({ pendingReassignmentsCount: n }),
  isOnBreak: false,
  setIsOnBreak: (value) => set({ isOnBreak: value }),
  activityLogs: mockActivityLogs,
  availableTags: Array.from(new Set(clients.flatMap(c => c.tags))).sort(),
  pipelineStages: [
    { id: 'new_lead', label: 'New Lead', color: '#06b6d4', order: 0 },
    { id: 'meeting_scheduled', label: 'Meeting Scheduled', color: '#3b82f6', order: 1 },
    { id: 'follow_up', label: 'Follow-Up', color: '#f59e0b', order: 2 },
    { id: 'proposal_sent', label: 'Proposal Sent', color: '#8b5cf6', order: 3 },
    { id: 'awaiting_client_approval', label: 'Awaiting Client Approval', color: '#f97316', order: 4 },
    { id: 'closed_won', label: 'Closed Won', color: '#10b981', order: 5, isFixed: true },
    { id: 'closed_lost', label: 'Closed Lost', color: '#ef4444', order: 6, isFixed: true },
  ],
  viewedSubCompanyId: null,
  setViewedSubCompanyId: (id) => set({ viewedSubCompanyId: id }),

  setCurrentUser: (user) => set({ currentUser: user }),

  setCurrentSubCompany: (subCompany) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(SELECTED_AGENCY_KEY, subCompany.id);
    } catch {
      // ignore
    }
    set({ currentSubCompany: subCompany });
  },
  setSubCompanies: (list) => set({ subCompanies: list }),

  setClients: (clients) => set((state) => ({
    clients,
    availableTags: Array.from(new Set(clients.flatMap((c) => c.tags))).sort(),
  })),
  addClient: (client) => set((state) => ({
    clients: [...state.clients, client]
  })),
  
  updateLead: (leadId, updates) => set((state) => ({
    leads: state.leads.map(lead => 
      lead.id === leadId 
        ? { ...lead, ...updates, updatedAt: new Date() }
        : lead
    )
  })),
  
  addCall: (call) => set((state) => ({
    calls: [call, ...state.calls]
  })),
  
  addFollowUp: (followUp) => set((state) => ({
    followUps: [followUp, ...state.followUps]
  })),
  
  updateFollowUp: (followUpId, updates) => set((state) => ({
    followUps: state.followUps.map(fu =>
      fu.id === followUpId ? { ...fu, ...updates } : fu
    )
  })),

  addFollowUpComment: (followUpId, content) => set((state) => ({
    followUps: state.followUps.map(fu =>
      fu.id === followUpId
        ? {
            ...fu,
            comments: [
              ...fu.comments,
              {
                id: `fc-${Date.now()}-${Math.random()}`,
                followUpId,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                content,
                createdAt: new Date(),
              }
            ],
          }
        : fu
    )
  })),

  completeFollowUp: (followUpId, note) => set((state) => ({
    followUps: state.followUps.map(fu =>
      fu.id === followUpId
        ? {
            ...fu,
            completed: true,
            completedAt: new Date(),
            comments: [
              ...fu.comments,
              {
                id: `fc-${Date.now()}-${Math.random()}`,
                followUpId,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                content: `✓ Completed: ${note}`,
                createdAt: new Date(),
              }
            ],
          }
        : fu
    )
  })),

  rescheduleFollowUp: (followUpId, newDate, reason) => set((state) => ({
    followUps: state.followUps.map(fu =>
      fu.id === followUpId
        ? {
            ...fu,
            dueDate: newDate,
            comments: [
              ...fu.comments,
              {
                id: `fc-${Date.now()}-${Math.random()}`,
                followUpId,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                content: `↻ Rescheduled to ${newDate.toLocaleString()}: ${reason}`,
                createdAt: new Date(),
              }
            ],
          }
        : fu
    )
  })),
  
  setMeetings: (meetings) => set({ meetings }),
  addMeeting: (meeting) => set((state) => ({
    meetings: [meeting, ...state.meetings]
  })),
  
  approveRequest: (requestId, comments) => set((state) => ({
    approvalRequests: state.approvalRequests.map(req =>
      req.id === requestId
        ? {
            ...req,
            status: 'approved' as const,
            reviewedBy: state.currentUser.id,
            reviewedAt: new Date(),
            comments,
          }
        : req
    )
  })),
  
  rejectRequest: (requestId, comments) => set((state) => ({
    approvalRequests: state.approvalRequests.map(req =>
      req.id === requestId
        ? {
            ...req,
            status: 'rejected' as const,
            reviewedBy: state.currentUser.id,
            reviewedAt: new Date(),
            comments,
          }
        : req
    )
  })),

  addTask: (task) => set((state) => ({
    tasks: [task, ...state.tasks]
  })),

  updateTask: (taskId, updates) => set((state) => ({
    tasks: state.tasks.map(task =>
      task.id === taskId 
        ? { 
            ...task, 
            ...updates, 
            updatedAt: new Date(),
            ...(updates.status === 'done' && !task.completedAt ? { completedAt: new Date() } : {})
          }
        : task
    )
  })),

  deleteTask: (taskId) => set((state) => ({
    tasks: state.tasks.filter(task => task.id !== taskId)
  })),

  requestLead: (clientId, managerId, note) => set((state) => {
    const client = state.clients.find(c => c.id === clientId);
    const manager = state.users.find(u => u.id === managerId);
    const primaryContact = client?.contacts.find(c => c.isPrimary);
    
    const newRequest: LeadRequest = {
      id: `lr-${Date.now()}`,
      clientId,
      clientName: client?.name || '',
      primaryContactName: primaryContact?.name || 'N/A',
      requestedBy: state.currentUser.id,
      requestedByName: state.currentUser.name,
      managerId,
      managerName: manager?.name || '',
      note,
      requestedAt: new Date(),
      status: 'pending',
      comments: [{
        id: `c-${Date.now()}`,
        userId: state.currentUser.id,
        userName: state.currentUser.name,
        text: note,
        createdAt: new Date(),
      }],
      subCompanyId: state.currentUser.subCompanyId,
    };
    return {
      leadRequests: [newRequest, ...state.leadRequests]
    };
  }),

  assignLead: (clientId, salesAssociateId, note) => set((state) => {
    const client = state.clients.find(c => c.id === clientId);
    const salesAssociate = state.users.find(u => u.id === salesAssociateId);
    
    const newLead: Lead = {
      id: `lead-${Date.now()}`,
      clientId,
      ownerId: salesAssociateId,
      ownerName: salesAssociate?.name || '',
      subCompanyId: state.currentUser.subCompanyId,
      subCompanyName: state.currentSubCompany.name,
      stage: 'new_lead',
      status: 'open',
      temperature: 'warm',
      lastActivity: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      notes: note,
    };
    
    return {
      leads: [newLead, ...state.leads]
    };
  }),

  approveLeadRequest: (requestId, comments) => set((state) => ({
    leadRequests: state.leadRequests.map(req =>
      req.id === requestId
        ? {
            ...req,
            status: 'approved' as const,
            reviewedBy: state.currentUser.id,
            reviewedByName: state.currentUser.name,
            reviewedAt: new Date(),
            comments: comments ? [
              ...req.comments,
              {
                id: `c-${Date.now()}`,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                text: comments,
                createdAt: new Date(),
              }
            ] : req.comments,
          }
        : req
    )
  })),

  rejectLeadRequest: (requestId, comments) => set((state) => ({
    leadRequests: state.leadRequests.map(req =>
      req.id === requestId
        ? {
            ...req,
            status: 'rejected' as const,
            reviewedBy: state.currentUser.id,
            reviewedByName: state.currentUser.name,
            reviewedAt: new Date(),
            comments: [
              ...req.comments,
              {
                id: `c-${Date.now()}`,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                text: comments,
                createdAt: new Date(),
              }
            ],
          }
        : req
    )
  })),

  addLeadRequestComment: (requestId, text) => set((state) => ({
    leadRequests: state.leadRequests.map(req =>
      req.id === requestId
        ? {
            ...req,
            comments: [
              ...req.comments,
              {
                id: `c-${Date.now()}-${Math.random()}`,
                userId: state.currentUser.id,
                userName: state.currentUser.name,
                text,
                createdAt: new Date(),
              }
            ],
          }
        : req
    )
  })),

  addTag: (tag) => set((state) => {
    const trimmedTag = tag.trim();
    if (!trimmedTag || state.availableTags.includes(trimmedTag)) {
      return state;
    }
    return {
      availableTags: [...state.availableTags, trimmedTag].sort()
    };
  }),

  deleteTag: (tag) => set((state) => ({
    availableTags: state.availableTags.filter(t => t !== tag),
    clients: state.clients.map(client => ({
      ...client,
      tags: client.tags.filter(t => t !== tag)
    }))
  })),

  updateTag: (oldTag, newTag) => set((state) => {
    const trimmedNewTag = newTag.trim();
    if (!trimmedNewTag || state.availableTags.includes(trimmedNewTag)) {
      return state;
    }
    return {
      availableTags: state.availableTags.map(t => t === oldTag ? trimmedNewTag : t).sort(),
      clients: state.clients.map(client => ({
        ...client,
        tags: client.tags.map(t => t === oldTag ? trimmedNewTag : t)
      }))
    };
  }),

  addPipelineStage: (label, color) => set((state) => {
    const stages = state.pipelineStages;
    const fixedStages = stages.filter(s => s.isFixed);
    const customStages = stages.filter(s => !s.isFixed);
    
    const newStage: PipelineStage = {
      id: `custom-${Date.now()}`,
      label,
      color,
      order: customStages.length,
    };
    
    const reorderedStages = [
      ...customStages,
      newStage,
      ...fixedStages,
    ].map((stage, index) => ({ ...stage, order: index }));
    
    localStorage.setItem('pipelineStages', JSON.stringify(reorderedStages));
    return { pipelineStages: reorderedStages };
  }),

  updatePipelineStage: (stageId, label, color) => set((state) => {
    const stages = state.pipelineStages;
    const stage = stages.find(s => s.id === stageId);
    
    if (stage?.isFixed) {
      console.warn('Cannot update fixed stages');
      return state;
    }
    
    const updatedStages = stages.map(s =>
      s.id === stageId ? { ...s, label, color } : s
    );
    
    localStorage.setItem('pipelineStages', JSON.stringify(updatedStages));
    return { pipelineStages: updatedStages };
  }),

  deletePipelineStage: (id) => set((state) => {
    const stageToDelete = state.pipelineStages.find(s => s.id === id);
    if (!stageToDelete || stageToDelete.isFixed) {
      return state;
    }
    
    return {
      pipelineStages: state.pipelineStages
        .filter(s => s.id !== id)
        .map((s, i) => ({ ...s, order: i }))
    };
  }),

  reorderPipelineStages: (stages) => set(() => ({
    pipelineStages: stages.map((s, i) => ({ ...s, order: i }))
  })),

  updateClientAccess: (clientId, userId, hasAccess) => set((state) => ({
    clients: state.clients.map(client => {
      if (client.id !== clientId) return client;
      
      const restrictedUsers = client.restrictedUsers || [];
      
      if (hasAccess) {
        // Remove user from restricted list
        return {
          ...client,
          restrictedUsers: restrictedUsers.filter(id => id !== userId)
        };
      } else {
        // Add user to restricted list
        return {
          ...client,
          restrictedUsers: restrictedUsers.includes(userId) 
            ? restrictedUsers 
            : [...restrictedUsers, userId]
        };
      }
    })
  })),

  addClientNote: (clientId, content, isPublic, author) => set((state) => {
    const tempId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `note-${crypto.randomUUID()}`
      : `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const note: ClientNote = {
      id: tempId,
      clientId,
      userId: author?.id ?? state.currentUser.id,
      userName: author?.name ?? state.currentUser.name,
      userRole: (author?.role ?? state.currentUser.role) as any,
      content,
      isPublic,
      isPinned: false,
      createdAt: new Date(),
    };

    return {
      clients: state.clients.map(client =>
        client.id === clientId
          ? { ...client, notes: [...client.notes, note] }
          : client
      ),
    };
  }),

  toggleNotePin: (clientId, noteId) => set((state) => ({
    clients: state.clients.map(client =>
      client.id === clientId
        ? {
            ...client,
            notes: client.notes.map(note =>
              note.id === noteId
                ? { ...note, isPinned: !note.isPinned }
                : note
            ),
          }
        : client
    ),
  })),

  // Availability management
  userAvailabilities: users.map(user => ({
    userId: user.id,
    meetingDuration: 30,
    bufferTime: 15,
    slots: defaultTimeSlots.map(slot => ({ ...slot, id: `${user.id}-${slot.id}` })),
    bookingLinkSlug: user.name.toLowerCase().replace(/\s+/g, '-'),
    timezone: 'America/New_York',
  })),
  bookedMeetings: [],

  getUserAvailability: (userId) => {
    const state = get();
    const existing = state.userAvailabilities.find(a => a.userId === userId);
    if (existing) return existing;
    return {
      userId,
      meetingDuration: 30,
      bufferTime: 15,
      slots: defaultTimeSlots.map(slot => ({ ...slot, id: `${userId}-${slot.id}` })),
      bookingLinkSlug: userId,
      timezone: 'America/New_York',
    };
  },

  updateUserAvailability: (userId, updates) => set((state) => ({
    userAvailabilities: state.userAvailabilities.map(a =>
      a.userId === userId ? { ...a, ...updates } : a
    ),
  })),

  updateTimeSlot: (userId, slotId, updates) => set((state) => ({
    userAvailabilities: state.userAvailabilities.map(a =>
      a.userId === userId
        ? {
            ...a,
            slots: a.slots.map(slot =>
              slot.id === slotId ? { ...slot, ...updates } : slot
            ),
          }
        : a
    ),
  })),

  addBookedMeeting: (meeting) => set((state) => ({
    bookedMeetings: [
      {
        ...meeting,
        id: `bm-${Date.now()}`,
        createdAt: new Date(),
      },
      ...state.bookedMeetings,
    ],
  })),

  generateMeetingLink: () => {
    // Generate a mock Google Meet link
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    const segment = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `https://meet.google.com/${segment()}-${segment()}-${segment()}`;
  },

  // Task refresh trigger
  refreshTasksTrigger: 0,
  triggerTasksRefresh: () => set((state) => ({ refreshTasksTrigger: state.refreshTasksTrigger + 1 })),

  // Proposal refresh trigger
  refreshProposalsTrigger: 0,
  triggerProposalsRefresh: () => set((state) => ({ refreshProposalsTrigger: state.refreshProposalsTrigger + 1 })),

  // Reports refresh trigger
  refreshReportsTrigger: 0,
  triggerReportsRefresh: () => set((state) => ({ refreshReportsTrigger: state.refreshReportsTrigger + 1 })),

  // User management actions
  addUser: (user) => set((state) => ({
    users: [
      ...state.users,
      {
        ...user,
        id: `user-${Date.now()}`,
      },
    ],
  })),

  updateUser: (userId, updates) => set((state) => ({
    users: state.users.map((u) =>
      u.id === userId ? { ...u, ...updates } : u
    ),
  })),

  deleteUser: (userId) => set((state) => ({
    users: state.users.filter((u) => u.id !== userId),
  })),

  resetSessionData: () => {
    try {
      localStorage.removeItem(SELECTED_AGENCY_KEY);
    } catch {
      // ignore
    }
    set({
      clients: [],
      leads: [],
      leadRequests: [],
      followUps: [],
      tasks: [],
      subCompanies: [],
      viewedSubCompanyId: null,
      unreadMessagesCount: 0,
      unreadEmailsCount: 0,
      unreadNotificationsCount: 0,
      pendingProposalsCount: 0,
      cwpProposalsCount: 0,
      pendingReassignmentsCount: 0,
      isOnBreak: false,
      availableTags: [],
    });
  },
}));
