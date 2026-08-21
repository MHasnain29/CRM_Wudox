/**
 * Socket.IO client for real-time messaging.
 * Connects with JWT; listens for message:new and conversation:read.
 * Used by Messages page so bubbles and unread count update without refresh.
 */
import { io, Socket } from 'socket.io-client';
import { API_BASE, getTunnelHeaders } from './apiConfig';
import { TOKEN_KEY } from './sessionKeys';

const SOCKET_PATH = '/socket.io';

let socket: Socket | null = null;

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export interface MessageNewPayload {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    senderName: string;
    text: string | null;
    type?: 'text' | 'call' | string;
    metadata?: CallMessageMetadata | null;
    createdAt: string;
    attachments: Array<{ id: string; name: string; fileUrl: string; mimeType: string | null; fileSize: number | null }>;
  };
  /** Socket-only: play sound without toast (e.g. snip share). */
  playSoundOnly?: boolean;
}

export interface CallMessageMetadata {
  mediaType?: 'audio' | 'video';
  outcome?: 'completed' | 'declined' | 'cancelled' | 'missed';
  durationSec?: number;
  callId?: string;
}

export interface ConversationReadPayload {
  conversationId: string;
}

export interface TaskCommentPayload {
  taskId: string;
  comment: {
    id: string;
    taskId: string;
    userId: string;
    userName: string;
    content: string;
    createdAt: string;
  };
}

export interface TaskAssignedPayload {
  taskId: string;
  title: string;
  body?: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  dueDate: string | null;
  assignedByName: string;
}

export interface TaskRefreshPayload {
  subCompanyId: string;
}

export interface ProposalRefreshPayload {
  subCompanyId: string;
}

export interface EmployeeOnboardingRefreshPayload {
  employeeId: string;
  pandaDocStatus?: string;
  completed?: boolean;
}

export interface CallRefreshPayload {
  subCompanyId: string;
}

export interface VoiceCallEndedPayload {
  type: 'inbound' | 'outbound';
  inboundCallId?: string;
  callRecordId?: string;
  subCompanyId: string;
  reason: 'remote_hangup';
}

export interface MeetingRefreshPayload {
  subCompanyId: string;
}

export interface FollowUpRefreshPayload {
  subCompanyId: string;
}

export interface ListChangedPayload {
  listId: string;
  title?: string;
  body?: string;
}

export interface LeadRefreshPayload {
  subCompanyId: string;
}

export interface ClientRefreshPayload {
  subCompanyId: string;
}

export interface TargetsRefreshPayload {
  subCompanyId: string;
  role: string;
  target: {
    callsTarget: number;
    emailsTarget: number;
    meetingScheduleCountTarget: number;
  };
}

export interface EmailRefreshPayload {
  subCompanyId: string;
}

export interface ReassignmentRefreshPayload {
  subCompanyId: string;
}

export interface LeaveRefreshPayload {
  subCompanyId: string;
}
export type LeaveRefreshHandler = (payload: LeaveRefreshPayload) => void;

export type InternalCallMedia = 'audio' | 'video';

export interface InternalCallIncomingPayload {
  callId: string;
  conversationId: string;
  callerId: string;
  callerName: string;
  mediaType: InternalCallMedia;
}

export interface InternalCallAcceptedPayload {
  callId: string;
  conversationId: string;
  mediaType: InternalCallMedia;
  peerId: string;
}

export interface InternalCallIdPayload {
  callId: string;
}

export interface InternalCallBusyPayload {
  callId: string;
  reason?: 'callee_busy' | 'self_busy';
}

export interface InternalCallErrorPayload {
  callId?: string;
  reason?: string;
}

export interface InternalCallSignalPayload {
  callId: string;
  type: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
}

