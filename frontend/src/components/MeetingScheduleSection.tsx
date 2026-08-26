import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Link2, Calendar as CalendarIcon, Copy, Check } from 'lucide-react';
import { useStore } from '@/lib/store';
import { toast } from 'sonner';

interface MeetingScheduleSectionProps {
  onInsertMeetingLink: (link: string) => void;
  onInsertBookingLink: (link: string) => void;
}

export function MeetingScheduleSection({ onInsertMeetingLink, onInsertBookingLink }: MeetingScheduleSectionProps) {
  const { currentUser, users, getUserAvailability } = useStore();
  const [copied, setCopied] = useState(false);

  // Determine which booking link to show based on country and role
  const getBookingLinkUser = () => {
    const isPakistani = currentUser.country === 'Pakistan';
    const isCanadianSalesRole = currentUser.country === 'Canada' && 
      (currentUser.userType === 'Sales Associate'
        || currentUser.userType === 'Sales Executive'
        || currentUser.userType === 'Marketing'
        || currentUser.userType === 'Sales & Marketing Executive'
        || currentUser.role === 'marketing');

    if (isCanadianSalesRole) {
      // Canadian Sales Associates and Executives use their own booking link
      return currentUser;
    } else if (isPakistani) {
      // Pakistani users use their manager's booking link (Sales Manager or Operations Manager from same location)
      const manager = users.find(u => 
        u.locationId === currentUser.locationId && 
        (u.userType === 'Sales Manager' || u.userType === 'Operations Manager') &&
        u.isActive
      );
      return manager || null;
    }
    
    // For other roles (managers, directors, etc.), they can use their own
    return currentUser;
  };

  const bookingLinkUser = getBookingLinkUser();
  
  if (!bookingLinkUser) {
    return (
      <div className="space-y-4 border-t pt-4">
        <Label className="text-sm font-medium">Meeting Scheduling</Label>
        <Card className="border-dashed">
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">
              No manager booking link available for your location.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const availability = getUserAvailability(bookingLinkUser.id);
  const bookingUrl = `${window.location.origin}/book/${availability.bookingLinkSlug}`;
  const isOwnLink = bookingLinkUser.id === currentUser.id;

  const handleCopyBookingLink = () => {
    navigator.clipboard.writeText(bookingUrl);
    setCopied(true);
    toast.success('Booking link copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleInsertBookingLink = () => {
    const bookingText = `\n\nYou can schedule a meeting at your convenience: ${bookingUrl}`;
    onInsertBookingLink(bookingText);
    toast.success('Booking link inserted into email');
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <Label className="text-sm font-medium">Meeting Scheduling</Label>
      
      {/* Booking Link */}
      <Card className="border-dashed">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">
              {isOwnLink ? 'Your Booking Link' : `${bookingLinkUser.name}'s Booking Link`}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {isOwnLink 
              ? 'Share this link to let others book time on your calendar'
              : `Share this link to let others book time with ${bookingLinkUser.name}`
            }
          </p>
          <div className="flex items-center gap-2 p-2 bg-muted rounded-md text-xs">
            <Link2 className="h-3 w-3 flex-shrink-0" />
            <span className="truncate">{bookingUrl}</span>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={handleInsertBookingLink}
              className="flex-1"
            >
              Insert into Email
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyBookingLink}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
