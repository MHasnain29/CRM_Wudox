import { format } from 'date-fns';
import { Building2, MapPin, Mail, Phone, Calendar, User, CheckCircle, Clock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { FollowUp } from '@/lib/types';
import { useStore } from '@/lib/store';

interface FollowUpDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  followUp: FollowUp | null;
}

export function FollowUpDetailDialog({
  open,
  onOpenChange,
  followUp,
}: FollowUpDetailDialogProps) {
  const { clients } = useStore();

  if (!followUp) return null;

  const client = clients.find(c => c.id === followUp.clientId);
  const contact = client?.contacts.find(c => c.id === followUp.contactId);
  const clientDisplayName = client?.name ?? followUp.clientName ?? 'Unknown client';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Follow-Up Details</DialogTitle>
          <DialogDescription>
            Complete history and information for this follow-up
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Client Info */}
          {(client || followUp.clientName) && (
            <Card>
              <CardContent className="p-4">
                <div className="space-y-3">
                  <div className="font-semibold text-lg">{clientDisplayName}</div>
                  {client && (
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        <span>{client.industry}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        <span>{client.location}</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Contact Person */}
          {contact && (
            <Card>
              <CardContent className="p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-sm">Contact Person</div>
                    {contact.isPrimary && <Badge variant="secondary" className="text-xs">Primary</Badge>}
                  </div>
                  <div className="text-sm">{contact.name}</div>
                  {contact.email && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <span>{contact.email}</span>
                    </div>
                  )}
                  {(contact.phone || contact.phoneExtension) && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span>
                        {contact.phone}
                        {contact.phoneExtension?.trim() && (
                          <span className="ml-1">ext. {contact.phoneExtension.trim()}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Follow-up Info */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>Due: {format(new Date(followUp.dueDate), 'MMM d, yyyy h:mm a')}</span>
              </div>
              {followUp.completed && (
                <Badge variant="default" className="gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Completed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>Owner: {followUp.ownerName}</span>
            </div>
          </div>

          {/* Notes */}
          {followUp.notes && (
            <div className="space-y-2">
              <div className="text-sm font-medium">Initial Notes</div>
              <Card>
                <CardContent className="p-3">
                  <p className="text-sm text-muted-foreground">{followUp.notes}</p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Comment History */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Activity History ({followUp.comments.length})</div>
            <ScrollArea className="h-[300px] rounded-md border">
              <div className="p-3 space-y-3">
                {followUp.comments.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No activity yet
                  </div>
                ) : (
                  followUp.comments
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((comment) => (
                      <Card key={comment.id}>
                        <CardContent className="p-3">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-sm font-medium">{comment.userName}</span>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">{comment.content}</p>
                        </CardContent>
                      </Card>
                    ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
