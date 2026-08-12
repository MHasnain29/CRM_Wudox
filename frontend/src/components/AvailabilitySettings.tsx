import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Clock, Link2, Copy, Check, ExternalLink } from 'lucide-react';
import { useStore } from '@/lib/store';
import { DayOfWeek } from '@/lib/types';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const dayLabels: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const daysOrder: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const timeOptions = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2);
  const mins = i % 2 === 0 ? '00' : '30';
  return `${hours.toString().padStart(2, '0')}:${mins}`;
});

const durationOptions = [15, 30, 45, 60, 90, 120];
const bufferOptions = [0, 5, 10, 15, 30, 45, 60];

const timezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
];

export function AvailabilitySettings() {
  const { currentUser, getUserAvailability, updateUserAvailability, updateTimeSlot } = useStore();
  const availability = getUserAvailability(currentUser.id);
  const [copied, setCopied] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [newSlug, setNewSlug] = useState(availability.bookingLinkSlug);

  const bookingUrl = `${window.location.origin}/book/${availability.bookingLinkSlug}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    toast.success('Booking link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSlug = () => {
    const sanitizedSlug = newSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
    updateUserAvailability(currentUser.id, { bookingLinkSlug: sanitizedSlug });
    setEditingSlug(false);
    toast.success('Booking link updated');
  };

  const getSlotForDay = (day: DayOfWeek) => {
    return availability.slots.find(s => s.dayOfWeek === day);
  };

  return (
    <div className="space-y-6">
      {/* Booking Link */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Your Booking Link
          </CardTitle>
          <CardDescription>
            Share this link to let others schedule meetings with you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <span className="text-sm flex-1 truncate">{bookingUrl}</span>
            <Button variant="ghost" size="sm" onClick={handleCopyLink}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Customize URL slug</Label>
            <div className="flex gap-2">
              <Input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="your-name"
                className="flex-1"
              />
              <Button onClick={handleSaveSlug} disabled={newSlug === availability.bookingLinkSlug}>
                Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your link will be: {window.location.origin}/book/{newSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Meeting Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Meeting Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Meeting Duration</Label>
              <Select
                value={availability.meetingDuration.toString()}
                onValueChange={(v) => updateUserAvailability(currentUser.id, { meetingDuration: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {durationOptions.map((d) => (
                    <SelectItem key={d} value={d.toString()}>
                      {d} minutes
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Buffer Time</Label>
              <Select
                value={availability.bufferTime.toString()}
                onValueChange={(v) => updateUserAvailability(currentUser.id, { bufferTime: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {bufferOptions.map((b) => (
                    <SelectItem key={b} value={b.toString()}>
                      {b === 0 ? 'No buffer' : `${b} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Time between meetings</p>
            </div>

            <div className="space-y-2">
              <Label>Timezone</Label>
              <Select
                value={availability.timezone}
                onValueChange={(v) => updateUserAvailability(currentUser.id, { timezone: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezones.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Weekly Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Weekly Availability
          </CardTitle>
          <CardDescription>
            Set your available hours for each day of the week
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {daysOrder.map((day) => {
              const slot = getSlotForDay(day);
              if (!slot) return null;

              return (
                <div
                  key={day}
                  className={cn(
                    'flex items-center gap-4 p-3 rounded-lg border transition-colors',
                    slot.isEnabled ? 'bg-background' : 'bg-muted/50'
                  )}
                >
                  <div className="w-28 flex items-center gap-2">
                    <Switch
                      checked={slot.isEnabled}
                      onCheckedChange={(checked) =>
                        updateTimeSlot(currentUser.id, slot.id, { isEnabled: checked })
                      }
                    />
                    <span className={cn('text-sm font-medium', !slot.isEnabled && 'text-muted-foreground')}>
                      {dayLabels[day]}
                    </span>
                  </div>

                  {slot.isEnabled ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Select
                        value={slot.startTime}
                        onValueChange={(v) => updateTimeSlot(currentUser.id, slot.id, { startTime: v })}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground">to</span>
                      <Select
                        value={slot.endTime}
                        onValueChange={(v) => updateTimeSlot(currentUser.id, slot.id, { endTime: v })}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {timeOptions.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Unavailable</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
