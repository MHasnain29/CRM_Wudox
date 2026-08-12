import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Loader2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { fetchAgencyMembers } from '@/lib/api';

interface NewMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConversationCreated: (conversationId: string) => void;
}

export function NewMessageDialog({
  open,
  onOpenChange,
  onConversationCreated,
}: NewMessageDialogProps) {
  const currentUser = useStore((s) => s.currentUser);
  const [users, setUsers] = useState<{ id: string; firstName: string; lastName: string; email: string; role: string; userType?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; firstName: string; lastName: string; email: string; role: string; userType?: string } | null>(null);
  const [starting, setStarting] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchAgencyMembers();
      setUsers(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadUsers();
      setSelectedUser(null);
    }
  }, [open, loadUsers]);

  const isEmpty = !loading && users.length === 0;

  const handleStart = async () => {
    if (!selectedUser) return;
    setStarting(true);
    try {
      const { createOrGetConversation } = await import('@/lib/api');
      const conv = await createOrGetConversation(selectedUser.id);
      onConversationCreated(conv.id);
      onOpenChange(false);
    } catch (err) {
      console.error(err);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Choose a colleague from your agency to start a conversation.
        </p>
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={searchOpen}
              className="w-full justify-between"
            >
              {selectedUser
                ? (() => {
                    const name = `${selectedUser.firstName} ${selectedUser.lastName}`.trim() || selectedUser.email;
                    const position = selectedUser.userType?.trim();
                    return position ? `${name} (${position})` : name;
                  })()
                : 'Select person...'}
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
                        <p className="font-medium">
                          {`${u.firstName} ${u.lastName}`.trim() || u.email}
                          {u.userType?.trim() ? ` (${u.userType.trim()})` : ''}
                        </p>
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={!selectedUser || starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start conversation'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
