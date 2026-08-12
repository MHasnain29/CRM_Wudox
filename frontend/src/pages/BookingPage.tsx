import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Calendar } from '@/components/ui/calendar';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Calendar as CalendarIcon, Clock, User, Mail, Building2, CheckCircle2, ArrowLeft, Video } from 'lucide-react';
import { useStore } from '@/lib/store';
import { format, setHours, setMinutes, startOfDay, isBefore, addMinutes, isSameDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

export default function BookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { users, userAvailabilities, bookedMeetings, meetings, addBookedMeeting, generateMeetingLink } = useStore();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string>('');
  const [step, setStep] = useState<'date' | 'details' | 'confirmed'>('date');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestCompany, setGuestCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [meetingLink, setMeetingLink] = useState('');

  // Find the user by their booking slug
  const availability = userAvailabilities.find(a => a.bookingLinkSlug === slug);
  const host = users.find(u => u.id === availability?.userId);

  if (!availability || !host) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <h2 className="text-xl font-semibold mb-2">Booking Page Not Found</h2>
            <p className="text-muted-foreground mb-4">
              This booking link doesn't exist or has been removed.
            </p>
            <Button onClick={() => navigate('/')}>Go Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Get all booked slots for this host
  const hostBookedMeetings = bookedMeetings.filter(m => m.hostUserId === host.id && m.status === 'scheduled');
  const hostMeetings = meetings.filter(m => m.ownerId === host.id);

  const isSlotBooked = (date: Date, time: string) => {
    const [hours, mins] = time.split(':').map(Number);
    const slotStart = setMinutes(setHours(date, hours), mins);
    const slotEnd = addMinutes(slotStart, availability.meetingDuration);

    // Check booked meetings
    for (const meeting of hostBookedMeetings) {
      const meetingStart = new Date(meeting.startTime);
      const meetingEnd = new Date(meeting.endTime);
      
      // Check for overlap
      if (slotStart < meetingEnd && slotEnd > meetingStart) {
        return true;
      }
    }

    // Check regular meetings
    for (const meeting of hostMeetings) {
      const meetingStart = new Date(meeting.startTime);
      const meetingEnd = new Date(meeting.endTime);
      
      if (slotStart < meetingEnd && slotEnd > meetingStart) {
        return true;
      }
    }

    return false;
  };

  const isDateDisabled = (date: Date) => {
    if (isBefore(date, startOfDay(new Date()))) return true;
    
    const dayNames: Record<number, string> = {
      0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
      4: 'thursday', 5: 'friday', 6: 'saturday'
    };
    const dayOfWeek = dayNames[date.getDay()];
    return !availability.slots.some(s => s.dayOfWeek === dayOfWeek && s.isEnabled);
  };

  const getAvailableTimeSlots = () => {
    if (!selectedDate) return [];
    
    const dayNames: Record<number, string> = {
      0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
      4: 'thursday', 5: 'friday', 6: 'saturday'
    };
    const dayOfWeek = dayNames[selectedDate.getDay()];
    const daySlots = availability.slots.filter(s => s.dayOfWeek === dayOfWeek && s.isEnabled);
    
    if (daySlots.length === 0) return [];

    const times: { time: string; available: boolean }[] = [];
    daySlots.forEach(slot => {
      const [startH, startM] = slot.startTime.split(':').map(Number);
      const [endH, endM] = slot.endTime.split(':').map(Number);
      
      let currentTime = startH * 60 + startM;
      const endTime = endH * 60 + endM;
      
      while (currentTime + availability.meetingDuration <= endTime) {
        const hours = Math.floor(currentTime / 60);
        const mins = currentTime % 60;
        const timeStr = `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
        const isBooked = isSlotBooked(selectedDate, timeStr);
        times.push({ time: timeStr, available: !isBooked });
        currentTime += availability.meetingDuration + availability.bufferTime;
      }
    });

    return times;
  };

  const availableSlots = getAvailableTimeSlots();

  const handleConfirmBooking = () => {
    if (!selectedDate || !selectedTime || !guestName || !guestEmail) {
      toast.error('Please fill in all required fields');
      return;
    }

    const [hours, mins] = selectedTime.split(':').map(Number);
    const startTime = setMinutes(setHours(selectedDate, hours), mins);
    const endTime = addMinutes(startTime, availability.meetingDuration);
    const link = generateMeetingLink();

    addBookedMeeting({
      hostUserId: host.id,
      guestName,
      guestEmail,
      guestCompany: guestCompany || undefined,
      startTime,
      endTime,
      meetingLink: link,
      notes: notes || undefined,
      status: 'scheduled',
    });

    setMeetingLink(link);
    setStep('confirmed');
    toast.success('Meeting booked successfully!');
  };

  const formatTimeDisplay = (time: string) => {
    const [hours, mins] = time.split(':').map(Number);
    return format(setMinutes(setHours(new Date(), hours), mins), 'h:mm a');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-4xl shadow-xl">
        <CardHeader className="border-b bg-muted/30">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <CardTitle>{host.name}</CardTitle>
              <CardDescription>
                {availability.meetingDuration} minute meeting
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {step === 'date' && (
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x">
              <div className="p-6">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <CalendarIcon className="h-4 w-4" />
                  Select a Date
                </h3>
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    setSelectedDate(date);
                    setSelectedTime('');
                  }}
                  disabled={isDateDisabled}
                  className="rounded-md border pointer-events-auto"
                />
              </div>

              <div className="p-6">
                <h3 className="font-medium mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : 'Select a time'}
                </h3>
                
                {!selectedDate ? (
                  <p className="text-muted-foreground text-sm">
                    Please select a date to see available times
                  </p>
                ) : availableSlots.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    No available slots on this day
                  </p>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="grid grid-cols-2 gap-2 pr-4">
                      {availableSlots.map(({ time, available }) => (
                        <Button
                          key={time}
                          variant={selectedTime === time ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => available && setSelectedTime(time)}
                          disabled={!available}
                          className={cn(
                            "justify-center",
                            !available && "opacity-50 line-through"
                          )}
                        >
                          {formatTimeDisplay(time)}
                          {!available && <span className="sr-only">(Booked)</span>}
                        </Button>
                      ))}
                    </div>
                  </ScrollArea>
                )}

                {selectedDate && selectedTime && (
                  <div className="mt-4 pt-4 border-t">
                    <div className="p-3 bg-primary/10 rounded-lg mb-4">
                      <p className="text-sm font-medium text-primary">
                        {format(selectedDate, 'EEEE, MMMM d')} at {formatTimeDisplay(selectedTime)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Duration: {availability.meetingDuration} minutes
                      </p>
                    </div>
                    <Button className="w-full" onClick={() => setStep('details')}>
                      Continue
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'details' && (
            <div className="p-6 space-y-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('date')}
                className="mb-2"
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>

              <div className="p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarIcon className="h-4 w-4 text-primary" />
                  <span className="font-medium">
                    {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm mt-1">
                  <Clock className="h-4 w-4 text-primary" />
                  <span>
                    {selectedTime && formatTimeDisplay(selectedTime)} ({availability.meetingDuration} min)
                  </span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Your Name *</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="name"
                      placeholder="John Smith"
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email Address *</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="john@example.com"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company (Optional)</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="company"
                      placeholder="Acme Inc."
                      value={guestCompany}
                      onChange={(e) => setGuestCompany(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="notes">Additional Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder="What would you like to discuss?"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>

              <Button 
                className="w-full" 
                size="lg"
                onClick={handleConfirmBooking}
                disabled={!guestName || !guestEmail}
              >
                Confirm Booking
              </Button>
            </div>
          )}

          {step === 'confirmed' && (
            <div className="p-6 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400">
                <CheckCircle2 className="h-8 w-8" />
              </div>

              <div>
                <h2 className="text-2xl font-semibold mb-2">You're Booked!</h2>
                <p className="text-muted-foreground">
                  A calendar invitation has been sent to {guestEmail}
                </p>
              </div>

              <Card className="text-left">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Meeting with {host.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {selectedDate && format(selectedDate, 'EEEE, MMMM d, yyyy')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {selectedTime && formatTimeDisplay(selectedTime)} ({availability.meetingDuration} min)
                    </span>
                  </div>
                  {meetingLink && (
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-muted-foreground" />
                      <a 
                        href={meetingLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        Join via Google Meet
                      </a>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Button variant="outline" onClick={() => navigate('/')}>
                Back to Home
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
