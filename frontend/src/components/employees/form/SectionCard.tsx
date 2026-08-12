import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <Label className="text-xs font-medium text-muted-foreground">
      {children}
      {required && <span className="text-destructive ml-0.5">*</span>}
    </Label>
  );
}

/** Consistent card chrome for form sections: tinted icon, title, hint, optional required flag. */
export function SectionCard({
  icon: Icon,
  iconClassName,
  title,
  description,
  required,
  actions,
  children,
  id,
  className,
}: {
  icon: LucideIcon;
  iconClassName?: string;
  title: string;
  description?: string;
  required?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <Card id={id} className={cn('shadow-sm scroll-mt-24', className)}>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={cn(
                'h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary',
                iconClassName,
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold leading-tight flex items-center gap-2">
                {title}
                {required && <span className="text-[10px] font-medium text-destructive">* Required</span>}
              </h3>
              {description && (
                <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}
