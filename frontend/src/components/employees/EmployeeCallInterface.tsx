import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useCallStore } from '@/lib/callStore';
import { updateCallSummary } from '@/lib/api';
import { toast } from 'sonner';
import type { Employee } from '@/lib/employeeTypes';
import { EmployeeDetailsSheet } from '@/components/employees/EmployeeDetailsSheet';
import { EmployeePhoneDialer } from '@/components/employees/EmployeePhoneDialer';

interface EmployeeCallInterfaceProps {
  employee: Employee;
  subCompanyId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummarySaved?: () => void;
}

export function EmployeeCallInterface({
  employee,
  subCompanyId,
  open,
  onOpenChange,
  onSummarySaved,
}: EmployeeCallInterfaceProps) {
  const { activeCall, closeCallInterface, minimizeCall } = useCallStore();
  const [showEndDialog, setShowEndDialog] = useState(false);
  const [savingSummary, setSavingSummary] = useState(false);
  const [comment, setComment] = useState('');
  const [response, setResponse] = useState<'positive' | 'negative' | null>(null);

  const partyName = `${employee.firstName} ${employee.lastName}`.trim() || 'Employee';

  useEffect(() => {
    if (activeCall?.status === 'ended') {
      setShowEndDialog(true);
    }
  }, [activeCall?.status]);

  useEffect(() => {
    if (!open) {
      setShowEndDialog(false);
      setComment('');
      setResponse(null);
    }
  }, [open]);

  const handleMinimize = () => {
    minimizeCall();
    onOpenChange(false);
  };

  const handleEndCall = () => {
    setShowEndDialog(true);
  };

  const handleClose = () => {
    if (activeCall && activeCall.status !== 'ended') {
      handleMinimize();
    } else {
      closeCallInterface();
      onOpenChange(false);
    }
  };

  const handleSubmitSummary = async () => {
    if (!response) {
      toast.error('Please select Positive or Negative');
      return;
    }
    if (!activeCall) {
      closeCallInterface();
      onOpenChange(false);
      return;
    }

    setSavingSummary(true);
    try {
      const outcomeValue = response === 'positive' ? 'answered' : 'no_answer';
      if (activeCall.backendCallId) {
        await updateCallSummary(activeCall.backendCallId, {
          notes: comment.trim() || undefined,
          outcome: outcomeValue,
          duration: activeCall.duration,
          twilioCallSid: activeCall.twilioCallSid ?? undefined,
        });
      }
      toast.success('Call summary saved');
      onSummarySaved?.();
      closeCallInterface();
      onOpenChange(false);
      setShowEndDialog(false);
      setComment('');
      setResponse(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save call summary');
    } finally {
      setSavingSummary(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <>
      {/* Employee Details Sheet with Phone Dialer docked on the left — same layout as client calls */}
      <EmployeeDetailsSheet
        employee={employee}
        open={open}
        onOpenChange={handleClose}
        phoneDialerSlot={
          <div className="flex h-full min-h-0 shrink-0">
            <EmployeePhoneDialer
              employee={employee}
              subCompanyId={subCompanyId}
              onMinimize={handleMinimize}
              onEndCall={handleEndCall}
              onClose={handleClose}
            />
          </div>
        }
      />

      <Dialog open={showEndDialog} onOpenChange={setShowEndDialog}>
        <DialogContent
          className="z-[270] sm:max-w-md"
          overlayClassName="z-[270]"
        >
          <DialogHeader>
            <DialogTitle>Call Summary</DialogTitle>
            <DialogDescription>
              Call with {partyName}
              {activeCall ? ` · ${formatDuration(activeCall.duration)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={response === 'positive' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setResponse('positive')}
              >
                <ThumbsUp className="h-4 w-4 mr-2" />
                Positive
              </Button>
              <Button
                type="button"
                variant={response === 'negative' ? 'default' : 'outline'}
                className="flex-1"
                onClick={() => setResponse('negative')}
              >
                <ThumbsDown className="h-4 w-4 mr-2" />
                Negative
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="employee-call-notes">Notes</Label>
              <Textarea
                id="employee-call-notes"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Optional call notes…"
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowEndDialog(false);
                closeCallInterface();
                onOpenChange(false);
              }}
              disabled={savingSummary}
            >
              Skip
            </Button>
            <Button onClick={handleSubmitSummary} disabled={savingSummary || !response}>
              {savingSummary ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
