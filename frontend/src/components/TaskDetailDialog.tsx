import { useState, useRef, useEffect } from 'react';
import { Task, TaskAttachment, TaskComment, TaskStatus } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { Clock, User, Calendar, MessageSquare, CheckCircle2, AlertCircle, Building2, MapPin, Briefcase, Target, TrendingUp, Flame, Snowflake, Sun, ExternalLink, Paperclip, Download, Trash2, FileText, Image, File } from 'lucide-react';
import { useStore } from '@/lib/store';
import { useCanViewTeamScope } from '@/lib/access';
import { useActAs } from '@/hooks/useActAs';
import { updateTaskApi, addTaskCommentApi, uploadTaskAttachment, deleteTaskAttachment, fetchTaskAttachmentBlob } from '@/lib/api';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { toast } from 'sonner';

const priorityColors = {
  low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

const statusIcons = {
  to_do: Clock,
  in_progress: AlertCircle,
  done: CheckCircle2,
};

interface TaskDetailDialogProps {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TaskDetailDialog({ task, open, onOpenChange }: TaskDetailDialogProps) {
  const { currentUser, updateTask, tasks, clients, leads, meetings, followUps } = useStore();
  const isManager = useCanViewTeamScope();
  const actAs = useActAs();
  const effectiveUserId = actAs.isActive ? actAs.userId! : currentUser.id;
  const [newComment, setNewComment] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [localAttachments, setLocalAttachments] = useState<TaskAttachment[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Always read the live task from the store so attachments/comments are never stale
  const liveTask = tasks.find((t) => t.id === task?.id) ?? task;

  // Sync localAttachments from store whenever dialog opens or task changes
  useEffect(() => {
    if (open && liveTask) {
      setLocalAttachments(Array.isArray(liveTask.attachments) ? liveTask.attachments : []);
    }
  }, [open, liveTask?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!liveTask) return null;

  const StatusIcon = statusIcons[liveTask.status];
  const canEdit = isManager || liveTask.ownerId === effectiveUserId;
  const comments = Array.isArray(liveTask.comments) ? liveTask.comments : [];

  const handleUploadAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setUploadingFiles(fileArr.map((f) => f.name));
    try {
      const results = await Promise.allSettled(fileArr.map((f) => uploadTaskAttachment(liveTask.id, f)));
      const succeeded = results
        .filter((r): r is PromiseFulfilledResult<TaskAttachment> => r.status === 'fulfilled')
        .map((r) => ({ ...r.value, createdAt: new Date(r.value.createdAt) }));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (succeeded.length > 0) {
        setLocalAttachments((prev) => [...prev, ...succeeded]);
        updateTask(liveTask.id, { attachments: [...localAttachments, ...succeeded] });
      }
      if (failed > 0) toast.warning(`${failed} file(s) failed to upload`);
      else if (succeeded.length > 0) toast.success(`${succeeded.length} file(s) uploaded`);
    } catch {
      toast.error('Upload failed');
    } finally {
      setUploadingFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    setDeletingIds((prev) => new Set(prev).add(attachmentId));
    try {
      await deleteTaskAttachment(liveTask.id, attachmentId);
      setLocalAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
      updateTask(liveTask.id, { attachments: localAttachments.filter((a) => a.id !== attachmentId) });
    } catch {
      toast.error('Failed to delete attachment');
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(attachmentId); return s; });
    }
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return Image;
    if (mimeType === 'application/pdf' || mimeType.includes('text')) return FileText;
    return File;
  };

  const formatBytes = (bytes?: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const handleStatusChange = async (newStatus: TaskStatus) => {
    try {
      await updateTaskApi(liveTask.id, { status: newStatus });
      updateTask(liveTask.id, { status: newStatus, ...(newStatus === 'done' ? { completedAt: new Date() } : {}) });
    } catch {
      toast.error('Failed to update task status');
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim() || commentSubmitting) return;
    setCommentSubmitting(true);
    try {
      const created = await addTaskCommentApi(liveTask.id, newComment.trim());
      const comment: TaskComment = {
        id: created.id,
        taskId: created.taskId,
        userId: created.userId,
        userName: created.userName,
        content: created.content,
        createdAt: new Date(created.createdAt),
      };
      updateTask(liveTask.id, {
        comments: [...comments, comment],
      });
      setNewComment('');
    } catch {
      toast.error('Failed to add comment');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const getLinkedItemName = () => {
    if (!liveTask.linkType || !liveTask.linkId) return null;

    switch (liveTask.linkType) {
      case 'lead': {
        if (liveTask.linkedLead) return { name: liveTask.linkedLead.clientName, type: 'Lead' };
        const lead = leads.find(l => l.id === liveTask.linkId);
        if (lead) {
          const client = clients.find(c => c.id === lead.clientId);
          return { name: client?.name, type: 'Lead' };
        }
        break;
      }
      case 'client': {
        if (liveTask.linkedClient) return { name: liveTask.linkedClient.name, type: 'Client' };
        const client = clients.find(c => c.id === liveTask.linkId);
        return { name: client?.name, type: 'Client' };
      }
      case 'meeting': {
        const meeting = meetings.find(m => m.id === liveTask.linkId);
        return { name: meeting?.title, type: 'Meeting' };
      }
      case 'follow_up': {
        const followUp = followUps.find(f => f.id === liveTask.linkId);
        if (followUp) {
          const fclient = clients.find(c => c.id === followUp.clientId);
          return { name: fclient?.name, type: 'Follow-up' };
        }
        break;
      }
    }
    return null;
  };

  const linkedItem = getLinkedItemName();

  const temperatureConfig: Record<string, { color: string; icon: typeof Flame; label: string }> = {
    cold: { color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300 border-sky-200 dark:border-sky-800', icon: Snowflake, label: 'Cold' },
    warm: { color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 border-amber-200 dark:border-amber-800', icon: Sun, label: 'Warm' },
    hot: { color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 border-rose-200 dark:border-rose-800', icon: Flame, label: 'Hot' },
  };

  const stageLabels: Record<string, string> = {
    new: 'New',
    contacted: 'Contacted',
    meeting_scheduled: 'Meeting Scheduled',
    proposal_sent: 'Proposal Sent',
    negotiation: 'Negotiation',
    closed_won: 'Closed Won',
    closed_won_pending: 'Closed Won Pending',
    closed_lost: 'Closed Lost',
  };

  const clientStatusConfig: Record<string, string> = {
    active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
    contacted: 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300',
    lost: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    ex: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    unsubscribed: 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300',
    permanently_closed: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{liveTask.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Status and Priority */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Status
              </label>
              {canEdit ? (
                <Select value={liveTask.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-full">
                    <div className="flex items-center gap-2">
                      <StatusIcon className="h-4 w-4" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to_do">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        To Do
                      </div>
                    </SelectItem>
                    <SelectItem value="in_progress">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        In Progress
                      </div>
                    </SelectItem>
                    <SelectItem value="done">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Done
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <div className="flex items-center gap-2 p-2 border rounded-md">
                  <StatusIcon className="h-4 w-4" />
                  <span className="capitalize">{liveTask.status.replace('_', ' ')}</span>
                </div>
              )}
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Priority
              </label>
              <Badge className={`${priorityColors[liveTask.priority]} text-sm px-3 py-1`} variant="secondary">
                {liveTask.priority.toUpperCase()}
              </Badge>
            </div>
          </div>

          {/* Description */}
          {liveTask.description && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                Description
              </label>
              <div className="rounded-md border bg-muted/30 px-4 py-3 max-h-48 overflow-y-auto">
                <p className="text-sm whitespace-pre-wrap break-all leading-relaxed">{liveTask.description}</p>
              </div>
            </div>
          )}

          {/* Task Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <User className="h-4 w-4" />
                Assigned To
              </label>
              <p className="text-sm font-medium">{liveTask.ownerName}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <User className="h-4 w-4" />
                Assigned By
              </label>
              <p className="text-sm font-medium">{liveTask.assignedByName}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Due Date
              </label>
              <p className="text-sm font-medium">
                {format(new Date(liveTask.dueDate), 'MMM d, yyyy h:mm a')}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Created
              </label>
              <p className="text-sm">{format(new Date(liveTask.createdAt), 'MMM d, yyyy h:mm a')}</p>
            </div>
          </div>

          {/* Linked Client Details */}
          {liveTask.linkType === 'client' && liveTask.linkedClient && (
            <div className="rounded-xl border border-blue-200/80 dark:border-blue-800/60 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/50 dark:from-blue-950/30 dark:via-background dark:to-indigo-950/20 overflow-hidden">
              <div className="px-4 py-2.5 bg-blue-100/60 dark:bg-blue-900/30 border-b border-blue-200/60 dark:border-blue-800/40 flex items-center gap-2">
                <div className="h-6 w-6 rounded-md bg-blue-500 dark:bg-blue-600 flex items-center justify-center">
                  <Building2 className="h-3.5 w-3.5 text-white" />
                </div>
                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wider">Linked Client</span>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center">
                      <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {liveTask.linkedClient.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-semibold text-sm leading-tight">{liveTask.linkedClient.name}</p>
                      {liveTask.linkedClient.industry && (
                        <p className="text-xs text-muted-foreground mt-0.5">{liveTask.linkedClient.industry}</p>
                      )}
                    </div>
                  </div>
                  <Badge className={`${clientStatusConfig[liveTask.linkedClient.status] || 'bg-gray-100 text-gray-600'} text-[10px] font-semibold px-2 py-0.5 capitalize border-0`}>
                    {liveTask.linkedClient.status.replace(/_/g, ' ')}
                  </Badge>
                </div>
                {liveTask.linkedClient.location && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 pl-0.5">
                    <MapPin className="h-3 w-3 text-blue-500 dark:text-blue-400 shrink-0" />
                    <span>{liveTask.linkedClient.location}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Linked Lead Details */}
          {liveTask.linkType === 'lead' && liveTask.linkedLead && (() => {
            const tempConf = temperatureConfig[liveTask.linkedLead.temperature] || temperatureConfig.warm;
            const TempIcon = tempConf.icon;
            return (
              <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-gradient-to-br from-emerald-50/80 via-white to-teal-50/50 dark:from-emerald-950/30 dark:via-background dark:to-teal-950/20 overflow-hidden">
                <div className="px-4 py-2.5 bg-emerald-100/60 dark:bg-emerald-900/30 border-b border-emerald-200/60 dark:border-emerald-800/40 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-md bg-emerald-500 dark:bg-emerald-600 flex items-center justify-center">
                      <Target className="h-3.5 w-3.5 text-white" />
                    </div>
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider">Linked Lead</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge className={`${tempConf.color} text-[10px] font-semibold px-2 py-0.5 border gap-1`}>
                      <TempIcon className="h-3 w-3" />
                      {tempConf.label}
                    </Badge>
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-9 w-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                        <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                          {liveTask.linkedLead.clientName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-semibold text-sm leading-tight">{liveTask.linkedLead.clientName}</p>
                        {liveTask.linkedLead.clientIndustry && (
                          <p className="text-xs text-muted-foreground mt-0.5">{liveTask.linkedLead.clientIndustry}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] font-semibold px-2 py-0.5 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300">
                      <TrendingUp className="h-3 w-3 mr-1" />
                      {stageLabels[liveTask.linkedLead.stage] || liveTask.linkedLead.stage.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {liveTask.linkedLead.clientLocation && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-0.5">
                        <MapPin className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                        <span>{liveTask.linkedLead.clientLocation}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground pl-0.5">
                      <User className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                      <span>{liveTask.linkedLead.ownerName}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Fallback for meeting/follow-up links */}
          {linkedItem && liveTask.linkType !== 'client' && liveTask.linkType !== 'lead' && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-2 block">
                {linkedItem.type}
              </label>
              <span className="text-sm font-medium">{linkedItem.name}</span>
            </div>
          )}

          <Separator />

          {/* Attachments Section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Attachments ({localAttachments.length})
              </label>
              {canEdit && (
                <label className="cursor-pointer">
                  <div className={`inline-flex items-center justify-center rounded-md border border-input bg-background px-3 h-8 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors ${uploadingFiles.length > 0 ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploadingFiles.length > 0 ? 'Uploading...' : 'Add File'}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => handleUploadAttachments(e.target.files)}
                  />
                </label>
              )}
            </div>

            {localAttachments.length > 0 && (
              <CrmAttachmentList
                items={localAttachments.map((att) => ({
                  id: att.id,
                  name: att.filename,
                  mimeType: att.mimeType,
                  size: att.size ?? null,
                }))}
                fetchBlob={(item) => fetchTaskAttachmentBlob(liveTask.id, item.id)}
                onDownload={async (item) => {
                  const blob = await fetchTaskAttachmentBlob(liveTask.id, item.id);
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = item.name;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                extraActions={
                  canEdit
                    ? (item) => (
                        <button
                          type="button"
                          disabled={deletingIds.has(item.id)}
                          onClick={() => handleDeleteAttachment(item.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )
                    : undefined
                }
              />
            )}

            {uploadingFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadingFiles.map((name) => (
                  <div key={name} className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground animate-pulse">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="truncate">{name}</span>
                    <span className="ml-auto text-xs">Uploading...</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Comments Section */}
          <div>
            <label className="text-sm font-medium text-muted-foreground mb-4 flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Comments ({comments.length})
            </label>

            <div className="space-y-3 mb-4">
              {comments.map((comment) => (
                <Card key={comment.id}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between mb-2">
                      <span className="font-medium text-sm">{comment.userName}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{comment.content}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add Comment */}
            <div className="space-y-2">
              <Textarea
                placeholder="Add a comment..."
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                rows={3}
              />
              <Button onClick={handleAddComment} disabled={!newComment.trim() || commentSubmitting}>
                {commentSubmitting ? 'Adding...' : 'Add Comment'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
