import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FallbackAction } from '@/lib/phoneSystemTypes';
import type { DemoVoicemailBox } from '@/lib/phoneSystemTypes';

interface FallbackFieldsEditorProps {
  fallbackAction: FallbackAction;
  fallbackVoicemailBoxId?: string;
  fallbackForwardE164?: string;
  voicemailBoxes: DemoVoicemailBox[];
  onActionChange: (action: FallbackAction) => void;
  onVoicemailChange: (id: string) => void;
  onForwardChange: (e164: string) => void;
  compact?: boolean;
}

export function FallbackFieldsEditor({
  fallbackAction,
  fallbackVoicemailBoxId,
  fallbackForwardE164 = '',
  voicemailBoxes,
  onActionChange,
  onVoicemailChange,
  onForwardChange,
  compact,
}: FallbackFieldsEditorProps) {
  return (
    <div className={compact ? 'space-y-2' : 'grid sm:grid-cols-2 gap-3 pt-2 border-t'}>
      <div className="space-y-1 sm:col-span-2">
        <Label className="text-xs">After timeout</Label>
        <Select
          value={fallbackAction}
          onValueChange={(v) => onActionChange(v as FallbackAction)}
        >
          <SelectTrigger className={compact ? 'h-8' : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="voicemail">Leave voicemail</SelectItem>
            <SelectItem value="forward">Forward to another number</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {fallbackAction === 'voicemail' ? (
        <div className="space-y-1">
          <Label className="text-xs">Voicemail box</Label>
          <Select
            value={fallbackVoicemailBoxId ?? ''}
            onValueChange={onVoicemailChange}
          >
            <SelectTrigger className={compact ? 'h-8' : undefined}>
              <SelectValue placeholder="Select box" />
            </SelectTrigger>
            <SelectContent>
              {voicemailBoxes.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  Ext {v.extension} · {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Forwarding number</Label>
          <Input
            className={compact ? 'h-8' : undefined}
            placeholder="+15145551234"
            value={fallbackForwardE164}
            onChange={(e) => onForwardChange(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">
            If no one answers, send the call to this phone number. Use full international format
            (country code + number), e.g. +1 for US/Canada.
          </p>
        </div>
      )}
    </div>
  );
}