export type MessageNewHandler = (payload: MessageNewPayload) => void;
export type ConversationReadHandler = (payload: ConversationReadPayload) => void;
export type TaskCommentHandler = (payload: TaskCommentPayload) => void;
export type TaskAssignedHandler = (payload: TaskAssignedPayload) => void;
export type TaskRefreshHandler = (payload: TaskRefreshPayload) => void;
export type ProposalRefreshHandler = (payload: ProposalRefreshPayload) => void;
export type EmployeeOnboardingRefreshHandler = (payload: EmployeeOnboardingRefreshPayload) => void;
export type CallRefreshHandler = (payload: CallRefreshPayload) => void;
export type VoiceCallEndedHandler = (payload: VoiceCallEndedPayload) => void;
export type MeetingRefreshHandler = (payload: MeetingRefreshPayload) => void;
export type FollowUpRefreshHandler = (payload: FollowUpRefreshPayload) => void;
export type ListChangedHandler = (payload: ListChangedPayload) => void;
export type LeadRefreshHandler = (payload: LeadRefreshPayload) => void;
export type ClientRefreshHandler = (payload: ClientRefreshPayload) => void;
export type TargetsRefreshHandler = (payload: TargetsRefreshPayload) => void;
export type EmailRefreshHandler = (payload: EmailRefreshPayload) => void;
export type ReassignmentRefreshHandler = (payload: ReassignmentRefreshPayload) => void;
export type AgencyLinkChangedHandler = () => void;
export type InternalCallIncomingHandler = (payload: InternalCallIncomingPayload) => void;
export type InternalCallAcceptedHandler = (payload: InternalCallAcceptedPayload) => void;
export type InternalCallIdHandler = (payload: InternalCallIdPayload) => void;
export type InternalCallBusyHandler = (payload: InternalCallBusyPayload) => void;
export type InternalCallErrorHandler = (payload: InternalCallErrorPayload) => void;
export type InternalCallSignalHandler = (payload: InternalCallSignalPayload) => void;

const messageNewListeners = new Set<MessageNewHandler>();
const conversationReadListeners = new Set<ConversationReadHandler>();
const taskCommentListeners = new Set<TaskCommentHandler>();
const taskAssignedListeners = new Set<TaskAssignedHandler>();
const taskRefreshListeners = new Set<TaskRefreshHandler>();
const proposalRefreshListeners = new Set<ProposalRefreshHandler>();
const employeeOnboardingRefreshListeners = new Set<EmployeeOnboardingRefreshHandler>();
const callRefreshListeners = new Set<CallRefreshHandler>();
const voiceCallEndedListeners = new Set<VoiceCallEndedHandler>();
const meetingRefreshListeners = new Set<MeetingRefreshHandler>();
const followUpRefreshListeners = new Set<FollowUpRefreshHandler>();
const listChangedListeners = new Set<ListChangedHandler>();
const leadRefreshListeners = new Set<LeadRefreshHandler>();
const clientRefreshListeners = new Set<ClientRefreshHandler>();
const targetsRefreshListeners = new Set<TargetsRefreshHandler>();
const emailRefreshListeners = new Set<EmailRefreshHandler>();
const reassignmentRefreshListeners = new Set<ReassignmentRefreshHandler>();
const leaveRefreshListeners = new Set<LeaveRefreshHandler>();
const agencyLinkChangedListeners = new Set<AgencyLinkChangedHandler>();
const internalCallIncomingListeners = new Set<InternalCallIncomingHandler>();
const internalCallAcceptedListeners = new Set<InternalCallAcceptedHandler>();
const internalCallRejectedListeners = new Set<InternalCallIdHandler>();
const internalCallBusyListeners = new Set<InternalCallBusyHandler>();
const internalCallCancelledListeners = new Set<InternalCallIdHandler>();
const internalCallEndedListeners = new Set<InternalCallIdHandler>();
const internalCallErrorListeners = new Set<InternalCallErrorHandler>();
const internalCallSignalListeners = new Set<InternalCallSignalHandler>();

