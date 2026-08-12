import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { addMembersToList, apiFetch, type ApiMailingList } from '@/lib/api';

interface SimpleClient {
  id: string;
  name: string;
  industry: string | null;
  primaryEmail: string | null;
}

async function fetchClientsForList(): Promise<SimpleClient[]> {
  const res = await apiFetch<{ data: Array<{ id: string; name: string; industry: string | null; contacts: Array<{ email: string }> }> }>('/clients?limit=500');
  if (!res.ok || !res.data) return [];
  return res.data.data.map((c) => ({
    id: c.id,
    name: c.name,
    industry: c.industry,
    primaryEmail: c.contacts?.[0]?.email ?? null,
  }));
}

interface Props {
  list: ApiMailingList;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddClientsToListDialog({ list, open, onOpenChange, onSuccess }: Props) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients-for-list'],
    queryFn: fetchClientsForList,
    enabled: open,
  });

  const filtered = clients.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.primaryEmail ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    const ok = await addMembersToList(list.id, Array.from(selected));
    setSaving(false);
    if (ok) {
      toast.success(`${selected.size} client${selected.size > 1 ? 's' : ''} added to "${list.name}"`);
      setSelected(new Set());
      setSearch('');
      onSuccess();
      onOpenChange(false);
    } else {
      toast.error('Failed to add clients');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setSelected(new Set()); setSearch(''); } onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Clients to "{list.name}"</DialogTitle>
        </DialogHeader>

        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center py-10 text-sm text-muted-foreground">No clients found</p>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1 border rounded-md p-2">
            {filtered.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={selected.has(c.id)}
                  onCheckedChange={() => toggle(c.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.primaryEmail ?? 'No email'}</p>
                </div>
              </label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={selected.size === 0 || saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Add {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
