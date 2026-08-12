import { JobTemplate } from '@/lib/jobTypes';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Factory,
  Truck,
  ClipboardList,
  Code,
  Package,
  FileText,
  Headphones,
  HardHat,
  Plus,
} from 'lucide-react';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Factory,
  Truck,
  ClipboardList,
  Code,
  Package,
  FileText,
  Headphones,
  HardHat,
};

interface JobTemplateCardProps {
  template: JobTemplate;
  onSelect: (template: JobTemplate) => void;
}

export function JobTemplateCard({ template, onSelect }: JobTemplateCardProps) {
  const Icon = iconMap[template.icon] || FileText;

  return (
    <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-sm">{template.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {template.description}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {template.defaultSkills.slice(0, 3).map((skill) => (
                <Badge key={skill} variant="secondary" className="text-xs px-1.5 py-0">
                  {skill}
                </Badge>
              ))}
              {template.defaultSkills.length > 3 && (
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  +{template.defaultSkills.length - 3}
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onSelect(template)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
