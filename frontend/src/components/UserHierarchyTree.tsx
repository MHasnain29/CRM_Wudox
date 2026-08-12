import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, Users as UsersIcon } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ApiUser, UserHierarchyNode } from '@/lib/api';

function nodeMatchesSearch(
  node: UserHierarchyNode,
  query: string,
  usersById: Map<string, ApiUser>,
): boolean {
  if (node.isUnassignedGroup) {
    return node.children.some((c) => nodeMatchesSearch(c, query, usersById));
  }
  const q = query.toLowerCase();
  const u = usersById.get(node.user.id);
  const name = `${node.user.firstName} ${node.user.lastName}`.toLowerCase();
  if (name.includes(q)) return true;
  if (u?.email?.toLowerCase().includes(q)) return true;
  if (u?.phone?.includes(query)) return true;
  return node.children.some((c) => nodeMatchesSearch(c, query, usersById));
}

export function filterHierarchyNodes(
  nodes: UserHierarchyNode[],
  query: string,
  usersById: Map<string, ApiUser>,
): UserHierarchyNode[] {
  if (!query.trim()) return nodes;
  return nodes
    .filter((n) => nodeMatchesSearch(n, query, usersById))
    .map((n) => ({
      ...n,
      children: filterHierarchyNodes(n.children, query, usersById),
    }));
}

function HierarchyTreeNode({
  node,
  depth,
  usersById,
  defaultOpen,
}: {
  node: UserHierarchyNode;
  depth: number;
  usersById: Map<string, ApiUser>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  const hasChildren = node.children.length > 0;
  const isGroup = node.isUnassignedGroup;
  const details = !isGroup ? usersById.get(node.user.id) : undefined;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          'rounded-lg border bg-card/60 p-3 transition-colors hover:bg-muted/30',
          isGroup && 'border-dashed',
        )}
        style={{ marginLeft: depth * 16 }}
      >
        <div className="flex items-start gap-2">
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button type="button" className="p-0.5 shrink-0" aria-label={open ? 'Collapse' : 'Expand'}>
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-5 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">
                {isGroup
                  ? 'Unassigned'
                  : `${node.user.firstName} ${node.user.lastName}`.trim()}
              </span>
              {!isGroup && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {node.user.roleLabel || node.user.role}
                </Badge>
              )}
              {details?.isActive === false && (
                <Badge variant="outline" className="text-xs text-muted-foreground">
                  Inactive
                </Badge>
              )}
            </div>
            {!isGroup && details?.email && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{details.email}</p>
            )}
          </div>
        </div>
      </div>
      {hasChildren && (
        <CollapsibleContent className="mt-1 space-y-1">
          {node.children.map((child) => (
            <HierarchyTreeNode
              key={child.isUnassignedGroup ? '__unassigned__' : child.user.id}
              node={child}
              depth={depth + 1}
              usersById={usersById}
            />
          ))}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export function UserHierarchyTree({
  tree,
  usersById,
  searchQuery = '',
  emptyMessage = 'No users in hierarchy',
  embedded = false,
}: {
  tree: UserHierarchyNode[];
  usersById: Map<string, ApiUser>;
  searchQuery?: string;
  emptyMessage?: string;
  /** When true, omit outer padding (e.g. inside agency sections). */
  embedded?: boolean;
}) {
  const filtered = filterHierarchyNodes(tree, searchQuery, usersById);

  if (filtered.length === 0) {
    return (
      <div className={embedded ? 'py-6 text-center' : 'p-12 text-center'}>
        <UsersIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn(embedded ? 'space-y-2' : 'p-4 space-y-2')}>
      {filtered.map((node) => (
        <HierarchyTreeNode
          key={node.isUnassignedGroup ? '__unassigned__' : node.user.id}
          node={node}
          depth={0}
          usersById={usersById}
          defaultOpen
        />
      ))}
    </div>
  );
}

export function UserHierarchyAgencySections({
  agencies,
  usersById,
  searchQuery = '',
}: {
  agencies: { id: string; name: string; tree: UserHierarchyNode[] }[];
  usersById: Map<string, ApiUser>;
  searchQuery?: string;
}) {
  const visible = agencies.filter((a) =>
    filterHierarchyNodes(a.tree, searchQuery, usersById).length > 0,
  );

  if (visible.length === 0) {
    return (
      <div className="p-12 text-center">
        <UsersIcon className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground">No users match your search</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-8">
      {visible.map((agency) => (
        <section key={agency.id}>
          <h3 className="text-sm font-semibold text-foreground mb-3 px-1 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
            {agency.name}
          </h3>
          <UserHierarchyTree
            tree={agency.tree}
            usersById={usersById}
            searchQuery={searchQuery}
            emptyMessage="No users in this agency"
            embedded
          />
        </section>
      ))}
    </div>
  );
}
