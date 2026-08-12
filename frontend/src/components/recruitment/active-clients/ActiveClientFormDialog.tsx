import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActiveClientStatus } from '@/lib/activeClientTypes';
import {
  createActiveClient,
  updateActiveClient,
  type ApiActiveClient,
} from '@/lib/activeClientsApi';
import {
  ActiveClientTrainingFields,
  type ActiveClientTrainingFormState,
} from '@/components/recruitment/active-clients/ActiveClientTrainingFields';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, MapPin, StickyNote, UserRound } from 'lucide-react';
import { toast } from 'sonner';

const EMPTY_TRAINING: ActiveClientTrainingFormState = {
  clientTraining: false,
  trainingPandaDocTemplateId: null,
  existingFileName: null,
};

interface ActiveClientFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ApiActiveClient | null;
}

export function ActiveClientFormDialog({
  open,
  onOpenChange,
  client,
}: ActiveClientFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = Boolean(client);

  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [status, setStatus] = useState<ActiveClientStatus>('active');
  const [notes, setNotes] = useState('');
  const [training, setTraining] = useState<ActiveClientTrainingFormState>(EMPTY_TRAINING);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setName(client.name);
      setIndustry(client.industry);
      setLocation(client.location);
      setContactName(client.contactName);
      setContactEmail(client.contactEmail);
      setContactPhone(client.contactPhone);
      setStatus(client.status);
      setNotes(client.notes ?? '');
      setTraining({
        clientTraining: Boolean(client.clientTraining),
        trainingPandaDocTemplateId: client.trainingPandaDocTemplateId ?? null,
        existingFileName:
          !client.trainingPandaDocTemplateId && client.hasTrainingDocument
            ? client.trainingFileName ?? 'Training document'
            : null,
      });
    } else {
      setName('');
      setIndustry('');
      setLocation('');
      setContactName('');
      setContactEmail('');
      setContactPhone('');
      setStatus('active');
      setNotes('');
      setTraining(EMPTY_TRAINING);
    }
    setSaving(false);
  }, [open, client]);

  const handleSubmit = async () => {
    if (!name.trim() || !location.trim()) {
      toast.error('Name and location are required');
      return;
    }
    if (!contactName.trim() || !contactEmail.trim() || !contactPhone.trim()) {
      toast.error('Contact name, email, and phone are required');
      return;
    }
    if (
      training.clientTraining &&
      !training.trainingPandaDocTemplateId &&
      !training.existingFileName
    ) {
      toast.error('Training document is required when Client training is enabled');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        industry: industry.trim() || 'General',
        location: location.trim(),
        contactName: contactName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim(),
        status,
        notes: notes.trim() || null,
        clientTraining: training.clientTraining,
        trainingPandaDocTemplateId: training.clientTraining
          ? training.trainingPandaDocTemplateId
          : null,
      };

      if (isEdit && client) {
        await updateActiveClient(client.id, payload);
        toast.success('Active client updated');
      } else {
        await createActiveClient(payload);
        toast.success('Active client added');
      }
      await queryClient.invalidateQueries({ queryKey: ['active-clients'] });
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save active client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100vw-1.5rem,44rem)] max-w-2xl h-[min(92vh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 text-left space-y-1.5">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
            {isEdit ? 'Edit Active Client' : 'Add Active Client'}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Recruitment clients for job placements. Not connected to Marketing Clients.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="space-y-4 rounded-xl border bg-muted/20 p-5">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Company</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ac-name">Company name *</Label>
              <Input
                id="ac-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Maple Leaf Logistics Inc."
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ac-industry">Industry</Label>
                <Input
                  id="ac-industry"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="e.g., Warehousing"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-location" className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  Location *
                </Label>
                <Input
                  id="ac-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Mississauga, ON"
                  className="h-11"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ActiveClientStatus)}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-muted/20 p-5">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Primary contact</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ac-contact-name">Contact name *</Label>
              <Input
                id="ac-contact-name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Contact name"
                className="h-11"
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ac-email">Email *</Label>
                <Input
                  id="ac-email"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="name@company.ca"
                  className="h-11"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ac-phone">Phone *</Label>
                <Input
                  id="ac-phone"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="416-555-0000"
                  className="h-11"
                  required
                />
              </div>
            </div>
          </section>

          <ActiveClientTrainingFields
            value={training}
            onChange={setTraining}
            disabled={saving}
          />

          <section className="space-y-4 rounded-xl border bg-muted/20 p-5">
            <div className="flex items-center gap-2">
              <StickyNote className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Notes</h3>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ac-notes">Placement notes</Label>
              <Textarea
                id="ac-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Shift preferences, site access, special instructions…"
                rows={5}
                className="min-h-[120px] resize-y"
              />
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving} className="h-10 px-5">
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving} className="h-10 px-5">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
