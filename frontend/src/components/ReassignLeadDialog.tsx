import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRightLeft, ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
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
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { fetchUsers, createLeadReassignmentRequest, createSuperUserLeadReassignment } from '@/lib/api';
import { useStore } from '@/lib/store';
import type { Lead } from '@/lib/types';

import { useCanViewTeamScope, useHasPermission } from '@/lib/access';
import { useEffectiveUser } from '@/lib/effectiveUser';
import { useWriteAgencyId } from '@/hooks/useWriteAgencyId';

const ROLE_LABELS: Record<string, string> = {
  sales_associate: 'Sales Associate',
  sales_executive: 'Sales Executive',
  marketing: 'Marketing',
  recruiter: 'Recruiter',
  sr_recruiter: 'Sr. Recruiter',
  sales_manager: 'Sales Manager',
  recruitment_manager: 'Recruitment Manager',
};

const schema = z.object({
  proposedOwnerId: z.string().min(1, 'Please select a new associate'),
  numberOfEmployees: z.coerce.number({ invalid_type_error: 'Please enter number of employees' }).int().min(1, 'Must be at least 1'),
});
type FormData = z.infer<typeof schema>;

interface AssociateOption {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ReassignLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  onSuccess?: () => void;
}

export function ReassignLeadDialog({ open, onOpenChange, lead, onSuccess }: ReassignLeadDialogProps) {
  const { currentUser } = useStore();
  const { id: effectiveSelfId } = useEffectiveUser();
  const writeAgencyId = useWriteAgencyId(lead?.subCompanyId);
  const [associates, setAssociates] = useState<AssociateOption[]>([]);
  const [loadingAssociates, setLoadingAssociates] = useState(false);
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { proposedOwnerId: '', numberOfEmployees: '' as unknown as number },
  });

  const isSuperUser = useHasPermission('leads:reassign_approve');
  const isManager = useCanViewTeamScope();

  const loadAssociates = useCallback(async () => {
    const agencyId = writeAgencyId ?? lead?.subCompanyId ?? currentUser?.subCompanyId;
    if (!agencyId) return;
    setLoadingAssociates(true);
    try {
      const users = await fetchUsers({ subCompanyId: agencyId });
      const list: AssociateOption[] = users
        .filter((u) => {
          if (!u.isActive || u.id === lead?.ownerId) return false;
          if (isSuperUser) return true;
          if (isManager) return (u.reportingManagerIds?.includes(effectiveSelfId) ?? false);
          return u.id === effectiveSelfId;
        })
        .map((u) => ({
          id: u.id,
          name: `${u.firstName} ${u.lastName}`.trim(),
          email: u.email ?? '',
          role: u.role,
        }));
      setAssociates(list);
    } catch {
      toast.error('Failed to load users');
      setAssociates([]);
    } finally {
      setLoadingAssociates(false);
    }
  }, [lead?.subCompanyId, lead?.ownerId, writeAgencyId, currentUser?.subCompanyId, effectiveSelfId, isManager, isSuperUser]);

  useEffect(() => {
    if (open) {
      form.reset({ proposedOwnerId: '', numberOfEmployees: '' as unknown as number });
      loadAssociates();
    }
  }, [open, loadAssociates, form]);

  const selectedAssociate = associates.find((a) => a.id === form.watch('proposedOwnerId'));

  const onSubmit = async (data: FormData) => {
    if (!lead) return;
    setIsSubmitting(true);
    try {
      if (isSuperUser) {
        await createSuperUserLeadReassignment({
          leadId: lead.id,
          proposedOwnerId: data.proposedOwnerId,
          numberOfPositions: data.numberOfEmployees,
        });
      } else {
        await createLeadReassignmentRequest({
          leadId: lead.id,
          proposedOwnerId: data.proposedOwnerId,
          numberOfPositions: data.numberOfEmployees,
        });
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!lead) return null;

  const submitLabel = isSubmitting
    ? (isSuperUser ? 'Reassigning...' : 'Submitting...')
    : (isSuperUser ? 'Reassign Now' : 'Submit for Approval');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Reassign Lead
          </DialogTitle>
          <DialogDescription>
            {isSuperUser
              ? 'Reassign this lead to another user in the same agency. The transfer is immediate.'
              : 'Submit a reassignment request for approval. The lead will only transfer after a director, super admin or operations manager confirms.'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm mb-2">
          <span className="text-muted-foreground">Client: </span>
          <span className="font-medium">{lead.clientName ?? lead.id}</span>
          <span className="text-muted-foreground ml-4">Current Associate: </span>
          <span className="font-medium">{lead.ownerName}</span>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="proposedOwnerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Associate</FormLabel>
                  <FormControl>
                    <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={comboboxOpen}
                          className="w-full justify-between"
                          disabled={loadingAssociates}
                        >
                          {loadingAssociates ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Loading...
                            </span>
                          ) : selectedAssociate ? (
                            <span>
                              {selectedAssociate.name}
                              <span className="text-muted-foreground ml-2">
                                · {ROLE_LABELS[selectedAssociate.role] ?? selectedAssociate.role}
                              </span>
                            </span>
                          ) : (
                            'Select associate'
                          )}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0 bg-popover" align="start">
                        <Command>
                          <CommandInput placeholder="Search associates..." />
                          <CommandEmpty>No user found.</CommandEmpty>
                          <CommandGroup>
                            {associates.map((a) => (
                              <CommandItem
                                key={a.id}
                                value={a.name}
                                onSelect={() => {
                                  field.onChange(a.id);
                                  setComboboxOpen(false);
                                }}
                              >
                                <Check className={cn('mr-2 h-4 w-4', field.value === a.id ? 'opacity-100' : 'opacity-0')} />
                                <div className="flex-1">
                                  <div className="font-medium text-sm flex items-center gap-2">
                                    {a.name}
                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                      {ROLE_LABELS[a.role] ?? a.role}
                                    </span>
                                  </div>
                                  <div className="text-xs text-muted-foreground">{a.email}</div>
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="numberOfEmployees"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Number of Employees</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      placeholder="e.g. 3"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || loadingAssociates}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
