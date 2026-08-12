import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, Upload, X, Eye, FileText, Loader2 } from 'lucide-react';
import { format, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { createCampaign, fetchMailingLists, fetchEmailTemplates } from '@/lib/api';
import { useStore } from '@/lib/store';
import { fillPlaceholders } from '@/lib/emailStarterTemplates';

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultListId?: string;
  subCompanyId?: string;
}

export function CreateCampaignDialog({ open, onOpenChange, onSuccess, defaultListId, subCompanyId }: CreateCampaignDialogProps) {
  const { toast } = useToast();
  const agencyFooterText = useStore((s) => {
    const sub = s.currentSubCompany;
    return [sub?.emailFooterText?.trim(), sub?.emailTagline?.trim()].filter(Boolean).join(' · ') || null;
  });
  const { data: allMailingLists = [] } = useQuery({
    queryKey: ['mailing-lists', subCompanyId ?? 'default'],
    queryFn: () => fetchMailingLists(subCompanyId ? { subCompanyId } : undefined),
  });
  // Archived lists are not valid campaign targets.
  const mailingLists = allMailingLists.filter((l) => !l.isArchived);
  const { data: emailTemplates = [], isLoading: loadingTemplates } = useQuery({
    queryKey: ['email-templates', subCompanyId ?? 'default'],
    queryFn: () => fetchEmailTemplates(subCompanyId ? { subCompanyId } : undefined),
  });
  const [campaignName, setCampaignName] = useState('');
  const [selectedList, setSelectedList] = useState(defaultListId ?? '');
  const [subject, setSubject] = useState('');
  const [scheduledDate, setScheduledDate] = useState<Date>();
  const [scheduledTime, setScheduledTime] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    const validFiles = files.filter(file => {
      if (file.size > 20 * 1024 * 1024) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 20MB limit`,
          variant: 'destructive',
        });
        return false;
      }
      return true;
    });
    setSelectedFiles([...selectedFiles, ...validFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const handleTemplateSelect = (templateId: string) => {
    const template = emailTemplates.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setSubject(template.subject);
      toast({
        title: 'Template applied',
        description: `${template.name} template has been loaded`,
      });
    }
  };

  const getTemplateBody = (templateId: string) => {
    const t = emailTemplates.find(t => t.id === templateId);
    if (!t) return '';
    const parts = [t.headerHtml, t.bodyHtml, t.footerHtml].filter(Boolean);
    return parts.join('\n');
  };

  const handlePreviewTemplate = (templateId: string) => {
    setPreviewTemplate(previewTemplate === templateId ? '' : templateId);
  };

  const handleCreateCampaign = async () => {
    if (!campaignName || !selectedList || !subject || !selectedTemplate) {
      toast({
        title: 'Missing information',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    const listDetails = mailingLists.find(l => l.id === selectedList);

    let scheduledIso: string | undefined;
    if (scheduledDate) {
      const scheduled = new Date(scheduledDate);
      if (scheduledTime) {
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        scheduled.setHours(hours, minutes, 0, 0);
      }
      scheduledIso = scheduled.toISOString();
    }

    setSubmitting(true);
    const result = await createCampaign({
      name: campaignName,
      listId: selectedList,
      listName: listDetails?.name ?? selectedList,
      subject,
      body: getTemplateBody(selectedTemplate),
      templateId: selectedTemplate || null,
      ...(scheduledIso ? { scheduledDate: scheduledIso } : {}),
      subCompanyId,
    });
    setSubmitting(false);

    if (!result) {
      toast({ title: 'Error', description: 'Failed to create campaign', variant: 'destructive' });
      return;
    }

    toast({ title: 'Campaign created', description: 'Your email campaign has been saved as a draft' });
    onSuccess?.();

    // Reset form
    setCampaignName('');
    setSelectedList(defaultListId ?? '');
    setSubject('');
    setScheduledDate(undefined);
    setScheduledTime('');
    setSelectedFiles([]);
    setSelectedTemplate('');
    setPreviewTemplate('');
    onOpenChange(false);
  };

  const selectedListDetails = mailingLists.find(l => l.id === selectedList);
  const selectedTemplateDetails = emailTemplates.find(t => t.id === selectedTemplate);

  // Sync defaultListId when dialog opens (in case it changes between opens)
  // This is intentionally NOT in a useEffect to avoid re-render loops; the parent controls open/close.

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Email Campaign</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Campaign Details */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="campaignName">Campaign Name *</Label>
              <Input
                id="campaignName"
                placeholder="e.g., Q1 Product Launch"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="list">Select List *</Label>
              <Select value={selectedList} onValueChange={setSelectedList}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a list" />
                </SelectTrigger>
                <SelectContent>
                  {mailingLists.length === 0 ? (
                    <SelectItem value="__none__" disabled>No lists yet — create one in Mailing Lists</SelectItem>
                  ) : (
                    mailingLists.map((list) => (
                      <SelectItem key={list.id} value={list.id}>
                        {list.name} ({list.memberCount} members)
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {selectedListDetails && (
                <p className="text-sm text-muted-foreground mt-1">
                  This campaign will be sent to {selectedListDetails.memberCount} members
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="subject">Email Subject *</Label>
              <Input
                id="subject"
                placeholder="Enter email subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
          </div>

          {/* Email Templates */}
          <div className="space-y-3">
            <Label>Select Email Template *</Label>
            {loadingTemplates ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : emailTemplates.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No email templates yet. Create one in{' '}
                <strong>Settings → Email Templates</strong> first.
              </div>
            ) : (
              <div className="grid gap-3">
                {emailTemplates.map((template) => (
                  <Card
                    key={template.id}
                    className={cn(
                      "p-4 cursor-pointer transition-all border-2",
                      selectedTemplate === template.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => handleTemplateSelect(template.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-medium">{template.name}</h4>
                          {selectedTemplate === template.id && (
                            <Badge variant="default" className="text-xs">Selected</Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Subject: {template.subject}
                        </p>
                        {previewTemplate === template.id && (
                          <div
                            className="mt-3 p-3 rounded-md bg-background border text-sm"
                            dangerouslySetInnerHTML={{ __html: fillPlaceholders(template.bodyHtml, agencyFooterText) }}
                          />
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreviewTemplate(template.id);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Attachments */}
          <div>
            <Label>Attachments</Label>
            <div className="mt-2">
              <label htmlFor="file-upload">
                <div className="border-2 border-dashed border-input rounded-lg p-6 text-center cursor-pointer hover:border-primary transition-colors">
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload or drag and drop files
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Maximum file size: 20MB
                  </p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  multiple
                  onChange={handleFileSelect}
                />
              </label>

              {selectedFiles.length > 0 && (
                <div className="mt-4 space-y-2">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{file.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Schedule Section */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-lg font-semibold">Schedule Campaign</h3>
            
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Schedule Date <span className="text-muted-foreground text-xs">(optional — leave blank to save as draft)</span></Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !scheduledDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduledDate ? format(scheduledDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={scheduledDate}
                      onSelect={setScheduledDate}
                      initialFocus
                      disabled={(date) => startOfDay(date) < startOfDay(new Date())}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div>
                <Label htmlFor="time">Schedule Time</Label>
                <Input
                  id="time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>

            {/* Campaign Summary */}
            {selectedListDetails && selectedTemplateDetails && scheduledDate && scheduledTime && (
              <div className="p-4 bg-muted rounded-lg">
                <h4 className="font-medium mb-3">Campaign Summary</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Campaign:</span>
                    <span className="font-medium">{campaignName || 'Not set'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipients:</span>
                    <span className="font-medium">
                      {selectedListDetails.memberCount} members ({selectedListDetails.name})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Template:</span>
                    <span className="font-medium">{selectedTemplateDetails.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subject:</span>
                    <span className="font-medium">{subject}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Scheduled:</span>
                    <span className="font-medium">
                      {format(scheduledDate, "MMM dd, yyyy")} at {scheduledTime}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Attachments:</span>
                    <span className="font-medium">{selectedFiles.length}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateCampaign} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
