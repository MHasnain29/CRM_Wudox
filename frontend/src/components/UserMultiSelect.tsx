import { useState, useMemo } from 'react';
import { Users, ChevronDown, Search, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ApiUser } from '@/lib/api';
import { getUserRoleTitle } from '@/lib/roleLabels';

function initials(user: ApiUser): string {
  return `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase();
}

function triggerLabel(users: ApiUser[], selectedIds: string[]): string {
  if (selectedIds.length === 0) return 'All Users';
  if (selectedIds.length === 1) {
    const u = users.find((u) => u.id === selectedIds[0]);
    return u ? `${u.firstName} ${u.lastName}` : '1 user';
  }
  return `${selectedIds.length} users`;
}

interface Props {
  users: ApiUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  isLoading?: boolean;
}

export function UserMultiSelect({ users, selectedIds, onChange, isLoading }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        getUserRoleTitle(u).toLowerCase().includes(q)
    );
  }, [users, search]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(users.map((u) => u.id));
  const clearAll = () => onChange([]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9 gap-1.5 pl-3 pr-2 text-sm font-normal',
            selectedIds.length > 0 && 'border-primary/60 bg-primary/5 text-primary'
          )}
          disabled={isLoading}
        >
          <Users className="h-4 w-4 shrink-0" />
          <span className="max-w-[140px] truncate">{triggerLabel(users, selectedIds)}</span>
          {selectedIds.length > 0 && (
            <Badge variant="secondary" className="h-5 min-w-5 rounded-full px-1 text-xs">
              {selectedIds.length}
            </Badge>
          )}
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="end" sideOffset={6}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b">
          <span className="text-sm font-semibold">Filter by User</span>
          <div className="flex gap-1">
            <button
              className="text-xs text-muted-foreground hover:text-accent-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent"
              onClick={clearAll}
            >
              All
            </button>
            <button
              className="text-xs text-primary hover:text-primary/80 transition-colors px-1.5 py-0.5 rounded hover:bg-primary/10"
              onClick={selectAll}
            >
              Select all
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-2 py-2 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>

        {/* User list */}
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No users found</div>
          ) : (
            <div className="py-1">
              {filtered.map((user) => {
                const isSelected = selectedIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    className={cn(
                      'group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground',
                      isSelected && 'bg-primary/5'
                    )}
                    onClick={() => toggle(user.id)}
                  >
                    {/* Avatar */}
                    <div
                      className={cn(
                        'h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground group-hover:bg-white/20 group-hover:text-accent-foreground'
                      )}
                    >
                      {initials(user)}
                    </div>

                    {/* Name + role */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate leading-tight">
                        {user.firstName} {user.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground truncate group-hover:text-accent-foreground/90">
                        {getUserRoleTitle(user)}
                      </p>
                    </div>

                    {/* Check */}
                    <div
                      className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                        isSelected
                          ? 'bg-primary border-primary text-primary-foreground'
                          : 'border-input'
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer count */}
        {selectedIds.length > 0 && (
          <div className="border-t px-3 py-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
            <button
              className="text-xs text-destructive hover:text-destructive/80 transition-colors"
              onClick={clearAll}
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
