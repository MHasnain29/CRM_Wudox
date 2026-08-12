import { useState, useMemo, useCallback, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { 
  Users, ListChecks, Phone, Clock, Mail,
  Eye, Calendar as CalendarIcon, AlertTriangle, FileText,
  CheckCircle2, ExternalLink, Building2, TrendingUp, ClipboardList,
  Check, X, MapPin, User, Download, File, Coffee, GraduationCap, Users2
} from 'lucide-react';
import { useStore } from '@/lib/store';
import { format, isToday, isSameDay, isBefore, startOfMonth, endOfMonth, startOfYear, endOfYear, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { StageBadge } from '@/components/StageBadge';
import { toast } from 'sonner';
import { Lead, Client, LeadRequest, ActivityLog } from '@/lib/types';
import { fetchLeads, fetchLeadRequests, fetchTasks, mapApiTaskToTask, fetchMeetings, ApiMeeting, fetchLeadStatusOverTime, fetchMyTimeLogs, fetchCalls, fetchClients, fetchUsers, fetchActivityLogs, fetchProposals, activateProposal, rejectProposalReview, downloadProposalAttachment, fetchProposalAttachmentBlob, ApiCall, ApiUser } from '@/lib/api';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { getSocket, onProposalRefresh } from '@/lib/socket';
import type { Meeting } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { canAccessMultipleAgencies, useCanViewPipeline } from '@/lib/access';

interface ProposalRecord {
  id: string;
  status: string;
  createdAt: string;
  reviewRequestedAt?: string | null;
  reviewRejectedAt?: string | null;
  pandaDocStatus?: string | null;
  lead: {
    id: string;
    client: { id: string; name: string };
    owner: { id: string; firstName: string; lastName: string };
  };
}

const isReadyForActivation = (p: Pick<ProposalRecord, 'reviewRequestedAt' | 'reviewRejectedAt' | 'pandaDocStatus'>) => {
  const wasRejected = p.reviewRejectedAt && p.reviewRequestedAt &&
    new Date(p.reviewRejectedAt).getTime() >= new Date(p.reviewRequestedAt).getTime();
  const reviewSubmitted = !!p.reviewRequestedAt && !wasRejected;
  return p.pandaDocStatus === 'document.completed' || reviewSubmitted;
};

function mapApiLeadToLead(apiLead: { id: string; clientId: string; ownerId: string; subCompanyId: string; stage: string; status: string; temperature: string | null; lastActivity: string | null; nextFollowUp: string | null; notes: string | null; createdAt: string; updatedAt: string; client: { name: string }; owner: { firstName: string; lastName: string } }, subCompanyName: string): Lead {
  return {
    id: apiLead.id,
    clientId: apiLead.clientId,
    ownerId: apiLead.ownerId,
    ownerName: `${apiLead.owner.firstName} ${apiLead.owner.lastName}`.trim(),
    subCompanyId: apiLead.subCompanyId,
    subCompanyName,
    stage: apiLead.stage,
    status: apiLead.status as Lead['status'],
    temperature: (apiLead.temperature as Lead['temperature']) ?? 'warm',
    lastActivity: apiLead.lastActivity ? new Date(apiLead.lastActivity) : undefined,
    nextFollowUp: apiLead.nextFollowUp ? new Date(apiLead.nextFollowUp) : undefined,
    createdAt: new Date(apiLead.createdAt),
    updatedAt: new Date(apiLead.updatedAt),
    notes: apiLead.notes ?? undefined,
  };
}

function mapApiLeadRequestToLeadRequest(api: { id: string; clientId: string; clientName: string; primaryContactName: string; requestedBy: string; requestedByName: string; managerId: string; managerName: string; note: string; requestedAt: string; status: string; reviewedBy?: string; reviewedByName?: string; reviewedAt?: string; subCompanyId: string; comments: Array<{ id: string; userId: string; userName: string; text: string; createdAt: string }> }): LeadRequest {
  return {
    id: api.id,
    clientId: api.clientId,
    clientName: api.clientName,
    primaryContactName: api.primaryContactName,
    requestedBy: api.requestedBy,
    requestedByName: api.requestedByName,
    managerId: api.managerId,
    managerName: api.managerName,
    note: api.note,
    requestedAt: new Date(api.requestedAt),
    status: api.status as LeadRequest['status'],
    reviewedBy: api.reviewedBy,
    reviewedByName: api.reviewedByName,
    reviewedAt: api.reviewedAt ? new Date(api.reviewedAt) : undefined,
    subCompanyId: api.subCompanyId,
    comments: api.comments.map((c) => ({ ...c, createdAt: new Date(c.createdAt) })),
  };
}

export default function ManagerDashboard() {
  const {
    currentUser,
    currentSubCompany,
    leads,
    tasks,
    meetings,
    clients,
    followUps,
    pipelineStages,
    leadRequests,
    setLeads,
    setLeadRequests,
    setTasks,
    setMeetings,
    refreshTasksTrigger,
    updateLead,
  } = useStore();

  const [realUsers, setRealUsers] = useState<ApiUser[]>([]);
  const [realCalls, setRealCalls] = useState<ApiCall[]>([]);
  const [cwpProposals, setCwpProposals] = useState<ProposalRecord[]>([]);
  const [pendingReviewProposals, setPendingReviewProposals] = useState<ProposalRecord[]>([]);
  const [realActivityLogs, setRealActivityLogs] = useState<ActivityLog[]>([]);
  const [clientCounts, setClientCounts] = useState({ total: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [monthlyLeadData, setMonthlyLeadData] = useState<{ month: string; Won: number; Lost: number; Active: number; Open: number }[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
  const [callPeriod, setCallPeriod] = useState<'today' | 'month' | 'year'>('month');
  const [emailPeriod, setEmailPeriod] = useState<'today' | 'month' | 'year'>('month');
  const [myIdleTime, setMyIdleTime] = useState(0);
  const [myCoachingTime, setMyCoachingTime] = useState(0);
  const [myMeetingBreakTime, setMyMeetingBreakTime] = useState(0);
  const navigate = useNavigate();
  const canViewPipeline = useCanViewPipeline();

  // Filter meetings, tasks, and follow-ups from store for the selected date
  const selectedDateMeetings = selectedDate
    ? meetings.filter(m => isSameDay(new Date(m.startTime), selectedDate))
    : [];
  const selectedDateTasks = selectedDate
    ? tasks.filter(t => t.status !== 'done' && t.dueDate && isSameDay(new Date(t.dueDate), selectedDate))
    : [];
  const selectedDateFollowUps = selectedDate
    ? followUps.filter(f => !f.completed && isSameDay(new Date(f.dueDate), selectedDate))
    : [];

  const selectedDateEvents = [
    ...selectedDateMeetings.map(m => ({ id: m.id, type: 'meeting' as const, title: m.title, time: new Date(m.startTime) })),
    ...selectedDateTasks.map(t => ({ id: t.id, type: 'task' as const, title: t.title, time: new Date(t.dueDate) })),
    ...selectedDateFollowUps.map(f => ({ id: f.id, type: 'followup' as const, title: f.notes || f.clientName || 'Follow-up', time: new Date(f.dueDate) })),
  ].sort((a, b) => a.time.getTime() - b.time.getTime());

  const eventDotColor = (type: 'meeting' | 'task' | 'followup') => {
    if (type === 'meeting') return 'bg-blue-500';
    if (type === 'task') return 'bg-orange-500';
    return 'bg-green-500';
  };

  const loadProposals = useCallback(async () => {
    const [pendingRes, cwpRes] = await Promise.all([
      fetchProposals({ status: 'pending', limit: 100 }),
      fetchProposals({ pendingActivation: true, limit: 100 }),
    ]);
    setPendingReviewProposals((pendingRes.proposals ?? []) as ProposalRecord[]);
    setCwpProposals((cwpRes.proposals ?? []) as ProposalRecord[]);
  }, []);

  const loadData = useCallback(async () => {
    if (!currentSubCompany?.id) return;
    setLoading(true);
    try {
      const subId = canAccessMultipleAgencies() ? currentSubCompany.id : undefined;
      const [leadsRes, requests, tasksRes, meetingsRes, leadStatusData, usersRes, callsRes, activityLogsRes, clientsRes] = await Promise.all([
        fetchLeads({ limit: 500, subCompanyId: subId }),
        fetchLeadRequests({ subCompanyId: subId }),
        fetchTasks({ subCompanyId: currentSubCompany.id, limit: 500 }),
        fetchMeetings({ limit: 500 }),
        fetchLeadStatusOverTime(),
        fetchUsers({ subCompanyId: currentSubCompany.id }),
        fetchCalls({ scope: 'all', limit: 500 }),
        fetchActivityLogs({ limit: 1000 }),
        fetchClients({ limit: 1000 }),
      ]);
      setLeads(leadsRes.data.map((a) => mapApiLeadToLead(a, currentSubCompany.name)));
      setLeadRequests(requests.map(mapApiLeadRequestToLeadRequest));
      setTasks(tasksRes.data.map((t) => mapApiTaskToTask(t)));
      setMonthlyLeadData(leadStatusData);
      setRealUsers(usersRes);
      setRealCalls(callsRes.data);
      setRealActivityLogs(activityLogsRes);
      setClientCounts({
        total: clientsRes.pagination.total,
        active: clientsRes.data.filter((c: { status: string }) => c.status === 'active').length,
      });
      setMeetings(meetingsRes.data.map((m: ApiMeeting): Meeting => ({
        id: m.id,
        clientId: m.clientId,
        leadId: m.leadId ?? undefined,
        ownerId: m.ownerId,
        ownerName: m.ownerName ?? '',
        title: m.title,
        startTime: new Date(m.startTime),
        endTime: new Date(m.endTime),
        location: m.location ?? undefined,
        meetingLink: m.meetingLink ?? undefined,
        agenda: m.agenda ?? undefined,
        attendees: m.attendees.map(a => a.contactName || a.userId || ''),
        notes: m.notes ?? undefined,
        createdAt: new Date(m.createdAt),
      })));
      await loadProposals();
    } catch {
      toast.error('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [currentSubCompany?.id, currentSubCompany?.name, setLeads, setLeadRequests, setTasks, setMeetings, loadProposals]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh tasks when socket fires task:refresh
  useEffect(() => {
    if (!currentSubCompany?.id || refreshTasksTrigger === 0) return;
    fetchTasks({ subCompanyId: currentSubCompany.id, limit: 500 })
      .then((res) => setTasks(res.data.map((t) => mapApiTaskToTask(t))))
      .catch(() => {});
  }, [refreshTasksTrigger, currentSubCompany?.id, setTasks]);
  
  // Load real idle & break time from API
  const refreshIdleTime = useCallback(() => {
    const now = new Date();
    fetchMyTimeLogs({ from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString(), limit: 500 })
      .then((logs) => {
        const idle = logs
          .filter(a => a.type === 'idle_detected')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        const coaching = logs
          .filter(a => a.type === 'break_detected' && (a.metadata as Record<string, string>)?.breakType === 'coaching')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        const mtg = logs
          .filter(a => a.type === 'break_detected' && (a.metadata as Record<string, string>)?.breakType === 'meeting')
          .reduce((acc, a) => acc + ((a.metadata as Record<string, number>)?.duration || 0), 0);
        setMyIdleTime(idle);
        setMyCoachingTime(coaching);
        setMyMeetingBreakTime(mtg);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshIdleTime();
  }, [refreshIdleTime]);

  // Re-fetch idle/break time when a completed idle or break period is logged (both emit call:refresh)
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.on('call:refresh', refreshIdleTime);
    return () => { socket.off('call:refresh', refreshIdleTime); };
  }, [refreshIdleTime]);

  // Re-fetch proposal counts whenever any proposal action fires
  useEffect(() => {
    return onProposalRefresh(() => { loadProposals(); });
  }, [loadProposals]);

  // Lead Request Review State
  const [selectedLeadRequest, setSelectedLeadRequest] = useState<LeadRequest | null>(null);
  const [leadRequestComments, setLeadRequestComments] = useState('');
  const [leadRequestDialogOpen, setLeadRequestDialogOpen] = useState(false);
  
  // Proposal Review State
  const [selectedProposal, setSelectedProposal] = useState<{ lead: Lead; client: Client } | null>(null);
  const [proposalDetailsOpen, setProposalDetailsOpen] = useState(false);
  const [proposalRejectDialogOpen, setProposalRejectDialogOpen] = useState(false);
  const [proposalRejectReason, setProposalRejectReason] = useState('');

  // Pending Activation actions
  const [rejectReviewDialogOpen, setRejectReviewDialogOpen] = useState(false);
  const [rejectReviewTarget, setRejectReviewTarget] = useState<ProposalRecord | null>(null);
  const [rejectReviewComment, setRejectReviewComment] = useState('');
  const [activatingId, setActivatingId] = useState<string | null>(null);
  
  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);

  // Team = all agency users except the manager themselves (from real API data)
  const teamMembers = realUsers.filter(u => u.id !== currentUser.id && u.subCompanyId === currentSubCompany.id);

  // ===== AGENCY-WIDE STATS =====
  const totalLeads = leads.filter(l => l.subCompanyId === currentSubCompany.id);
  const activeLeads = totalLeads.filter(l => l.status === 'open').length;
  const wonLeads = totalLeads.filter(l => l.status === 'closed_won').length;
  const lostLeads = totalLeads.filter(l => l.status === 'closed_lost').length;

  const totalClients = clientCounts.total;
  const activeClients = clientCounts.active;

  // ===== LEAD REQUESTS =====
  const pendingLeadRequests = leadRequests.filter(lr => 
    lr.status === 'pending' && lr.subCompanyId === currentSubCompany.id
  );

  // ===== PROPOSALS =====
  const proposalsSubmitted = totalLeads.filter(l => l.stage === 'proposal_sent' || l.proposalData).length;
  const proposalsThisMonth = totalLeads.filter(l => {
    if (!l.proposalData?.createdAt) return false;
    const proposalDate = new Date(l.proposalData.createdAt);
    return proposalDate >= monthStart && proposalDate <= monthEnd;
  }).length;

  // ===== DATE RANGE HELPERS =====
  const getDateRange = (period: 'today' | 'month' | 'year') => {
    switch (period) {
      case 'today':
        return { start: startOfDay(now), end: endOfDay(now) };
      case 'month':
        return { start: monthStart, end: monthEnd };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
    }
  };

  const getPeriodLabel = (period: 'today' | 'month' | 'year') => {
    switch (period) {
      case 'today':
        return 'Today';
      case 'month':
        return format(now, 'MMMM yyyy');
      case 'year':
        return format(now, 'yyyy');
    }
  };

  // ===== TEAM CALL VOLUME =====
  const teamCallData = useMemo(() => {
    const { start, end } = getDateRange(callPeriod);
    return teamMembers.map(member => {
      const memberCalls = realCalls.filter(c => {
        const callDate = new Date(c.timestamp);
        return c.ownerId === member.id && callDate >= start && callDate <= end;
      });
      return {
        name: member.firstName,
        calls: memberCalls.length,
        answered: memberCalls.filter(c => c.outcome === 'answered').length,
      };
    });
  }, [callPeriod, teamMembers, realCalls]);

  // ===== TEAM EMAIL VOLUME =====
  const teamEmailData = useMemo(() => {
    const { start, end } = getDateRange(emailPeriod);
    return teamMembers.map(member => {
      const memberEmails = realActivityLogs.filter(a => {
        const logDate = new Date(a.timestamp);
        return a.userId === member.id && a.type === 'email_sent' && logDate >= start && logDate <= end;
      });
      return {
        name: member.firstName,
        emails: memberEmails.length,
      };
    });
  }, [emailPeriod, teamMembers, realActivityLogs]);

  // monthlyLeadData is now fetched from the API in loadData()

  // ===== TEAM OVERDUE ITEMS (all tasks/follow-ups except manager's own) =====
  const teamOverdueTasks = tasks.filter(t =>
    t.ownerId !== currentUser.id &&
    t.status !== 'done' &&
    isBefore(new Date(t.dueDate), now)
  );

  const teamOverdueFollowUps = followUps.filter(f =>
    f.ownerId !== currentUser.id &&
    !f.completed &&
    isBefore(new Date(f.dueDate), now)
  );

  const teamDueTodayTasks = tasks.filter(t =>
    t.ownerId !== currentUser.id &&
    t.status !== 'done' &&
    isToday(new Date(t.dueDate))
  );

  const teamDueTodayFollowUps = followUps.filter(f =>
    f.ownerId !== currentUser.id &&
    !f.completed &&
    isToday(new Date(f.dueDate))
  );

  // ===== MANAGER'S OWN ITEMS =====
  const myOverdueTasks = tasks.filter(t => 
    t.ownerId === currentUser.id && 
    t.status !== 'done' && 
    isBefore(new Date(t.dueDate), now) &&
    !isToday(new Date(t.dueDate))
  );

  const myDueTodayTasks = tasks.filter(t => 
    t.ownerId === currentUser.id && 
    t.status !== 'done' && 
    isToday(new Date(t.dueDate))
  );

  const myOverdueFollowUps = followUps.filter(f => 
    f.ownerId === currentUser.id && 
    !f.completed && 
    isBefore(new Date(f.dueDate), now) &&
    !isToday(new Date(f.dueDate))
  );

  const myDueTodayFollowUps = followUps.filter(f => 
    f.ownerId === currentUser.id && 
    !f.completed && 
    isToday(new Date(f.dueDate))
  );

  // Pipeline Summary for whole agency
  const agencyPipelineData = pipelineStages.map(stage => ({
    ...stage,
    count: totalLeads.filter(l => l.stage === stage.id).length,
  }));

  // todaysMeetings removed — calendar widget now fetches meetings for the selected date via API

  // CWP proposals split by activation readiness
  const awaitingClientProposals = cwpProposals.filter(p => !isReadyForActivation(p));
  const pendingActivationProposals = cwpProposals.filter(p => isReadyForActivation(p));

  // ===== LEAD REQUEST HANDLERS =====
  const handleReviewLeadRequest = (request: LeadRequest) => {
    setSelectedLeadRequest(request);
    setLeadRequestDialogOpen(true);
  };

  const finishLeadRequestReview = () => {
    setLeadRequestDialogOpen(false);
    setSelectedLeadRequest(null);
    setLeadRequestComments('');
    loadData();
  };

  // ===== PROPOSAL HANDLERS =====
  const handleViewProposalDetails = (lead: Lead) => {
    const client = clients.find(c => c.id === lead.clientId);
    if (client) {
      setSelectedProposal({ lead, client });
      setProposalDetailsOpen(true);
    }
  };

  const handleApproveProposal = (lead: Lead) => {
    updateLead(lead.id, {
      stage: 'closed_won',
      status: 'closed_won',
    });
    toast.success('Proposal approved', {
      description: 'Lead closed as Won — client is now active',
    });
    setProposalDetailsOpen(false);
    setSelectedProposal(null);
  };

  const handleRejectProposalClick = (lead: Lead) => {
    const client = clients.find(c => c.id === lead.clientId);
    if (client) {
      setSelectedProposal({ lead, client });
      setProposalRejectDialogOpen(true);
    }
  };

  const handleRejectProposalConfirm = () => {
    if (!selectedProposal) return;
    
    updateLead(selectedProposal.lead.id, { 
      stage: 'closed_lost',
      status: 'closed_lost',
      notes: proposalRejectReason ? `Rejected: ${proposalRejectReason}` : selectedProposal.lead.notes,
    });
    toast.success('Proposal rejected', {
      description: 'Lead has been moved to Closed Lost',
    });
    setProposalRejectDialogOpen(false);
    setProposalDetailsOpen(false);
    setProposalRejectReason('');
    setSelectedProposal(null);
  };

  const handleActivateProposal = async (p: ProposalRecord) => {
    setActivatingId(p.id);
    try {
      await activateProposal(p.id);
      toast.success('Lead activated successfully');
      await loadProposals();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to activate');
    } finally {
      setActivatingId(null);
    }
  };

  const handleRejectReviewClick = (p: ProposalRecord) => {
    setRejectReviewTarget(p);
    setRejectReviewComment('');
    setRejectReviewDialogOpen(true);
  };

  const handleRejectReviewConfirm = async () => {
    if (!rejectReviewTarget || !rejectReviewComment.trim()) return;
    try {
      await rejectProposalReview(rejectReviewTarget.id, rejectReviewComment.trim());
      toast.success('Review rejected');
      setRejectReviewDialogOpen(false);
      setRejectReviewTarget(null);
      setRejectReviewComment('');
      await loadProposals();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reject review');
    }
  };

  // ===== HELPER FUNCTIONS =====
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  const getPaymentTermsLabel = (terms: string) => {
    return terms.replace('net_', 'Net ');
  };

  const getAgreementTypeLabel = (type: string) => {
    return type === 'temp' ? 'Temp / Temp to Permanent' : 'Direct Placement';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Agency KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Agency Leads</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{activeLeads}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-blue-600">{wonLeads}</p>
                    <p className="text-xs text-muted-foreground">Won</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">{lostLeads}</p>
                    <p className="text-xs text-muted-foreground">Lost</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-blue-bg rounded-lg flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-kpi-blue-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Clients</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-green-600">{activeClients}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-muted-foreground">{totalClients}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-green-bg rounded-lg flex items-center justify-center">
                <Building2 className="h-6 w-6 text-kpi-green-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Lead Conversion Rate</p>
                <p className="text-2xl font-bold text-green-600 mt-2">
                  {totalLeads.length > 0 
                    ? `${Math.round((wonLeads / totalLeads.length) * 100)}%` 
                    : '0%'}
                </p>
              </div>
              <div className="w-12 h-12 bg-kpi-yellow-bg rounded-lg flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-kpi-yellow-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/tasks')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">My Tasks</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-purple-600">
                      {tasks.filter(t => t.ownerId === currentUser.id && t.status !== 'done' && isToday(new Date(t.dueDate))).length}
                    </p>
                    <p className="text-xs text-muted-foreground">Today</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">
                      {tasks.filter(t => t.ownerId === currentUser.id && t.status !== 'done' && isBefore(new Date(t.dueDate), startOfDay(now))).length}
                    </p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-purple-bg rounded-lg flex items-center justify-center">
                <ListChecks className="h-6 w-6 text-kpi-purple-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate('/tasks')}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Team Tasks</p>
                <div className="flex items-center gap-4 mt-2">
                  <div>
                    <p className="text-2xl font-bold text-blue-600">
                      {teamDueTodayTasks.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Today</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-red-600">
                      {teamOverdueTasks.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Overdue</p>
                  </div>
                </div>
              </div>
              <div className="w-12 h-12 bg-kpi-blue-bg rounded-lg flex items-center justify-center">
                <Users className="h-6 w-6 text-kpi-blue-icon" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Break & Idle Time Tracker */}
        {(() => {
          const totalBreakTime = myCoachingTime + myMeetingBreakTime;
          const totalTime = myIdleTime + totalBreakTime;
          const maxTime = Math.max(totalTime, 120);

          return (
            <Card className="border-none shadow-sm overflow-hidden">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-medium text-muted-foreground">Idle & Break Time Today</p>
                  <div className="w-10 h-10 bg-kpi-purple-bg rounded-lg flex items-center justify-center flex-shrink-0">
                    <Coffee className="h-5 w-5 text-kpi-purple-icon" />
                  </div>
                </div>

                <div className="mb-4">
                  <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                    <div
                      className="bg-amber-500 h-full transition-all"
                      style={{ width: `${(myIdleTime / maxTime) * 100}%` }}
                    />
                    <div className="w-0.5 bg-background" />
                    <div
                      className="bg-purple-500 h-full transition-all"
                      style={{ width: `${(totalBreakTime / maxTime) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500 flex-shrink-0" />
                    <div>
                      <p className="text-lg font-bold">{myIdleTime}m</p>
                      <p className="text-xs text-muted-foreground">Idle</p>
                    </div>
                  </div>

                  <div className="w-px h-10 bg-border flex-shrink-0" />

                  <div className="min-w-0">
                    <div className="flex items-center gap-1 mb-1">
                      <div className="w-2.5 h-2.5 rounded-full bg-purple-500 flex-shrink-0" />
                      <p className="text-xs font-medium text-muted-foreground">Break Time</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <GraduationCap className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                        <span className="text-sm font-semibold">{myCoachingTime}m</span>
                        <span className="text-xs text-muted-foreground">Coaching</span>
                      </div>
                      <div className="w-px h-4 bg-border flex-shrink-0" />
                      <div className="flex items-center gap-1.5">
                        <Users2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                        <span className="text-sm font-semibold">{myMeetingBreakTime}m</span>
                        <span className="text-xs text-muted-foreground">Meeting</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}
      </div>

      {canViewPipeline && (
      <Card className="border-none shadow-sm">
        <CardContent className="py-3 px-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6 flex-wrap">
              {agencyPipelineData.map((stage) => (
                <div 
                  key={stage.id} 
                  className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => navigate(`/pipeline?stage=${stage.id}`)}
                >
                  <span 
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0" 
                    style={{ backgroundColor: stage.color }}
                  />
                  <span className="text-sm font-medium">{stage.label}</span>
                  <span className="text-sm font-bold text-muted-foreground">({stage.count})</span>
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/pipeline')} className="gap-1 text-xs">
              View Pipeline <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Lead Requests + Proposals Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Lead Requests */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-semibold">Pending Lead Requests ({pendingLeadRequests.length})</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/approvals')} className="gap-1 text-xs h-7">
              View All <ExternalLink className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[280px]">
              {pendingLeadRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No pending requests</p>
              ) : (
                <div className="space-y-3">
                  {pendingLeadRequests.slice(0, 5).map(request => (
                    <div key={request.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium">{request.clientName}</p>
                          <p className="text-xs text-muted-foreground">Requested by: {request.requestedByName}</p>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{request.note}</p>
                        </div>
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300 text-xs shrink-0">
                          Pending
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-[10px] text-muted-foreground">
                          {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                        </p>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => handleReviewLeadRequest(request)}>
                          <Eye className="h-3 w-3 mr-1" />
                          Review
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Proposals Widget */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-sm font-semibold">Proposals</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-300 text-[10px] px-1.5 py-0">
                  Review {pendingReviewProposals.length}
                </Badge>
                <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300 text-[10px] px-1.5 py-0">
                  Awaiting Client {awaitingClientProposals.length}
                </Badge>
                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 text-[10px] px-1.5 py-0">
                  Activation {pendingActivationProposals.length}
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/proposals')} className="gap-1 text-xs h-7">
              View All <ExternalLink className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              {pendingReviewProposals.length === 0 && awaitingClientProposals.length === 0 && pendingActivationProposals.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No proposals requiring attention</p>
              ) : (
                <div className="space-y-4">
                  {/* For Review */}
                  {pendingReviewProposals.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-purple-700 uppercase tracking-wide mb-2">For Review</p>
                      <div className="space-y-2">
                        {pendingReviewProposals
                          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                          .slice(0, 5)
                          .map(p => (
                            <div key={p.id} className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium truncate">{p.lead.client.name}</p>
                                  <p className="text-xs text-muted-foreground">By: {p.lead.owner.firstName} {p.lead.owner.lastName}</p>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <p className="text-[10px] text-muted-foreground">{format(new Date(p.createdAt), 'MMM d')}</p>
                                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/proposals?manage=${p.id}`)}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Awaiting Client */}
                  {awaitingClientProposals.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide mb-2">Awaiting Client</p>
                      <div className="space-y-2">
                        {awaitingClientProposals.slice(0, 5).map(p => (
                          <div key={p.id} className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{p.lead.client.name}</p>
                                <p className="text-xs text-muted-foreground">By: {p.lead.owner.firstName} {p.lead.owner.lastName}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <p className="text-[10px] text-muted-foreground">{format(new Date(p.createdAt), 'MMM d')}</p>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/proposals?manage=${p.id}`)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Pending Activation */}
                  {pendingActivationProposals.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wide mb-2">Pending Activation</p>
                      <div className="space-y-2">
                        {pendingActivationProposals.slice(0, 5).map(p => (
                          <div key={p.id} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{p.lead.client.name}</p>
                                <p className="text-xs text-muted-foreground">By: {p.lead.owner.firstName} {p.lead.owner.lastName}</p>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <p className="text-[10px] text-muted-foreground mr-1">{format(new Date(p.createdAt), 'MMM d')}</p>
                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => navigate(`/proposals?manage=${p.id}`)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" className="h-6 w-6 bg-green-600 hover:bg-green-700" disabled={activatingId === p.id} onClick={() => handleActivateProposal(p)}>
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="icon" variant="destructive" className="h-6 w-6" onClick={() => handleRejectReviewClick(p)}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Team Performance Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Team Call Volume */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Team Call Volume - {getPeriodLabel(callPeriod)}
            </CardTitle>
            <Select value={callPeriod} onValueChange={(v) => setCallPeriod(v as 'today' | 'month' | 'year')}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={teamCallData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="name" 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar dataKey="calls" fill="#3b82f6" name="Total Calls" radius={[4, 4, 0, 0]} />
                <Bar dataKey="answered" fill="#10b981" name="Answered" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Team Email Volume */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Team Email Volume - {getPeriodLabel(emailPeriod)}
            </CardTitle>
            <Select value={emailPeriod} onValueChange={(v) => setEmailPeriod(v as 'today' | 'month' | 'year')}>
              <SelectTrigger className="w-[130px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={teamEmailData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="name" 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                />
                <Bar dataKey="emails" fill="#8b5cf6" name="Emails Sent" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Team Tasks + Team Follow-ups + My Tasks/Follow-ups Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Combined Team Tasks Widget (Overdue + Today) */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ListChecks className="h-4 w-4" />
              Team Tasks
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')} className="gap-1 text-[10px] h-6 px-2">
              View All <ExternalLink className="h-2.5 w-2.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="h-[320px]">
              {/* Overdue Section */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600">Overdue ({teamOverdueTasks.length})</span>
                </div>
                {teamOverdueTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No overdue tasks</p>
                ) : (
                  <div className="space-y-1.5">
                    {teamOverdueTasks.slice(0, 4).map(task => (
                      <div key={task.id} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                        <p className="font-medium truncate">{task.title}</p>
                        <div className="flex items-center justify-between mt-1 gap-2">
                          <p className="text-muted-foreground truncate">{task.ownerName}</p>
                          <p className="text-red-600 flex-shrink-0">{format(new Date(task.dueDate), 'MMM d')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* Due Today Section */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarIcon className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-600">Due Today ({teamDueTodayTasks.length})</span>
                </div>
                {teamDueTodayTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No tasks due today</p>
                ) : (
                  <div className="space-y-1.5">
                    {teamDueTodayTasks.slice(0, 4).map(task => (
                      <div key={task.id} className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                        <p className="font-medium truncate">{task.title}</p>
                        <div className="flex items-center justify-between mt-1 gap-2">
                          <p className="text-muted-foreground truncate">{task.ownerName}</p>
                          <Badge 
                            className={cn(
                              "capitalize text-[10px] px-1.5 py-0.5",
                              task.priority === 'high' && "bg-red-100 text-red-800 border-red-200",
                              task.priority === 'medium' && "bg-yellow-100 text-yellow-800 border-yellow-200",
                              task.priority === 'low' && "bg-green-100 text-green-800 border-green-200"
                            )}
                          >
                            {task.priority}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Combined Team Follow-ups Widget (Overdue + Today) */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Team Follow-ups
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/follow-ups')} className="gap-1 text-[10px] h-6 px-2">
              View All <ExternalLink className="h-2.5 w-2.5" />
            </Button>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="h-[320px]">
              {/* Overdue Section */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600">Overdue ({teamOverdueFollowUps.length})</span>
                </div>
                {teamOverdueFollowUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No overdue follow-ups</p>
                ) : (
                  <div className="space-y-1.5">
                    {teamOverdueFollowUps.slice(0, 4).map(followUp => {
                      const client = clients.find(c => c.id === followUp.clientId);
                      return (
                        <div key={followUp.id} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                          <p className="font-medium truncate">{followUp.notes || 'Follow-up'}</p>
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <p className="text-muted-foreground truncate">{followUp.ownerName} • {client?.name}</p>
                            <p className="text-red-600 flex-shrink-0">{format(new Date(followUp.dueDate), 'MMM d')}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              
              {/* Due Today Section */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarIcon className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-600">Due Today ({teamDueTodayFollowUps.length})</span>
                </div>
                {teamDueTodayFollowUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No follow-ups due today</p>
                ) : (
                  <div className="space-y-1.5">
                    {teamDueTodayFollowUps.slice(0, 4).map(followUp => {
                      const client = clients.find(c => c.id === followUp.clientId);
                      return (
                        <div key={followUp.id} className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                          <p className="font-medium truncate">{followUp.notes || 'Follow-up'}</p>
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <p className="text-muted-foreground truncate">{followUp.ownerName} • {client?.name}</p>
                            <p className="text-blue-600 flex-shrink-0">{format(new Date(followUp.dueDate), 'h:mm a')}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* My Tasks & Follow-ups Widget */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <User className="h-4 w-4" />
              My Tasks & Follow-ups
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <ScrollArea className="h-[320px]">
              {/* My Overdue Tasks */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-xs font-semibold text-red-600">My Overdue Tasks ({myOverdueTasks.length})</span>
                </div>
                {myOverdueTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No overdue tasks</p>
                ) : (
                  <div className="space-y-1.5">
                    {myOverdueTasks.slice(0, 3).map(task => (
                      <div key={task.id} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                        <p className="font-medium truncate">{task.title}</p>
                        <p className="text-red-600 text-[10px] mt-0.5">{format(new Date(task.dueDate), 'MMM d')}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* My Tasks Due Today */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarIcon className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-semibold text-blue-600">My Tasks Today ({myDueTodayTasks.length})</span>
                </div>
                {myDueTodayTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No tasks due today</p>
                ) : (
                  <div className="space-y-1.5">
                    {myDueTodayTasks.slice(0, 3).map(task => (
                      <div key={task.id} className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                        <p className="font-medium truncate">{task.title}</p>
                        <Badge 
                          className={cn(
                            "capitalize text-[10px] px-1.5 py-0.5 mt-0.5",
                            task.priority === 'high' && "bg-red-100 text-red-800 border-red-200",
                            task.priority === 'medium' && "bg-yellow-100 text-yellow-800 border-yellow-200",
                            task.priority === 'low' && "bg-green-100 text-green-800 border-green-200"
                          )}
                        >
                          {task.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* My Overdue Follow-ups */}
              <div className="mb-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  <span className="text-xs font-semibold text-orange-600">My Overdue Follow-ups ({myOverdueFollowUps.length})</span>
                </div>
                {myOverdueFollowUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No overdue follow-ups</p>
                ) : (
                  <div className="space-y-1.5">
                    {myOverdueFollowUps.slice(0, 3).map(followUp => {
                      const client = clients.find(c => c.id === followUp.clientId);
                      return (
                        <div key={followUp.id} className="p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                          <p className="font-medium truncate">{followUp.notes || 'Follow-up'}</p>
                          <p className="text-muted-foreground text-[10px] mt-0.5 truncate">{client?.name}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* My Follow-ups Due Today */}
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <CalendarIcon className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-xs font-semibold text-green-600">My Follow-ups Today ({myDueTodayFollowUps.length})</span>
                </div>
                {myDueTodayFollowUps.length === 0 ? (
                  <p className="text-xs text-muted-foreground pl-5">No follow-ups due today</p>
                ) : (
                  <div className="space-y-1.5">
                    {myDueTodayFollowUps.slice(0, 3).map(followUp => {
                      const client = clients.find(c => c.id === followUp.clientId);
                      return (
                        <div key={followUp.id} className="p-2 bg-green-50 border border-green-200 rounded text-xs">
                          <p className="font-medium truncate">{followUp.notes || 'Follow-up'}</p>
                          <p className="text-muted-foreground text-[10px] mt-0.5 truncate">{client?.name}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Calendar + Agency Lead Chart Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <Card className="border-none shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2 px-4 pt-4">
            <CardTitle className="text-sm font-semibold">Calendar</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={(date) => { if (date) setSelectedDate(date); }}
              className={cn("w-full rounded-md border-0 text-xs")}
            />
            
            <div className="mt-2 pt-2 border-t">
              <p className="text-sm font-bold mb-3">
                {selectedDate && isToday(selectedDate) ? "Today's Events" : selectedDate ? format(selectedDate, 'MMM d') + ' Events' : 'Events'}
              </p>
              <div className="space-y-2">
                {selectedDateEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No events on this day</p>
                ) : (
                  selectedDateEvents.slice(0, 8).map(e => (
                    <div key={`${e.type}-${e.id}`} className="flex items-center gap-1.5 text-sm">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${eventDotColor(e.type)}`} />
                      <span className="font-medium truncate">{e.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{format(e.time, 'h:mm a')}</span>
                    </div>
                  ))
                )}
              </div>
              {/* Color legend */}
              <div className="flex items-center gap-3 mt-3 pt-2 border-t">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-[10px] text-muted-foreground">Meeting</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-orange-500" /><span className="text-[10px] text-muted-foreground">Task</span></div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] text-muted-foreground">Follow-Up</span></div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Agency Lead Status Chart */}
        <Card className="border-none shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold">Agency Lead Status Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={monthlyLeadData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="month" 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="#6b7280" 
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px'
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '12px' }}
                  iconType="circle"
                />
                <Line type="monotone" dataKey="Won" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', strokeWidth: 2, r: 4 }} />
                <Line type="monotone" dataKey="Lost" stroke="#ef4444" strokeWidth={2} dot={{ fill: '#ef4444', strokeWidth: 2, r: 4 }} />
                <Line type="monotone" dataKey="Active" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', strokeWidth: 2, r: 4 }} />
                <Line type="monotone" dataKey="Open" stroke="#f59e0b" strokeWidth={2} dot={{ fill: '#f59e0b', strokeWidth: 2, r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Lead Request Review Dialog */}
      <Dialog open={leadRequestDialogOpen} onOpenChange={setLeadRequestDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Review Lead Request</DialogTitle>
            <DialogDescription>
              Review and approve or reject this lead request
            </DialogDescription>
          </DialogHeader>
          {selectedLeadRequest && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <p className="text-sm font-medium">Client</p>
                <p className="text-sm text-muted-foreground">{selectedLeadRequest.clientName}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Contact</p>
                <p className="text-sm text-muted-foreground">{selectedLeadRequest.primaryContactName}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Requested By</p>
                <p className="text-sm text-muted-foreground">{selectedLeadRequest.requestedByName}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Note</p>
                <p className="text-sm text-muted-foreground bg-muted p-2 rounded">{selectedLeadRequest.note}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Requested At</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(selectedLeadRequest.requestedAt), 'MMM d, yyyy h:mm a')}
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Comments (optional for approval, required for rejection)</p>
                <Textarea
                  placeholder="Add your comments here..."
                  value={leadRequestComments}
                  onChange={(e) => setLeadRequestComments(e.target.value)}
                />
              </div>
              <ApprovalQueueActions
                workflow="lead_request"
                entityId={selectedLeadRequest.id}
                subCompanyId={selectedLeadRequest.subCompanyId}
                remarks={leadRequestComments}
                requireRemarksForReject
                forwardLabel="Forward lead"
                onActionComplete={finishLeadRequestReview}
              />
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLeadRequestDialogOpen(false);
                setSelectedLeadRequest(null);
                setLeadRequestComments('');
              }}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Proposal Details Dialog */}
      <Dialog open={proposalDetailsOpen} onOpenChange={setProposalDetailsOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedProposal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Proposal Details - {selectedProposal.client.name}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-6 py-4">
                {/* Owner */}
                <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Submitted by</p>
                    <p className="font-medium">{selectedProposal.lead.ownerName}</p>
                  </div>
                </div>

                {/* Agreement Type */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Agreement Type</h4>
                  <Badge variant="secondary" className="capitalize">
                    {getAgreementTypeLabel(selectedProposal.lead.proposalData?.agreementType || 'temp')}
                  </Badge>
                </div>

                {/* Pricing */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Pricing</h4>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {selectedProposal.lead.proposalData?.pricingType === 'markup' ? 'Markup' : 'Bill Rate'}
                    </Badge>
                    <span className="font-medium">
                      {selectedProposal.lead.proposalData?.pricingType === 'markup' 
                        ? `${selectedProposal.lead.proposalData?.pricingValue}%` 
                        : `$${selectedProposal.lead.proposalData?.pricingValue}/hr`}
                    </span>
                  </div>
                </div>

                {/* Payment Terms */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Payment Terms</h4>
                  <Badge variant="secondary">
                    {getPaymentTermsLabel(selectedProposal.lead.proposalData?.paymentTerms || 'net_30')}
                  </Badge>
                </div>

                {/* Primary Location */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Primary Location</h4>
                  <div className="p-3 rounded-lg border bg-muted/30">
                    <div className="font-medium">{selectedProposal.client.name}</div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                      <MapPin className="h-3 w-3" />
                      {selectedProposal.client.address}
                    </div>
                    <div className="text-sm text-muted-foreground">{selectedProposal.client.location}</div>
                  </div>
                </div>

                {/* Additional Locations */}
                {selectedProposal.lead.proposalData?.locationType === 'multiple' && 
                  selectedProposal.lead.proposalData?.selectedClients?.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      Additional Locations ({selectedProposal.lead.proposalData.selectedClients.length})
                    </h4>
                    <ScrollArea className="max-h-[150px]">
                      <div className="space-y-2">
                        {selectedProposal.lead.proposalData.selectedClients.map((clientId) => {
                          const additionalClient = clients.find(c => c.id === clientId);
                          if (!additionalClient) return null;
                          return (
                            <div key={clientId} className="p-3 rounded-lg border">
                              <div className="font-medium">{additionalClient.name}</div>
                              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                                <MapPin className="h-3 w-3" />
                                {additionalClient.address}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </ScrollArea>
                  </div>
                )}

                <Separator />

                {/* Attachments */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    Attachments ({selectedProposal.lead.proposalData?.attachments?.length || 0})
                  </h4>
                  {(!selectedProposal.lead.proposalData?.attachments || 
                    selectedProposal.lead.proposalData.attachments.length === 0) ? (
                    <p className="text-sm text-muted-foreground italic">No attachments</p>
                  ) : (
                    <CrmAttachmentList
                      items={selectedProposal.lead.proposalData.attachments.map((attachment) => ({
                        id: attachment.id,
                        name: attachment.name,
                        mimeType: attachment.type,
                        size: attachment.size,
                      }))}
                      fetchBlob={(item) => fetchProposalAttachmentBlob(item.id)}
                      onDownload={(item) => downloadProposalAttachment(item.id, item.name)}
                    />
                  )}
                </div>

                <Separator />

                {/* Comment */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Comments</h4>
                  {selectedProposal.lead.proposalData?.comment ? (
                    <p className="text-sm whitespace-pre-wrap p-3 rounded-lg border bg-muted/30">
                      {selectedProposal.lead.proposalData.comment}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No comments</p>
                  )}
                </div>

                {/* Created Date */}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarIcon className="h-4 w-4" />
                  Submitted on {format(new Date(selectedProposal.lead.proposalData!.createdAt), 'MMMM d, yyyy')}
                </div>
              </div>

              <DialogFooter className="gap-2">
                <Button 
                  variant="outline" 
                  onClick={() => setProposalDetailsOpen(false)}
                >
                  Close
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setProposalRejectDialogOpen(true);
                  }}
                >
                  <X className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button 
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => handleApproveProposal(selectedProposal.lead)}
                >
                  <Check className="h-4 w-4 mr-1" />
                  Approve
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Proposal Reject Confirmation Dialog */}
      <Dialog open={proposalRejectDialogOpen} onOpenChange={setProposalRejectDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reject Proposal</DialogTitle>
            <DialogDescription>
              Are you sure you want to reject this proposal? The lead will be moved to Closed Lost.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Reason for rejection (optional)"
              value={proposalRejectReason}
              onChange={(e) => setProposalRejectReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setProposalRejectDialogOpen(false);
                setProposalRejectReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectProposalConfirm}
            >
              <X className="h-4 w-4 mr-1" />
              Reject Proposal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Review Dialog (Pending Activation) */}
      <Dialog open={rejectReviewDialogOpen} onOpenChange={setRejectReviewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Activation</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting this activation request.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              placeholder="Reason for rejection (required)"
              value={rejectReviewComment}
              onChange={(e) => setRejectReviewComment(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setRejectReviewDialogOpen(false); setRejectReviewComment(''); }}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!rejectReviewComment.trim()} onClick={handleRejectReviewConfirm}>
              <X className="h-4 w-4 mr-1" />
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
