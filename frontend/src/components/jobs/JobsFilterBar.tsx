/**
 * Jobs filter bar — same Popover + checkbox + chip pattern as Employees.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Filter, Eye, Save, Trash2, X, Search } from 'lucide-react';
import { format } from 'date-fns';
import type {
  JobFilterView,
  JobStatus,
  JobType,
  PublishPlatform,
} from '@/lib/jobTypes';

export type JobsFilterState = {
  searchQuery: string;
  statusFilters: JobStatus[];
  locationFilters: string[];
  departmentFilters: string[];
  employmentTypeFilters: string[];
  platformFilters: PublishPlatform[];
  jobTypeFilters: JobType[];
  clientFilters: string[];
};

type ClientOption = { id: string; name: string };

type Props = {
  filters: JobsFilterState;
  onChange: (patch: Partial<JobsFilterState>) => void;
  onClear: () => void;
  locations: string[];
  departments: string[];
  clients: ClientOption[];
  filterViews: JobFilterView[];
  onSaveView: (name: string) => void;
  onApplyView: (view: JobFilterView) => void;
  onDeleteView: (id: string) => void;
  currentViewId?: string | null;
  onCurrentViewIdChange?: (id: string | null) => void;
};

function toggleIn(value: string, current: string[]): string[] {
  return current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
}

const STATUS_OPTIONS: JobStatus[] = ['draft', 'open', 'closed', 'filled'];
const JOB_TYPE_OPTIONS: { value: JobType; label: string }[] = [
  { value: 'internal', label: 'Internal' },
  { value: 'external', label: 'External' },
];
const EMPLOYMENT_OPTIONS = ['full-time', 'part-time', 'contract', 'temporary'] as const;
const PLATFORM_OPTIONS: { value: PublishPlatform; label: string }[] = [
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'indeed', label: 'Indeed' },
  { value: 'glassdoor', label: 'Glassdoor' },
];

export function JobsFilterBar({
  filters,
  onChange,
  onClear,
  locations,
  departments,
  clients,
  filterViews,
  onSaveView,
  onApplyView,
  onDeleteView,
  currentViewId,
  onCurrentViewIdChange,
}: Props) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');

  const hasActiveFilters =
    filters.statusFilters.length > 0 ||
    filters.locationFilters.length > 0 ||
    filters.departmentFilters.length > 0 ||
    filters.employmentTypeFilters.length > 0 ||
    filters.platformFilters.length > 0 ||
    filters.jobTypeFilters.length > 0 ||
    filters.clientFilters.length > 0;

  const handleSave = () => {
    if (!viewName.trim()) return;
    onSaveView(viewName.trim());
    setViewName('');
    setSaveOpen(false);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative w-full max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search jobs..."
          value={filters.searchQuery}
          onChange={(e) => onChange({ searchQuery: e.target.value })}
          className="pl-10"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Job Type{' '}
              {filters.jobTypeFilters.length > 0 && `(${filters.jobTypeFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="start">
            <div className="space-y-2">
              {JOB_TYPE_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`job-type-${opt.value}`}
                    checked={filters.jobTypeFilters.includes(opt.value)}
                    onCheckedChange={() =>
                      onChange({
                        jobTypeFilters: toggleIn(
                          opt.value,
                          filters.jobTypeFilters,
                        ) as JobType[],
                      })
                    }
                  />
                  <label htmlFor={`job-type-${opt.value}`} className="text-sm cursor-pointer">
                    {opt.label}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Status{' '}
              {filters.statusFilters.length > 0 && `(${filters.statusFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="start">
            <div className="space-y-2">
              {STATUS_OPTIONS.map((status) => (
                <div key={status} className="flex items-center space-x-2">
                  <Checkbox
                    id={`job-status-${status}`}
                    checked={filters.statusFilters.includes(status)}
                    onCheckedChange={() =>
                      onChange({
                        statusFilters: toggleIn(
                          status,
                          filters.statusFilters,
                        ) as JobStatus[],
                      })
                    }
                  />
                  <label
                    htmlFor={`job-status-${status}`}
                    className="text-sm capitalize cursor-pointer"
                  >
                    {status}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Client{' '}
              {filters.clientFilters.length > 0 && `(${filters.clientFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3 max-h-64 overflow-y-auto" align="start">
            <div className="space-y-2">
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active clients</p>
              ) : (
                clients.map((c) => (
                  <div key={c.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`job-client-${c.id}`}
                      checked={filters.clientFilters.includes(c.id)}
                      onCheckedChange={() =>
                        onChange({
                          clientFilters: toggleIn(c.id, filters.clientFilters),
                        })
                      }
                    />
                    <label
                      htmlFor={`job-client-${c.id}`}
                      className="text-sm cursor-pointer truncate"
                    >
                      {c.name}
                    </label>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Location{' '}
              {filters.locationFilters.length > 0 && `(${filters.locationFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 max-h-64 overflow-y-auto" align="start">
            <div className="space-y-2">
              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No locations yet</p>
              ) : (
                locations.map((loc) => (
                  <div key={loc} className="flex items-center space-x-2">
                    <Checkbox
                      id={`job-loc-${loc}`}
                      checked={filters.locationFilters.includes(loc)}
                      onCheckedChange={() =>
                        onChange({
                          locationFilters: toggleIn(loc, filters.locationFilters),
                        })
                      }
                    />
                    <label htmlFor={`job-loc-${loc}`} className="text-sm cursor-pointer">
                      {loc}
                    </label>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Department{' '}
              {filters.departmentFilters.length > 0 &&
                `(${filters.departmentFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-3 max-h-64 overflow-y-auto" align="start">
            <div className="space-y-2">
              {departments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No departments yet</p>
              ) : (
                departments.map((dept) => (
                  <div key={dept} className="flex items-center space-x-2">
                    <Checkbox
                      id={`job-dept-${dept}`}
                      checked={filters.departmentFilters.includes(dept)}
                      onCheckedChange={() =>
                        onChange({
                          departmentFilters: toggleIn(dept, filters.departmentFilters),
                        })
                      }
                    />
                    <label htmlFor={`job-dept-${dept}`} className="text-sm cursor-pointer">
                      {dept}
                    </label>
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Employment{' '}
              {filters.employmentTypeFilters.length > 0 &&
                `(${filters.employmentTypeFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="start">
            <div className="space-y-2">
              {EMPLOYMENT_OPTIONS.map((type) => (
                <div key={type} className="flex items-center space-x-2">
                  <Checkbox
                    id={`job-emp-${type}`}
                    checked={filters.employmentTypeFilters.includes(type)}
                    onCheckedChange={() =>
                      onChange({
                        employmentTypeFilters: toggleIn(type, filters.employmentTypeFilters),
                      })
                    }
                  />
                  <label
                    htmlFor={`job-emp-${type}`}
                    className="text-sm capitalize cursor-pointer"
                  >
                    {type}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4 mr-2" />
              Platform{' '}
              {filters.platformFilters.length > 0 && `(${filters.platformFilters.length})`}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-3" align="start">
            <div className="space-y-2">
              {PLATFORM_OPTIONS.map((opt) => (
                <div key={opt.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={`job-plat-${opt.value}`}
                    checked={filters.platformFilters.includes(opt.value)}
                    onCheckedChange={() =>
                      onChange({
                        platformFilters: toggleIn(
                          opt.value,
                          filters.platformFilters,
                        ) as PublishPlatform[],
                      })
                    }
                  />
                  <label htmlFor={`job-plat-${opt.value}`} className="text-sm cursor-pointer">
                    {opt.label}
                  </label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        <Select
          value={currentViewId || 'default'}
          onValueChange={(value) => {
            if (value === 'default') {
              onClear();
              onCurrentViewIdChange?.(null);
              return;
            }
            const view = filterViews.find((v) => v.id === value);
            if (view) {
              onApplyView(view);
              onCurrentViewIdChange?.(view.id);
            }
          }}
        >
          <SelectTrigger className="w-48">
            <Eye className="h-4 w-4 mr-2" />
            <SelectValue placeholder="Select View" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">All (Default)</SelectItem>
            {filterViews.map((view) => (
              <SelectItem key={view.id} value={view.id}>
                {view.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Save className="h-4 w-4 mr-2" />
                Save View
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Save Current View</DialogTitle>
                <DialogDescription>
                  Save your current filter settings as a view
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="job-view-name">View Name</Label>
                  <Input
                    id="job-view-name"
                    placeholder="e.g., Open Warehouse Roles"
                    value={viewName}
                    onChange={(e) => setViewName(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setSaveOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSave}>Save View</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {filterViews.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm">
                <Eye className="h-4 w-4 mr-2" />
                Manage ({filterViews.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3" align="start">
              <div className="space-y-2">
                <h4 className="font-medium text-sm mb-2">Saved Views</h4>
                {filterViews.map((view) => (
                  <div
                    key={view.id}
                    className="flex items-center justify-between p-2 hover:bg-accent rounded"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium">{view.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(view.createdAt), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => onDeleteView(view.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClear();
              onCurrentViewIdChange?.(null);
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1.5">
          {filters.jobTypeFilters.map((type) => (
            <Badge key={`type-${type}`} variant="secondary" className="gap-1 capitalize">
              {type}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    jobTypeFilters: toggleIn(type, filters.jobTypeFilters) as JobType[],
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.statusFilters.map((status) => (
            <Badge key={`status-${status}`} variant="secondary" className="gap-1 capitalize">
              {status}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    statusFilters: toggleIn(status, filters.statusFilters) as JobStatus[],
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.clientFilters.map((id) => (
            <Badge key={`client-${id}`} variant="secondary" className="gap-1">
              {clients.find((c) => c.id === id)?.name ?? id}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    clientFilters: toggleIn(id, filters.clientFilters),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.locationFilters.map((loc) => (
            <Badge key={`loc-${loc}`} variant="secondary" className="gap-1">
              {loc}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    locationFilters: toggleIn(loc, filters.locationFilters),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.departmentFilters.map((dept) => (
            <Badge key={`dept-${dept}`} variant="secondary" className="gap-1">
              {dept}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    departmentFilters: toggleIn(dept, filters.departmentFilters),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.employmentTypeFilters.map((type) => (
            <Badge key={`emp-${type}`} variant="secondary" className="gap-1 capitalize">
              {type}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    employmentTypeFilters: toggleIn(type, filters.employmentTypeFilters),
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {filters.platformFilters.map((p) => (
            <Badge key={`plat-${p}`} variant="secondary" className="gap-1 capitalize">
              {PLATFORM_OPTIONS.find((o) => o.value === p)?.label ?? p}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-muted"
                onClick={() =>
                  onChange({
                    platformFilters: toggleIn(p, filters.platformFilters) as PublishPlatform[],
                  })
                }
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
