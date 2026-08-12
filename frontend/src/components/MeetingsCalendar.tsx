import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChevronLeft, ChevronRight, Video, User, Clock, Building2, Loader2, CheckCircle2 } from 'lucide-react';
import { ApiMeeting, ApiBookedMeeting, fetchMeetings, fetchBookedMeetings } from '@/lib/api';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isToday,
} from 'date-fns';
import { cn } from '@/lib/utils';

interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date;
  type: 'meeting' | 'booked';
  status?: string;
  meetingLink?: string | null;
  guestName?: string;
  guestCompany?: string | null;
  clientName?: string | null;
}

interface MeetingsCalendarProps {
  onMeetingClick?: (meetingId: string, type: 'meeting' | 'booked') => void;
  refreshTrigger?: number;
  ownerIds?: string[];
  agencyIds?: string[];
}

export function MeetingsCalendar({ onMeetingClick, refreshTrigger, ownerIds, agencyIds }: MeetingsCalendarProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [meetings, setMeetings] = useState<ApiMeeting[]>([]);
  const [bookedMeetings, setBookedMeetings] = useState<ApiBookedMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const ms = startOfMonth(currentMonth);
    const me = endOfMonth(currentMonth);
    const controller = new AbortController();

    const [mRes, bRes] = await Promise.all([
      fetchMeetings({ from: ms.toISOString(), to: me.toISOString(), limit: 200, ownerIds, agencyIds, scope: agencyIds?.length ? 'all' : undefined }),
      fetchBookedMeetings({ from: ms.toISOString(), to: me.toISOString(), limit: 200 }),
    ]);

    if (!controller.signal.aborted) {
      setMeetings(mRes.data);
      const filteredBooked = ownerIds?.length
        ? bRes.data.filter((b) => ownerIds.includes(b.hostUserId))
        : bRes.data;
      setBookedMeetings(filteredBooked);
      setLoading(false);
    }
  }, [currentMonth, ownerIds, agencyIds]);

  useEffect(() => { loadData(); }, [loadData, refreshTrigger]);

  const allEvents: CalendarEvent[] = [
    ...meetings.map(m => ({
      id: m.id,
      title: m.title,
      startTime: new Date(m.startTime),
      endTime: new Date(m.endTime),
      type: 'meeting' as const,
      status: m.status,
      meetingLink: m.meetingLink,
      clientName: m.clientName,
    })),
    ...bookedMeetings.filter(m => m.status !== 'cancelled').map(m => ({
      id: m.id,
      title: `Meeting with ${m.guestName}`,
      startTime: new Date(m.startTime),
      endTime: new Date(m.endTime),
      type: 'booked' as const,
      status: m.status,
      meetingLink: m.meetingLink,
      guestName: m.guestName,
      guestCompany: m.guestCompany,
    })),
  ];

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const getEventsForDay = (day: Date) => allEvents.filter(event => isSameDay(event.startTime, day));
  const selectedDayEvents = selectedDate ? getEventsForDay(selectedDate) : [];
  const weekDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar Grid */}
      <Card className="lg:col-span-2">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>{format(currentMonth, 'MMMM yyyy')}</CardTitle>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setCurrentMonth(new Date()); setSelectedDate(new Date()); }}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {weekDays.map(day => (
                  <div key={day} className="text-center text-xs font-medium text-muted-foreground py-2">{day}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-px border border-border rounded-lg overflow-hidden bg-border">
                {calendarDays.map(day => {
                  const dayEvents = getEventsForDay(day).sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
                  const isSelected = selectedDate && isSameDay(day, selectedDate);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const todayDay = isToday(day);
                  const visibleEvents = dayEvents.slice(0, 3);
                  const hiddenCount = dayEvents.length - 3;

                  return (
                    <div
                      key={day.toISOString()}
                      onClick={() => setSelectedDate(day)}
                      className={cn(
                        'min-h-[90px] p-1 flex flex-col gap-0.5 cursor-pointer transition-colors',
                        'bg-background hover:bg-accent/40',
                        isSelected && 'bg-primary/5 hover:bg-primary/10',
                        !isCurrentMonth && 'bg-muted/30',
                      )}
                    >
                      {/* Day number */}
                      <div className="flex justify-center mb-0.5">
                        <span
                          className={cn(
                            'text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full',
                            !isCurrentMonth && 'text-muted-foreground/40',
                            isCurrentMonth && !todayDay && 'text-foreground',
                            todayDay && 'bg-primary text-primary-foreground font-bold',
                            isSelected && !todayDay && 'bg-primary/15 text-primary font-semibold',
                          )}
                        >
                          {format(day, 'd')}
                        </span>
                      </div>

                      {/* Event bars */}
                      <div className="flex flex-col gap-px flex-1">
                        {visibleEvents.map(event => (
                          <div
                            key={event.id}
                            onClick={e => { e.stopPropagation(); onMeetingClick?.(event.id, event.type); }}
                            title={`${format(event.startTime, 'h:mm a')} · ${event.title}`}
                            className={cn(
                              'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight truncate cursor-pointer',
                              'transition-opacity hover:opacity-80',
                              event.type === 'meeting'
                                ? 'bg-blue-500 text-white'
                                : 'bg-emerald-500 text-white',
                              event.status === 'completed' && 'opacity-60',
                            )}
                          >
                            <span className="shrink-0 opacity-80">{format(event.startTime, 'h:mm')}</span>
                            <span className="truncate">{event.title}</span>
                          </div>
                        ))}
                        {hiddenCount > 0 && (
                          <span className="text-[10px] text-muted-foreground px-1 font-medium">
                            +{hiddenCount} more
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-blue-500" />
                  <span>Client Meetings</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded bg-emerald-500" />
                  <span>Booked via Link</span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Selected Day Events */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {selectedDate ? format(selectedDate, 'EEEE, MMMM d') : 'Select a day'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDayEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No meetings scheduled</div>
          ) : (
            <ScrollArea className="h-[400px]">
              <div className="space-y-3 pr-4">
                {selectedDayEvents
                  .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
                  .map(event => (
                    <button
                      key={event.id}
                      onClick={() => onMeetingClick?.(event.id, event.type)}
                      className={cn(
                        'w-full text-left p-3 rounded-lg border transition-all',
                        event.type === 'meeting'
                          ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-950/50'
                          : 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50'
                      )}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium text-sm">{event.title}</span>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          {event.status === 'completed' && (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 text-[10px] gap-0.5 px-1.5 py-0">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Done
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-xs">
                            {event.type === 'meeting' ? 'Client' : 'Booked'}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          <span>{format(event.startTime, 'h:mm a')} - {format(event.endTime, 'h:mm a')}</span>
                        </div>
                        {event.clientName && (
                          <div className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            <span>{event.clientName}</span>
                          </div>
                        )}
                        {event.guestName && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            <span>{event.guestName}</span>
                            {event.guestCompany && <span>({event.guestCompany})</span>}
                          </div>
                        )}
                        {event.meetingLink && (
                          <div className="flex items-center gap-1 text-primary">
                            <Video className="h-3 w-3" />
                            <span className="hover:underline">Join Meeting</span>
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
