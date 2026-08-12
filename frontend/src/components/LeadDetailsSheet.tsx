import { useState } from 'react';
import { format } from 'date-fns';
import { Building2, Phone as PhoneIcon, Mail, CalendarClock, Plus, Phone, User, MapPin, MessageSquare, PhoneCall, Calendar, CheckCircle, ArrowRight, FileText, Users, Tag, Send } from 'lucide-react';
import { Lead, Client } from '@/lib/types';
import { FollowUpDialog } from './FollowUpDialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StageBadge } from '@/components/StageBadge';
import { TemperatureBadge } from '@/components/TemperatureBadge';
import { activityLogs } from '@/lib/activityData';
import { ActivityType } from '@/lib/types';
import { useStore } from '@/lib/store';
import { useCanViewTeamScope } from '@/lib/access';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import { isOwnScopeRoleKey } from '@/lib/roleLabels';

interface LeadDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  client: Client | null;
}

export function LeadDetailsSheet({ open, onOpenChange, lead, client }: LeadDetailsSheetProps) {
  const [isFollowUpDialogOpen, setIsFollowUpDialogOpen] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isNotePublic, setIsNotePublic] = useState(true);
  const { addClientNote, currentUser, users } = useStore();
  const isManager = useCanViewTeamScope();
  const { assignableRoles } = useAssignableRoles();

  if (!lead || !client) return null;

  const leadActivities = activityLogs
    .filter(activity => activity.metadata?.leadId === lead.id)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const getActivityIcon = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return <PhoneCall className="h-4 w-4" />;
      case 'meeting_scheduled':
        return <Calendar className="h-4 w-4" />;
      case 'task_created':
      case 'task_completed':
      case 'task_status_changed':
        return <CheckCircle className="h-4 w-4" />;
      case 'pipeline_moved':
        return <ArrowRight className="h-4 w-4" />;
      case 'follow_up_created':
        return <CalendarClock className="h-4 w-4" />;
      case 'comment_added':
        return <MessageSquare className="h-4 w-4" />;
      case 'email_sent':
        return <Mail className="h-4 w-4" />;
      default:
        return <FileText className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: ActivityType) => {
    switch (type) {
      case 'call_made':
        return 'text-blue-500';
      case 'meeting_scheduled':
        return 'text-purple-500';
      case 'task_completed':
        return 'text-green-500';
      case 'task_created':
      case 'task_status_changed':
        return 'text-orange-500';
      case 'pipeline_moved':
        return 'text-indigo-500';
      case 'follow_up_created':
        return 'text-yellow-500';
      case 'email_sent':
        return 'text-pink-500';
      default:
        return 'text-muted-foreground';
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-2xl">{client.name}</SheetTitle>
          <SheetDescription>
            Lead details and management
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Task
            </Button>
            <Button size="sm" variant="outline">
              <Phone className="h-4 w-4 mr-1" />
              Call
            </Button>
            <Button size="sm" variant="outline" onClick={() => setIsFollowUpDialogOpen(true)}>
              <CalendarClock className="h-4 w-4 mr-1" />
              Follow-Up
            </Button>
          </div>

          <FollowUpDialog
            open={isFollowUpDialogOpen}
            onOpenChange={setIsFollowUpDialogOpen}
            clientId={client.id}
            clientName={client.name}
            leadId={lead.id}
            subCompanyId={lead.subCompanyId}
            client={client}
          />

          <Tabs defaultValue="details" className="w-full">
            <TabsList className="w-full grid grid-cols-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="contacts">Contacts</TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
            </TabsList>

            {/* Details Tab */}
            <TabsContent value="details" className="space-y-6 mt-4">
              {/* Lead Status */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Temperature</p>
                  <TemperatureBadge temperature={lead.temperature} />
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Stage</p>
                  <StageBadge stage={lead.stage} />
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-2">Owner</p>
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{lead.ownerName}</p>
                      <p className="text-xs text-muted-foreground">{lead.subCompanyName}</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Industry</p>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm">{client.industry}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Company Size</p>
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm">{client.companySize}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Location</p>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <p className="text-sm">{client.location}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Full Address</p>
                  <p className="text-sm">{client.address}</p>
                </div>

                {client.tags.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {client.tags.map((tag, index) => (
                        <Badge key={index} variant="secondary" className="gap-1">
                          <Tag className="h-3 w-3" />
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Last Activity</p>
                    <p className="text-sm">
                      {lead.lastActivity 
                        ? format(new Date(lead.lastActivity), 'MMM d, yyyy')
                        : 'Never'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Next Follow-Up</p>
                    <p className="text-sm">
                      {lead.nextFollowUp 
                        ? format(new Date(lead.nextFollowUp), 'MMM d, h:mm a')
                        : '-'}
                    </p>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Contacts Tab */}
            <TabsContent value="contacts" className="space-y-4 mt-4">
              {client.contacts.map((contact) => (
                <Card key={contact.id} className="border-none shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-sm text-muted-foreground">{contact.title}</p>
                      </div>
                      {contact.isPrimary && (
                        <Badge variant="secondary" className="text-xs">Primary</Badge>
                      )}
                    </div>
                    <div className="space-y-2 mt-3">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <a href={`mailto:${contact.email}`} className="text-primary hover:underline">
                          {contact.email}
                        </a>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <PhoneIcon className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <a href={`tel:${contact.phone}`} className="text-primary hover:underline">
                            {contact.phone}
                          </a>
                          {contact.phoneExtension?.trim() && (
                            <span className="text-muted-foreground ml-1">ext. {contact.phoneExtension.trim()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Notes Tab */}
            <TabsContent value="notes" className="space-y-4 mt-4">
              {/* Add Note Section */}
              <Card className="border-none shadow-sm">
                <CardContent className="p-4 space-y-3">
                  <Textarea
                    placeholder="Add a note..."
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="min-h-[100px]"
                  />
                  {isManager && (
                    <div className="flex items-center gap-2">
                      <Switch
                        id="lead-note-visibility"
                        checked={isNotePublic}
                        onCheckedChange={setIsNotePublic}
                      />
                      <Label htmlFor="lead-note-visibility" className="text-sm cursor-pointer">
                        {isNotePublic ? 'Public (visible to sales associates)' : 'Private (managers only)'}
                      </Label>
                    </div>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={() => {
                        if (newNote.trim()) {
                          addClientNote(client.id, newNote.trim(), isManager ? isNotePublic : false);
                          setNewNote('');
                        }
                      }}
                      disabled={!newNote.trim()}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Add Note
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Notes List */}
              <div className="space-y-3">
                {(() => {
                  // Filter notes based on role
                  const visibleNotes = client.notes.filter(note => {
                    // Managers see all notes
                    if (isManager) return true;
                    // Sales associates see their own notes and public manager notes
                    return note.userId === currentUser.id || note.isPublic;
                  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

                  return visibleNotes.length > 0 ? (
                    visibleNotes.map((note) => {
                      const noteUser = users.find(u => u.id === note.userId);
                      const isManagerNote = noteUser && !isOwnScopeRoleKey(noteUser.role, assignableRoles);
                      
                      return (
                        <Card key={note.id} className="border-none shadow-sm">
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                                <span className="text-sm font-semibold text-primary">
                                  {note.userName.charAt(0)}
                                </span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-medium text-sm">{note.userName}</span>
                                  {isManagerNote && !note.isPublic && (
                                    <Badge variant="secondary" className="text-xs">
                                      Private
                                    </Badge>
                                  )}
                                  {isManagerNote && note.isPublic && (
                                    <Badge variant="outline" className="text-xs">
                                      Public
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-sm text-foreground whitespace-pre-wrap break-words mb-2">
                                  {note.content}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {format(note.createdAt, 'MMM d, yyyy • h:mm a')}
                                </p>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-sm text-muted-foreground">No notes yet</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Add the first note to keep track of important information
                      </p>
                    </div>
                  );
                })()}
              </div>
            </TabsContent>

            {/* Activity Tab */}
            <TabsContent value="activity" className="space-y-4 mt-4">
              {leadActivities.length > 0 ? (
                <div className="space-y-4">
                  {leadActivities.map((activity, index) => (
                    <div key={activity.id} className="relative">
                      {index !== leadActivities.length - 1 && (
                        <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-border" />
                      )}
                      <div className="flex gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border bg-background ${getActivityColor(activity.type)}`}>
                          {getActivityIcon(activity.type)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <p className="text-sm font-medium">{activity.description}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>{activity.userName}</span>
                            <span>•</span>
                            <span>{format(activity.timestamp, 'MMM d, yyyy h:mm a')}</span>
                          </div>
                          {activity.metadata?.duration !== undefined && activity.metadata.duration > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {activity.metadata.duration} min
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No activity recorded yet
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
