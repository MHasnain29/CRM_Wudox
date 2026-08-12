import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Paperclip, Download, Loader2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { format } from 'date-fns';
import { LeadRequest } from '@/lib/types';
import { fetchLeadRequests, fetchDocuments, downloadDocument, fetchDocumentBlob, ApiDocument } from '@/lib/api';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { inferMimeFromFilename } from '@/lib/fileAttachmentUtils';
import { ApprovalQueueActions } from '@/components/ApprovalQueueActions';
import { toast } from 'sonner';
import { canAccessMultipleAgencies } from '@/lib/access';

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

interface PendingLeadsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PendingLeadsDialog({ open, onOpenChange }: PendingLeadsDialogProps) {
  const { leadRequests, setLeadRequests, currentSubCompany } = useStore();
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [attachments, setAttachments] = useState<ApiDocument[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  const pendingRequests = leadRequests.filter(
    req => req.status === 'pending' && req.subCompanyId === currentSubCompany?.id
  );

  const refetch = async () => {
    if (!currentSubCompany?.id) return;
    const subId = canAccessMultipleAgencies() ? currentSubCompany.id : undefined;
    const list = await fetchLeadRequests({ subCompanyId: subId });
    setLeadRequests(list.map(mapApiLeadRequestToLeadRequest));
  };

  useEffect(() => {
    if (open && currentSubCompany?.id) refetch();
  }, [open, currentSubCompany?.id]);

  useEffect(() => {
    if (!selectedRequest) { setAttachments([]); return; }
    const req = pendingRequests.find(r => r.id === selectedRequest);
    if (!req) return;
    setAttachmentsLoading(true);
    fetchDocuments({ clientId: req.clientId })
      .then(docs => setAttachments(docs.filter(d => d.type === 'lead_request_attachment')))
      .catch(() => setAttachments([]))
      .finally(() => setAttachmentsLoading(false));
  }, [selectedRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const finishReview = () => {
    setSelectedRequest(null);
    setComments('');
    void refetch();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pending Lead Requests</DialogTitle>
          <DialogDescription>
            Review and approve or reject lead requests from your team
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No pending lead requests
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Requested At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRequests.map(request => (
                  <TableRow key={request.id}>
                    <TableCell className="font-medium">
                      {request.clientName}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {request.primaryContactName}
                    </TableCell>
                    <TableCell>{request.requestedByName}</TableCell>
                    <TableCell className="max-w-xs">
                      <p className="text-sm truncate" title={request.note}>
                        {request.note}
                      </p>
                    </TableCell>
                    <TableCell>
                      {format(new Date(request.requestedAt), 'MMM d, h:mm a')}
                    </TableCell>
                    <TableCell className="text-right">
                      {selectedRequest === request.id ? (
                        <div className="space-y-2">
                          <div className="text-left mb-2">
                            <p className="text-sm font-medium mb-1">Original Request:</p>
                            <p className="text-sm text-muted-foreground mb-3">{request.note}</p>
                          </div>
                          {/* Attachments */}
                          <div className="text-left mb-3">
                            <div className="flex items-center gap-1.5 mb-2">
                              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                              <p className="text-sm font-medium">
                                Attachments
                                {attachments.length > 0 && (
                                  <span className="ml-1.5 text-xs text-muted-foreground font-normal">({attachments.length})</span>
                                )}
                              </p>
                            </div>
                            {attachmentsLoading ? (
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading...
                              </div>
                            ) : attachments.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">No attachments</p>
                            ) : (
                              <CrmAttachmentList
                                items={attachments.map((doc) => ({
                                  id: doc.id,
                                  name: doc.name,
                                  mimeType: inferMimeFromFilename(doc.name),
                                  size: null,
                                }))}
                                fetchBlob={(item) => fetchDocumentBlob(item.id)}
                                onDownload={(item) => downloadDocument(item.id, item.name)}
                              />
                            )}
                          </div>
                          <Textarea
                            placeholder="Add comments (optional for approval, required for rejection)"
                            value={comments}
                            onChange={(e) => setComments(e.target.value)}
                            className="mb-2"
                          />
                          <ApprovalQueueActions
                            workflow="lead_request"
                            entityId={request.id}
                            subCompanyId={request.subCompanyId}
                            remarks={comments}
                            requireRemarksForReject
                            forwardLabel="Forward lead"
                            onActionComplete={finishReview}
                          />
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedRequest(null);
                                setComments('');
                                setAttachments([]);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedRequest(request.id)}
                        >
                          Review
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
