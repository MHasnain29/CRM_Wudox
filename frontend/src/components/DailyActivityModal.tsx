import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DailyActivityPanel } from '@/pages/DailyActivity';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTodayCountChange?: (count: number) => void;
};

export function DailyActivityModal({ open, onOpenChange, onTodayCountChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(100vw-2rem,64rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b px-4 py-3 text-left">
          <DialogTitle>Daily Agenda</DialogTitle>
          <DialogDescription className="sr-only">
            Tasks and follow-ups due or overdue today
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
          {open && (
            <DailyActivityPanel
              embedded
              onTodayCountChange={onTodayCountChange}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
