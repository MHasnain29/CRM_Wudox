import { Badge } from '@/components/ui/badge';
import { EmployeeTag } from '@/lib/employeeTypes';

interface EmployeeSpecialTagsProps {
  tags: EmployeeTag[];
}

const tagConfig: Record<EmployeeTag, { label: string; className: string }> = {
  blacklisted: {
    label: 'Blacklisted',
    className: 'bg-red-100 text-red-800 border-red-300',
  },
  no_show: {
    label: 'No Show',
    className: 'bg-orange-100 text-orange-800 border-orange-300',
  },
  ex: {
    label: 'Ex',
    className: 'bg-gray-100 text-gray-800 border-gray-300',
  },
};

export function EmployeeSpecialTags({ tags }: EmployeeSpecialTagsProps) {
  if (!tags?.length) return null;

  return (
    <div className="flex gap-1 mt-1 flex-wrap">
      {tags.map((tag) => {
        const config = tagConfig[tag];
        if (!config) return null;
        return (
          <Badge key={tag} variant="outline" className={`text-xs ${config.className}`}>
            {config.label}
          </Badge>
        );
      })}
    </div>
  );
}