function connect(): Socket | null {
  const token = getToken();
  if (!token) return null;
  // Reuse existing socket regardless of connection state — socket.io handles reconnection internally.
  // Creating a new socket while the old one exists results in duplicate event handlers.
  if (socket) return socket;

  socket = io(API_BASE, {
    path: SOCKET_PATH,
    auth: { token },
    extraHeaders: getTunnelHeaders(),
    // Try polling first; upgrade to websocket. Avoids "cannot parse response" when proxy doesn't forward WSS yet.
    transports: ['polling', 'websocket'],
  });

  socket.on('message:new', (payload: MessageNewPayload) => {
    messageNewListeners.forEach((fn) => fn(payload));
  });

  socket.on('conversation:read', (payload: ConversationReadPayload) => {
    conversationReadListeners.forEach((fn) => fn(payload));
  });

  socket.on('task:comment', (payload: TaskCommentPayload) => {
    taskCommentListeners.forEach((fn) => fn(payload));
  });

  socket.on('task:assigned', (payload: TaskAssignedPayload) => {
    taskAssignedListeners.forEach((fn) => fn(payload));
  });

  socket.on('task:refresh', (payload: TaskRefreshPayload) => {
    taskRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('proposal:refresh', (payload: ProposalRefreshPayload) => {
    proposalRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('employee-onboarding:refresh', (payload: EmployeeOnboardingRefreshPayload) => {
    employeeOnboardingRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('call:refresh', (payload: CallRefreshPayload) => {
    callRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('voice:call-ended', (payload: VoiceCallEndedPayload) => {
    voiceCallEndedListeners.forEach((fn) => fn(payload));
  });

  socket.on('meeting:refresh', (payload: MeetingRefreshPayload) => {
    meetingRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('list:assigned', (payload: ListChangedPayload) => {
    listChangedListeners.forEach((fn) => fn(payload));
  });

  socket.on('list:changed', (payload: ListChangedPayload) => {
    listChangedListeners.forEach((fn) => fn(payload));
  });

  socket.on('followup:refresh', (payload: FollowUpRefreshPayload) => {
    followUpRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('lead:refresh', (payload: LeadRefreshPayload) => {
    leadRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('client:refresh', (payload: ClientRefreshPayload) => {
    clientRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('targets:refresh', (payload: TargetsRefreshPayload) => {
    targetsRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('email:refresh', (payload: EmailRefreshPayload) => {
    emailRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('reassignment:refresh', (payload: ReassignmentRefreshPayload) => {
    reassignmentRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('leave:refresh', (payload: LeaveRefreshPayload) => {
    leaveRefreshListeners.forEach((fn) => fn(payload));
  });

  socket.on('agency:link_changed', () => {
    agencyLinkChangedListeners.forEach((fn) => fn());
  });

  socket.on('internal-call:incoming', (payload: InternalCallIncomingPayload) => {
    internalCallIncomingListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:accepted', (payload: InternalCallAcceptedPayload) => {
    internalCallAcceptedListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:rejected', (payload: InternalCallIdPayload) => {
    internalCallRejectedListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:busy', (payload: InternalCallBusyPayload) => {
    internalCallBusyListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:cancelled', (payload: InternalCallIdPayload) => {
    internalCallCancelledListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:ended', (payload: InternalCallIdPayload) => {
    internalCallEndedListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:error', (payload: InternalCallErrorPayload) => {
    internalCallErrorListeners.forEach((fn) => fn(payload));
  });
  socket.on('internal-call:signal', (payload: InternalCallSignalPayload) => {
    internalCallSignalListeners.forEach((fn) => fn(payload));
  });

  socket.on('connect_error', () => {
    // Don't null socket — socket.io will auto-retry. Nulling here causes a new socket to be
    // created on the next getSocket() call, leaving the old one alive and producing duplicate events.
  });

  socket.on('disconnect', (reason) => {
    // Only null on explicit server-side kick; socket.io retries everything else automatically.
    if (reason === 'io server disconnect') socket = null;
  });

  return socket;
}

function disconnect(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/** Get or create the socket. Call when the app has a token (e.g. after login). */
export function getSocket(): Socket | null {
  if (socket?.connected) return socket;
  return connect();
}

/** Wait until the shared socket is connected (or timeout). */
export function waitForSocket(timeoutMs = 8000): Promise<Socket | null> {
  const existing = getSocket();
  if (!existing) return Promise.resolve(null);
  if (existing.connected) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      existing.off('connect', onConnect);
      resolve(existing.connected ? existing : null);
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(existing);
    };
    existing.once('connect', onConnect);
  });
}

/** Disconnect (e.g. on logout). */
export function closeSocket(): void {
  disconnect();
}

/** Subscribe to new message events (e.g. from Messages page). Returns unsubscribe. */
export function onMessageNew(handler: MessageNewHandler): () => void {
  messageNewListeners.add(handler);
  getSocket();
  return () => messageNewListeners.delete(handler);
}

/** Subscribe to conversation read events (other party read; refresh unread). Returns unsubscribe. */
export function onConversationRead(handler: ConversationReadHandler): () => void {
  conversationReadListeners.add(handler);
  getSocket();
  return () => conversationReadListeners.delete(handler);
}

/** Subscribe to task comment events (someone else commented on a task). Returns unsubscribe. */
export function onTaskComment(handler: TaskCommentHandler): () => void {
  taskCommentListeners.add(handler);
  getSocket();
  return () => taskCommentListeners.delete(handler);
}

/** Subscribe to task assigned events (a task was assigned to the current user). Returns unsubscribe. */
export function onTaskAssigned(handler: TaskAssignedHandler): () => void {
  taskAssignedListeners.add(handler);
  getSocket();
  return () => taskAssignedListeners.delete(handler);
}

/** Subscribe to task refresh events (any task mutation in the user's scope). Returns unsubscribe. */
export function onTaskRefresh(handler: TaskRefreshHandler): () => void {
  taskRefreshListeners.add(handler);
  getSocket();
  return () => taskRefreshListeners.delete(handler);
}

/** Subscribe to proposal refresh events (proposal submitted/approved/rejected). Returns unsubscribe. */
export function onProposalRefresh(handler: ProposalRefreshHandler): () => void {
  proposalRefreshListeners.add(handler);
  getSocket();
  return () => proposalRefreshListeners.delete(handler);
}

/** Subscribe when employee onboarding PandaDoc status changes (webhook / sync). */
export function onEmployeeOnboardingRefresh(handler: EmployeeOnboardingRefreshHandler): () => void {
  employeeOnboardingRefreshListeners.add(handler);
  getSocket();
  return () => employeeOnboardingRefreshListeners.delete(handler);
}

/** Subscribe to call refresh events. Returns unsubscribe. */
export function onCallRefresh(handler: CallRefreshHandler): () => void {
  callRefreshListeners.add(handler);
  getSocket();
  return () => callRefreshListeners.delete(handler);
}

/** Subscribe when remote party hangs up (caller/callee dropped). Returns unsubscribe. */
export function onVoiceCallEnded(handler: VoiceCallEndedHandler): () => void {
  voiceCallEndedListeners.add(handler);
  getSocket();
  return () => voiceCallEndedListeners.delete(handler);
}

/** Subscribe to meeting refresh events. Returns unsubscribe. */
export function onMeetingRefresh(handler: MeetingRefreshHandler): () => void {
  meetingRefreshListeners.add(handler);
  getSocket();
  return () => meetingRefreshListeners.delete(handler);
}

/** Subscribe to follow-up refresh events. Returns unsubscribe. */
export function onFollowUpRefresh(handler: FollowUpRefreshHandler): () => void {
  followUpRefreshListeners.add(handler);
  getSocket();
  return () => followUpRefreshListeners.delete(handler);
}

/** Subscribe to mailing-list assignment/change events. Returns unsubscribe. */
export function onListChanged(handler: ListChangedHandler): () => void {
  listChangedListeners.add(handler);
  getSocket();
  return () => listChangedListeners.delete(handler);
}

/** Subscribe to lead refresh events. Returns unsubscribe. */
export function onLeadRefresh(handler: LeadRefreshHandler): () => void {
  leadRefreshListeners.add(handler);
  getSocket();
  return () => leadRefreshListeners.delete(handler);
}

/** Subscribe to client refresh events. Returns unsubscribe. */
export function onClientRefresh(handler: ClientRefreshHandler): () => void {
  clientRefreshListeners.add(handler);
  getSocket();
  return () => clientRefreshListeners.delete(handler);
}

/** Subscribe to performance targets refresh events (super user changed agency targets). Returns unsubscribe. */
export function onTargetsRefresh(handler: TargetsRefreshHandler): () => void {
  targetsRefreshListeners.add(handler);
  getSocket();
  return () => targetsRefreshListeners.delete(handler);
}

/** Subscribe to lead reassignment queue refresh events. Returns unsubscribe. */
export function onReassignmentRefresh(handler: ReassignmentRefreshHandler): () => void {
  reassignmentRefreshListeners.add(handler);
  getSocket();
  return () => reassignmentRefreshListeners.delete(handler);
}

/** Subscribe to leave request refresh events (new request submitted / approved / rejected). Returns unsubscribe. */
export function onLeaveRefresh(handler: LeaveRefreshHandler): () => void {
  leaveRefreshListeners.add(handler);
  getSocket();
  return () => leaveRefreshListeners.delete(handler);
}

/** Subscribe to email refresh events. Returns unsubscribe. */
export function onEmailRefresh(handler: EmailRefreshHandler): () => void {
  emailRefreshListeners.add(handler);
  getSocket();
  return () => emailRefreshListeners.delete(handler);
}

/** Subscribe to agency link/unlink changes (refresh linked-accounts query). Returns unsubscribe. */
export function onAgencyLinkChanged(handler: AgencyLinkChangedHandler): () => void {
  agencyLinkChangedListeners.add(handler);
  getSocket();
  return () => agencyLinkChangedListeners.delete(handler);
}

export function onInternalCallIncoming(handler: InternalCallIncomingHandler): () => void {
  internalCallIncomingListeners.add(handler);
  getSocket();
  return () => internalCallIncomingListeners.delete(handler);
}

export function onInternalCallAccepted(handler: InternalCallAcceptedHandler): () => void {
  internalCallAcceptedListeners.add(handler);
  getSocket();
  return () => internalCallAcceptedListeners.delete(handler);
}

export function onInternalCallRejected(handler: InternalCallIdHandler): () => void {
  internalCallRejectedListeners.add(handler);
  getSocket();
  return () => internalCallRejectedListeners.delete(handler);
}

export function onInternalCallBusy(handler: InternalCallBusyHandler): () => void {
  internalCallBusyListeners.add(handler);
  getSocket();
  return () => internalCallBusyListeners.delete(handler);
}

export function onInternalCallCancelled(handler: InternalCallIdHandler): () => void {
  internalCallCancelledListeners.add(handler);
  getSocket();
  return () => internalCallCancelledListeners.delete(handler);
}

export function onInternalCallEnded(handler: InternalCallIdHandler): () => void {
  internalCallEndedListeners.add(handler);
  getSocket();
  return () => internalCallEndedListeners.delete(handler);
}

export function onInternalCallError(handler: InternalCallErrorHandler): () => void {
  internalCallErrorListeners.add(handler);
  getSocket();
  return () => internalCallErrorListeners.delete(handler);
}

export function onInternalCallSignal(handler: InternalCallSignalHandler): () => void {
  internalCallSignalListeners.add(handler);
  getSocket();
  return () => internalCallSignalListeners.delete(handler);
}

export function emitInternalCallInvite(payload: {
  callId: string;
  conversationId: string;
  calleeId: string;
  mediaType: InternalCallMedia;
}): void {
  getSocket()?.emit('internal-call:invite', payload);
}

export function emitInternalCallAccept(callId: string): void {
  getSocket()?.emit('internal-call:accept', { callId });
}

export function emitInternalCallReject(callId: string): void {
  getSocket()?.emit('internal-call:reject', { callId });
}

export function emitInternalCallBusyHere(callId: string): void {
  getSocket()?.emit('internal-call:busy-here', { callId });
}

export function emitInternalCallCancel(callId: string): void {
  getSocket()?.emit('internal-call:cancel', { callId });
}

export function emitInternalCallEnded(callId: string): void {
  getSocket()?.emit('internal-call:ended', { callId });
}

export function emitInternalCallSignal(payload: InternalCallSignalPayload): void {
  getSocket()?.emit('internal-call:signal', payload);
}

/** Whether the socket is connected. */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}
