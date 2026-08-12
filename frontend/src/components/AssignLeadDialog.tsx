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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, File, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { createLead, mapApiLeadToLead, reassignLostLead } from '@/lib/api';
import { Client } from '@/lib/types';
import { fetchUsers } from '@/lib/api';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAssignableRoles } from '@/hooks/useAssignableRoles';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';
import { isOwnScopeRoleKey } from '@/lib/roleLabels';

const formSchema = z.object({
  salesAssociateId: z.string().min(1, 'Please select a sales associate'),
  contactId: z.string().optional(),
  source: z.string().min(1, 'Please select a source'),
  note: z.string().min(10, 'Note must be at least 10 characters'),
});

type FormData = z.infer<typeof formSchema>;

interface AssignLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Client | null;
  subCompanyId?: string;
  mode?: 'assign' | 'reassign';
  sourceLeadId?: string;
  onSuccess?: () => void;
}

type AssociateOption = { id: string; name: string; email: string };

export function AssignLeadDialog({
  open,
  onOpenChange,
  client,
  subCompanyId,
  mode = 'assign',
  sourceLeadId,
  onSuccess,
}: AssignLeadDialogProps) {
  const { currentUser, currentSubCompany, setLeads } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [openCombobox, setOpenCombobox] = useState(false);
  const [salesAssociates, setSalesAssociates] = useState<AssociateOption[]>([]);
  const [associatesLoading, setAssociatesLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Under act-as → linked user's agency; else prop / login agency.
  const effectiveAgencyId = useWriteAgencyId(subCompanyId);
  const { assignableRoles } = useAssignableRoles();

  const loadSalesAssociates = useCallback(async () => {
    if (!effectiveAgencyId) return;
    setAssociatesLoading(true);
    try {
      const users = await fetchUsers({ subCompanyId: effectiveAgencyId });
      const list: AssociateOption[] = users
        .filter((u) => isOwnScopeRoleKey(u.role, assignableRoles) && u.isActive)
        .map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email ?? '',
        }));
      setSalesAssociates(list);
    } catch {
      toast.error('Failed to load sales associates');
      setSalesAssociates([]);
    } finally {
      setAssociatesLoading(false);
    }
  }, [effectiveAgencyId, assignableRoles]);

  useEffect(() => {
    if (open && effectiveAgencyId) {
      loadSalesAssociates();
    }
  }, [open, effectiveAgencyId, loadSalesAssociates]);

  const primaryContact = client?.contacts.find(c => c.isPrimary);
  const defaultNote = client
    ? mode === 'reassign'
      ? `Reassigning lost lead for ${client.name}`
      : `Assigning ${client.name} client`
    : '';

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      salesAssociateId: '',
      contactId: primaryContact?.id || client?.contacts[0]?.id || '',
      source: mode === 'reassign' ? 'other' : '',
      note: defaultNote,
    },
  });

  // Update default values when client changes
  useEffect(() => {
    if (client && open) {
      const defaultContact = client.contacts.find(c => c.isPrimary) || client.contacts[0];
      form.reset({
        salesAssociateId: '',
        contactId: defaultContact?.id || '',
        source: mode === 'reassign' ? 'other' : '',
        note: mode === 'reassign'
          ? `Reassigning lost lead for ${client.name}`
          : `Assigning ${client.name} client`,
      });
      setUploadedFiles([]);
    }
  }, [client, mode, open]);

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
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
    toast.success('File removed');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const onSubmit = async (data: FormData) => {
    if (!client) return;
    if (mode === 'reassign' && !sourceLeadId) {
      toast.error('Lost lead could not be found for reassignment');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = mode === 'reassign'
        ? await reassignLostLead({
            leadId: sourceLeadId!,
            ownerId: data.salesAssociateId,
            note: data.note,
            subCompanyId: effectiveAgencyId,
          })
        : await createLead({
            clientId: client.id,
            ownerId: data.salesAssociateId,
            note: data.note,
            subCompanyId: effectiveAgencyId,
          });
      const newLead = mapApiLeadToLead(created, currentSubCompany?.name ?? '');
      setLeads([...useStore.getState().leads, newLead]);
      toast.success(mode === 'reassign' ? 'Lost lead reassigned successfully' : 'Lead assigned successfully');
      onOpenChange(false);
      form.reset();
      setUploadedFiles([]);
      onSuccess?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : mode === 'reassign' ? 'Failed to reassign lost lead' : 'Failed to assign lead');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!client) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] flex flex-col max-h-[90vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle>{mode === 'reassign' ? 'Reassign Lost Lead' : 'Assign Lead'}</DialogTitle>
          <DialogDescription>
            {mode === 'reassign'
              ? 'Create a fresh open lead for another sales associate while preserving the previous lost record'
              : 'Assign this client to a sales associate'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1 min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6">
              <div className="space-y-4 pb-4 pr-4">
            {/* Current User (disabled) */}
            <FormItem>
              <FormLabel>{mode === 'reassign' ? 'Reassigned By' : 'Assigned By'}</FormLabel>
              <Input value={currentUser.name} disabled />
            </FormItem>

            {/* Sales Associate Select (Searchable) — loads agency associates when dialog opens */}
            <FormField
              control={form.control}
              name="salesAssociateId"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>{mode === 'reassign' ? 'Select New Owner *' : 'Select Sales Associate *'}</FormLabel>
                  <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          disabled={associatesLoading}
                          className={cn(
                            "justify-between",
                            !field.value && "text-muted-foreground"
                          )}
                        >
                          {associatesLoading ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Loading...
                            </>
                          ) : field.value ? (
                            salesAssociates.find((a) => a.id === field.value)?.name ?? 'Unknown'
                          ) : (
                            "Select sales associate"
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0 bg-popover" align="start">
                      <Command shouldFilter={true}>
                        <CommandInput placeholder="Search by name or email..." />
                        <CommandList className="max-h-[280px]">
                          <CommandEmpty>No sales associate found.</CommandEmpty>
                          <CommandGroup>
                            {salesAssociates.map((associate) => (
                                <CommandItem
                                  key={associate.id}
                                  value={`${associate.name} ${associate.email}`.trim()}
                                  onSelect={() => {
                                    form.setValue("salesAssociateId", associate.id);
                                    setOpenCombobox(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-4 w-4 shrink-0",
                                      associate.id === field.value ? "opacity-100" : "opacity-0"
                                    )}
                                  />
                                  <span className="truncate">{associate.name}</span>
                                  <span className="ml-2 text-xs text-muted-foreground truncate">
                                    {associate.email}
                                  </span>
                                </CommandItem>
                              ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
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
                      placeholder={mode === 'reassign' ? 'Enter reassignment note...' : 'Enter assignment note...'}
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
              </div>
            </div>

            <DialogFooter className="px-6 py-4 border-t shrink-0">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (mode === 'reassign' ? 'Reassigning...' : 'Assigning...') : (mode === 'reassign' ? 'Reassign Lead' : 'Assign Lead')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
