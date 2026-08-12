import { useState, useEffect, useRef, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, File } from 'lucide-react';
import { useStore } from '@/lib/store';
import { Client } from '@/lib/types';
import { toast } from 'sonner';
import { createLeadRequest, fetchAgencyManagers, uploadDocument } from '@/lib/api';

const formSchema = z.object({
  managerId: z.string().min(1, 'Please select a manager'),
  contactId: z.string().optional(),
  source: z.string().min(1, 'Please select a source'),
  note: z.string().min(10, 'Note must be at least 10 characters'),
});

type FormData = z.infer<typeof formSchema>;

interface LeadRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  /** Called after a lead request is successfully created (receives the created request for store update). */
  onSuccess?: (createdRequest: Awaited<ReturnType<typeof createLeadRequest>>) => void;
}


export function LeadRequestDialog({ open, onOpenChange, client, onSuccess }: LeadRequestDialogProps) {
  const { currentUser, currentSubCompany } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managers, setManagers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);

  // Fetch all agency managers (uses GET /users/agency-managers so sales associates can load without users:read)
  const loadManagers = useCallback(async () => {
    setManagersLoading(true);
    try {
      const list = await fetchAgencyManagers();
      const mapped = list.map((u) => ({
        id: u.id,
        name: `${u.firstName} ${u.lastName}`.trim() || u.email || u.id,
        role: u.role,
      }));
      setManagers(mapped);
    } catch {
      toast.error('Failed to load managers');
      setManagers([]);
    } finally {
      setManagersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadManagers();
  }, [open, loadManagers]);

  const primaryContact = client?.contacts.find(c => c.isPrimary);
  const defaultNote = client ? `I would like to request ${client.name} client` : '';

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      managerId: managers[0]?.id || '',
      contactId: primaryContact?.id || client?.contacts[0]?.id || '',
      source: '',
      note: defaultNote,
    },
  });

  // Reset form and clear files only when dialog opens or client changes (not when managers load, so selected files stay visible)
  useEffect(() => {
    if (client && open) {
      const defaultContact = client.contacts.find(c => c.isPrimary) || client.contacts[0];
      const reportingManagerIds = (currentUser as { reportingManagerIds?: string[] }).reportingManagerIds ?? [];
      const defaultManagerId =
        (managers.length && reportingManagerIds.find((id) => managers.some((m) => m.id === id))) || managers[0]?.id || '';
      form.reset({
        managerId: defaultManagerId,
        contactId: defaultContact?.id || '',
        source: '',
        note: `I would like to request ${client.name} client`,
      });
      setUploadedFiles([]);
    }
  }, [client, open]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally omit managers so we don't clear files when managers load

  // When managers finish loading: default to reporting manager if set and in list, otherwise first manager
  useEffect(() => {
    if (!open || managers.length === 0) return;
    const currentManagerId = form.getValues('managerId');
    const reportingManagerIds = (currentUser as { reportingManagerIds?: string[] }).reportingManagerIds ?? [];
    const defaultId =
      reportingManagerIds.find((id) => managers.some((m) => m.id === id)) ?? managers[0]?.id ?? '';
    if (defaultId && (!currentManagerId || !managers.some((m) => m.id === currentManagerId))) {
      form.setValue('managerId', defaultId);
    }
  }, [open, managers, form, currentUser]);

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    
    const newFiles = Array.from(files);
    const maxSize = 20 * 1024 * 1024; // 20MB
    const maxFiles = 10;
    
    // Validate file size
    const oversizedFiles = newFiles.filter(f => f.size > maxSize);
    if (oversizedFiles.length > 0) {
      toast.error(`Files must be under 20MB: ${oversizedFiles.map(f => f.name).join(', ')}`);
      return;
    }
    
    // Validate total number of files
    if (uploadedFiles.length + newFiles.length > maxFiles) {
      toast.error(`Maximum ${maxFiles} files allowed`);
      return;
    }
    
    setUploadedFiles(prev => [...prev, ...newFiles]);
    toast.success(`${newFiles.length} file(s) added`);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
    toast.success('File removed');
  };

  // Clear file input value when files are cleared so the same file can be selected again
  useEffect(() => {
    if (uploadedFiles.length === 0 && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadedFiles.length]);

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const onSubmit = async (data: FormData) => {
    if (!client) return;

    setIsSubmitting(true);
    try {
      const created = await createLeadRequest({ clientId: client.id, managerId: data.managerId, note: data.note });

      // Upload attachments as client documents (so they're saved and visible to the manager)
      if (uploadedFiles.length > 0) {
        for (const file of uploadedFiles) {
          try {
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = reader.result as string;
                resolve(result.includes(',') ? result.split(',')[1] ?? '' : result);
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            });
            await uploadDocument({
              clientId: client.id,
              name: file.name,
              type: 'lead_request_attachment',
              fileBase64: base64,
              mimeType: file.type || undefined,
            });
          } catch (err) {
            console.error('Failed to upload attachment', file.name, err);
            toast.error(`Could not upload ${file.name}`);
          }
        }
      }

      onOpenChange(false);
      form.reset();
      setUploadedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess?.(created);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit lead request');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Request Lead</DialogTitle>
          <DialogDescription>
            Submit a request to work with this client
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Current User (disabled) */}
            <FormItem>
              <FormLabel>Requested By</FormLabel>
              <Input value={currentUser.name} disabled />
            </FormItem>

            {/* Manager Select */}
            <FormField
              control={form.control}
              name="managerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Manager *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger disabled={managersLoading}>
                        <SelectValue placeholder={managersLoading ? 'Loading managers...' : 'Select a manager'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {managers.length === 0 && !managersLoading ? (
                        <div className="py-2 px-2 text-sm text-muted-foreground">No managers in your agency</div>
                      ) : (
                        managers.map((manager) => (
                          <SelectItem key={manager.id} value={manager.id}>
                            {manager.name} – {manager.role.replace('_', ' ')}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Client Name (display only) */}
            <FormItem>
              <FormLabel>Client Name</FormLabel>
              <Input value={client.name} disabled />
            </FormItem>

            {/* Contact Selection */}
            {client.contacts.length > 1 ? (
              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Person</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a contact" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-popover">
                        {client.contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contact.name} - {contact.title}
                            {contact.isPrimary && <Badge variant="secondary" className="ml-2 text-[10px]">Primary</Badge>}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : client.contacts.length === 1 ? (
              <FormItem>
                <FormLabel>Contact Person</FormLabel>
                <Input 
                  value={`${client.contacts[0].name} - ${client.contacts[0].title}`} 
                  disabled 
                />
              </FormItem>
            ) : (
              <FormItem>
                <FormLabel>Contact Person</FormLabel>
                <Input value="No contact available" disabled />
              </FormItem>
            )}

            {/* Source */}
            <FormField
              control={form.control}
              name="source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select source" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="bg-popover">
                      <SelectItem value="website">Website</SelectItem>
                      <SelectItem value="phone">Phone</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="facebook">Facebook</SelectItem>
                      <SelectItem value="linkedin">LinkedIn</SelectItem>
                      <SelectItem value="instagram">Instagram</SelectItem>
                      <SelectItem value="google">Google</SelectItem>
                      <SelectItem value="referral">Referral</SelectItem>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="cold_outreach">Cold Outreach</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Note */}
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note *</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Enter your request note..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* File Upload */}
            <FormItem>
              <FormLabel>Attachments</FormLabel>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragging 
                    ? 'border-primary bg-primary/5' 
                    : 'border-border hover:border-primary/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                  accept="*/*"
                />
                <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop files here, or click to browse
                </p>
                <Button 
                  type="button" 
                  variant="outline" 
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Select Files
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Max 10 files, 20MB each
                </p>
              </div>

              {/* Uploaded Files List */}
              {uploadedFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  {uploadedFiles.map((file, index) => (
                    <Card key={index} className="border-none shadow-sm">
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <File className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  <div className="flex items-center justify-between pt-2">
                    <Badge variant="secondary">
                      {uploadedFiles.length} file(s) selected
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setUploadedFiles([]);
                        toast.success('All files removed');
                      }}
                    >
                      Clear all
                    </Button>
                  </div>
                </div>
              )}
            </FormItem>

            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
