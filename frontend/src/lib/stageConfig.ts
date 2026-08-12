import { LeadStage } from './types';

export const stageLabels: Record<LeadStage, string> = {
  new_lead: 'New Lead',
  contacted: 'Contacted',
  follow_up: 'Follow-Up',
  meeting_scheduled: 'Meeting Scheduled',
  proposal_sent: 'Proposal Sent',
  awaiting_client_approval: 'Awaiting Client Approval',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
};

export const stageColors: Record<LeadStage, string> = {
  new_lead: 'bg-stage-new text-white',
  contacted: 'bg-stage-contacted text-white',
  follow_up: 'bg-stage-followup text-white',
  meeting_scheduled: 'bg-stage-meeting text-white',
  proposal_sent: 'bg-stage-proposal text-white',
  awaiting_client_approval: 'bg-orange-500 text-white',
  closed_won: 'bg-stage-won text-white',
  closed_lost: 'bg-stage-lost text-white',
};

export const stageBgColors: Record<LeadStage, string> = {
  new_lead: 'bg-cyan-50 border-cyan-200',
  contacted: 'bg-purple-50 border-purple-200',
  follow_up: 'bg-amber-50 border-amber-200',
  meeting_scheduled: 'bg-blue-50 border-blue-200',
  proposal_sent: 'bg-violet-50 border-violet-200',
  awaiting_client_approval: 'bg-orange-50 border-orange-200',
  closed_won: 'bg-green-50 border-green-200',
  closed_lost: 'bg-red-50 border-red-200',
};

export const stageOrder: LeadStage[] = [
  'new_lead',
  'meeting_scheduled',
  'follow_up',
  'proposal_sent',
  'awaiting_client_approval',
  'closed_won',
  'closed_lost',
];
