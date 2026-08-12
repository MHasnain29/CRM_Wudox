import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2 } from 'lucide-react';
import { createOrGetConversation, fetchAgencyShareRecipients, sendConversationMessage } from '@/lib/api';
import { parseDataUrl } from '@/lib/captureScreen';
import { toast } from 'sonner';

interface AgencyMember {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  userType?: string;
}

interface SnipShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  screenshotDataUrl: string | null;
  onSent?: () => void;
}

export function SnipShareDialog({
  open,
  onOpenChange,
  screenshotDataUrl,
  onSent,
}: SnipShareDialogProps) {
  const [users, setUsers] = useState<AgencyMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AgencyMember | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setSelectedUser(null);
    setMessage('');
    setError(null);
    setSearchOpen(false);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAgencyShareRecipients();
      setUsers(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadUsers();
      reset();
    }
  }, [open, loadUsers, reset]);

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const formatUserLabel = (user: AgencyMember) => {
    const name = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const position = user.userType?.trim();
    return position ? `${name} (${position})` : name;
  };

  const handleSend = async () => {
    if (!selectedUser || !screenshotDataUrl) {
      setError('Please select a recipient.');
      return;
    }

    const parsed = parseDataUrl(screenshotDataUrl);
    if (!parsed) {
      setError('Invalid screenshot data.');
      return;
    }

    setError(null);
    setSending(true);
    try {
      const conv = await createOrGetConversation(selectedUser.id);
      await sendConversationMessage(conv.id, {
        text: message.trim() || 'Shared a screenshot',
        playSoundOnly: true,
        attachments: [
          {
            name: `screenshot-${Date.now()}.png`,
            fileBase64: parsed.base64,
            mimeType: parsed.mimeType,
          },
        ],
      });
      const name = `${selectedUser.firstName} ${selectedUser.lastName}`.trim() || selectedUser.email;
      toast.success(`Screenshot sent to ${name}`);
      onSent?.();
      handleOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send screenshot');
    } finally {
      setSending(false);
    }
  };

  const isEmpty = !loading && users.length === 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-snip-ignore className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send screenshot</DialogTitle>
          <DialogDescription>
            Choose who should receive this screenshot and add an optional message.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {screenshotDataUrl && (
            <div className="rounded-lg border overflow-hidden bg-muted/30">
              <img
                src={screenshotDataUrl}
                alt="Screenshot preview"
                className="max-h-48 w-full object-contain"
              />
            </div>
          )}

          <div className="grid gap-2">
            <Label>Send to</Label>
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={searchOpen}
                  className="w-full justify-between"
                >
                  {selectedUser ? formatUserLabel(selectedUser) : 'Select person...'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search by name or email..." />
                  <CommandEmpty>
                    {loading ? 'Loading...' : isEmpty ? 'No one found in your agency.' : 'No match for your search.'}
                  </CommandEmpty>
                  <CommandGroup>
                    <ScrollArea className="h-48">
                      {users.map((u) => (
                        <CommandItem
                          key={u.id}
                          value={`${u.firstName} ${u.lastName} ${u.email} ${u.userType ?? ''}`.trim()}
                          onSelect={() => {
                            setSelectedUser(u);
                            setSearchOpen(false);
                          }}
                        >
                          <div>
                            <p className="font-medium">{formatUserLabel(u)}</p>
                            <p className="text-xs text-muted-foreground">
                              {[u.userType?.trim(), u.email].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </CommandItem>
                      ))}
                    </ScrollArea>
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="snip-message">Message (optional)</Label>
            <Textarea
              id="snip-message"
              placeholder="Add a note..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="bg-background min-h-[80px]"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={!selectedUser || sending}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
