import { useEffect, useMemo, useState } from 'react';
import { AddressAutocompleteInput } from '@/components/employees/form/AddressAutocompleteInput';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { JobTemplate, ScreeningCriteria, WorkDay, WORK_DAYS } from '@/lib/jobTypes';
import { LICENSE_TYPE_OPTIONS } from '@/components/employees/form/formTypes';
import {
  requiredLicensesForSkills,
  skillsRequireForkliftLicenses,
} from '@/components/employees/form/skillLicenseMap';
import { JobSkillsPicker } from '@/components/jobs/JobSkillsPicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createJob, getBackupPercentagePreference } from '@/lib/jobsApi';
import { fetchActiveClients } from '@/lib/activeClientsApi';
import { toast } from 'sonner';
import {
  Linkedin,
  Globe,
  Users,
  CalendarIcon,
  Clock,
  Loader2,
  Briefcase,
  DollarSign,
  Filter,
  Share2,
  IdCard,
} from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { useRecruitmentAgencyId } from '@/hooks/useRecruitmentAgencyId';
import type { ReactNode } from 'react';

/** Fixed skill-derived licenses + template certifications (forklift equipment is picked manually). */
function licensesFromSkillsAndCerts(
  skills: string[],
  certifications?: string[] | null,
): string[] {
  const fromSkills = requiredLicensesForSkills(skills);
  const fromCerts = (certifications ?? []).map((c) => c.trim()).filter(Boolean);
  return [...new Set([...fromSkills, ...fromCerts])];
}

function shouldRequireLicenses(skills: string[], licenseTypes: string[]): boolean {
  return licenseTypes.length > 0 || skillsRequireForkliftLicenses(skills);
}

function mergeLicenseTypes(current: string[], extras: string[]): string[] {
  return [...new Set([...current, ...extras])];
}

function JobFormSection({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Briefcase;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-xl border bg-muted/15 p-5 sm:p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {description ? (
          <p className="text-xs text-muted-foreground pl-6">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Jobs are created only for external employees / client placements. */
const JOB_TYPE = 'external' as const;

export type CreateJobDefaultActiveClient = {
  id: string;
  name: string;
  location: string;
};

interface CreateJobDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedTemplate?: JobTemplate | null;
  /** When set, Active Client is prefilled and the picker is locked. */
  defaultActiveClient?: CreateJobDefaultActiveClient | null;
}

export function CreateJobDialog({
  open,
  onOpenChange,
  selectedTemplate,
  defaultActiveClient = null,
}: CreateJobDialogProps) {
  const queryClient = useQueryClient();
  const { agencyId } = useRecruitmentAgencyId();
  const [saving, setSaving] = useState(false);
  const clientLocked = Boolean(defaultActiveClient);

  const { data: clientsResult } = useQuery({
    queryKey: ['active-clients', 'picker', agencyId ?? 'scope'],
    queryFn: () =>
      fetchActiveClients({
        status: 'active',
        pageSize: 200,
        agencyIds: agencyId ? [agencyId] : undefined,
      }),
    enabled: open,
  });

  const agencyClients = useMemo(() => clientsResult?.data ?? [], [clientsResult]);

  // License Requirement
  const [licenseRequired, setLicenseRequired] = useState(false);
  const [requiredLicenseTypes, setRequiredLicenseTypes] = useState<string[]>([]);

  const [title, setTitle] = useState(selectedTemplate?.name || '');
  const [clientId, setClientId] = useState(defaultActiveClient?.id ?? '');
  const [company, setCompany] = useState(defaultActiveClient?.name ?? '');
  const [location, setLocation] = useState(defaultActiveClient?.location ?? '');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState(selectedTemplate?.description || '');
  const [requirements, setRequirements] = useState('');
  const [responsibilities, setResponsibilities] = useState('');
  const [openPositions, setOpenPositions] = useState('1');
  const [employmentType, setEmploymentType] = useState<'full-time' | 'part-time' | 'contract' | 'temporary'>('full-time');
  const [payType, setPayType] = useState<'fixed' | 'range'>('range');
  const [salaryFixed, setSalaryFixed] = useState('');
  const [salaryMin, setSalaryMin] = useState('');
  const [salaryMax, setSalaryMax] = useState('');
  const [remoteOption, setRemoteOption] = useState<'onsite' | 'remote' | 'hybrid'>(
    selectedTemplate?.defaultScreeningCriteria.remoteOption || 'onsite'
  );

  // Shift Schedule
  const [shiftStartTime, setShiftStartTime] = useState('09:00');
  const [shiftEndTime, setShiftEndTime] = useState('17:00');
  const [workDays, setWorkDays] = useState<WorkDay[]>(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
  const [jobStartDate, setJobStartDate] = useState<Date>(new Date());
  const [jobEndDate, setJobEndDate] = useState<Date | undefined>();


  // Screening Criteria
  const [requiredSkills, setRequiredSkills] = useState<string[]>(
    selectedTemplate?.defaultScreeningCriteria.requiredSkills || []
  );
  const [minExperience, setMinExperience] = useState(
    selectedTemplate?.defaultScreeningCriteria.minExperienceYears?.toString() || '0'
  );
  const [educationLevel, setEducationLevel] = useState(
    selectedTemplate?.defaultScreeningCriteria.educationLevel || ''
  );

  // Publish Settings
  const [publishLinkedIn, setPublishLinkedIn] = useState(true);
  const [publishIndeed, setPublishIndeed] = useState(true);
  const [publishGlassdoor, setPublishGlassdoor] = useState(false);

  const applyDefaultClient = () => {
    if (defaultActiveClient) {
      setClientId(defaultActiveClient.id);
      setCompany(defaultActiveClient.name);
      setLocation(defaultActiveClient.location);
    } else {
      setClientId('');
      setCompany('');
      setLocation('');
    }
  };

  const defaultClientId = defaultActiveClient?.id ?? '';
  const defaultClientName = defaultActiveClient?.name ?? '';
  const defaultClientLocation = defaultActiveClient?.location ?? '';

  useEffect(() => {
    if (!open || !defaultClientId) return;
    setClientId(defaultClientId);
    setCompany(defaultClientName);
    setLocation(defaultClientLocation);
  }, [open, defaultClientId, defaultClientName, defaultClientLocation]);

  const resetForm = () => {
    const skills = selectedTemplate?.defaultScreeningCriteria.requiredSkills || [];
    const certifications = selectedTemplate?.defaultScreeningCriteria.certifications;
    const seededLicenses = licensesFromSkillsAndCerts(skills, certifications);

    setTitle(selectedTemplate?.name || '');
    applyDefaultClient();
    setDepartment('');
    setDescription(selectedTemplate?.description || '');
    setRequirements('');
    setResponsibilities('');
    setOpenPositions('1');
    setEmploymentType('full-time');
    setPayType('range');
    setSalaryFixed('');
    setSalaryMin('');
    setSalaryMax('');
    setRemoteOption(selectedTemplate?.defaultScreeningCriteria.remoteOption || 'onsite');
    setShiftStartTime('09:00');
    setShiftEndTime('17:00');
    setWorkDays(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
    setJobStartDate(new Date());
    setJobEndDate(undefined);
    setRequiredSkills(skills);
    setLicenseRequired(shouldRequireLicenses(skills, seededLicenses));
    setRequiredLicenseTypes(seededLicenses);
    setMinExperience(selectedTemplate?.defaultScreeningCriteria.minExperienceYears?.toString() || '0');
    setEducationLevel(selectedTemplate?.defaultScreeningCriteria.educationLevel || '');
    setPublishLinkedIn(true);
    setPublishIndeed(true);
    setPublishGlassdoor(false);
  };

  // Re-seed when the dialog opens or the chosen template changes (component stays mounted).
  useEffect(() => {
    if (!open) return;
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reseed on open / template id
  }, [open, selectedTemplate?.id]);

  const handleClientSelect = (id: string) => {
    setClientId(id);
    const client = agencyClients.find((c) => c.id === id);
    if (client) {
      setCompany(client.name);
      setLocation(client.location);
    }
  };

  const toggleWorkDay = (day: WorkDay) => {
    if (workDays.includes(day)) {
      setWorkDays(workDays.filter((d) => d !== day));
    } else {
      setWorkDays([...workDays, day]);
    }
  };

  const toggleRequiredLicenseType = (type: string) => {
    setRequiredLicenseTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  /** Fixed skill→license types auto-merge; Forklift Operator only turns on license Required. */
  const handleRequiredSkillsChange = (skills: string[]) => {
    setRequiredSkills(skills);
    const mapped = requiredLicensesForSkills(skills);
    const needsForklift = skillsRequireForkliftLicenses(skills);
    if (mapped.length === 0 && !needsForklift) return;
    setLicenseRequired(true);
    if (mapped.length > 0) {
      setRequiredLicenseTypes((prev) => mergeLicenseTypes(prev, mapped));
    }
  };

  const handleSubmit = async () => {
    if (!title.trim() || !clientId || !company.trim() || !location.trim()) {
      toast.error('Please fill in all required fields, including Active Client');
      return;
    }

    if (workDays.length === 0) {
      toast.error('Please select at least one work day');
      return;
    }

    if (licenseRequired && requiredLicenseTypes.length === 0) {
      toast.error('Select at least one required license type');
      return;
    }

    // Fixed price stores the same amount in both salary fields.
    const effSalaryMin =
      payType === 'fixed'
        ? (salaryFixed ? parseFloat(salaryFixed) : undefined)
        : (salaryMin ? parseFloat(salaryMin) : undefined);
    const effSalaryMax =
      payType === 'fixed'
        ? (salaryFixed ? parseFloat(salaryFixed) : undefined)
        : (salaryMax ? parseFloat(salaryMax) : undefined);

    if (
      payType === 'range' &&
      effSalaryMin != null &&
      effSalaryMax != null &&
      effSalaryMax < effSalaryMin
    ) {
      toast.error('Salary max must be greater than or equal to salary min');
      return;
    }

    const screeningCriteria: ScreeningCriteria = {
      requiredSkills,
      preferredSkills: [],
      minExperienceYears: parseInt(minExperience) || 0,
      educationLevel: educationLevel || undefined,
      certifications:
        licenseRequired && requiredLicenseTypes.length > 0
          ? requiredLicenseTypes
          : undefined,
      salaryMin: effSalaryMin,
      salaryMax: effSalaryMax,
      location,
      remoteOption,
    };

    setSaving(true);
    try {
      await createJob({
        templateId: selectedTemplate?.id,
        jobType: JOB_TYPE,
        title: title.trim(),
        company: company.trim(),
        activeClientId: clientId,
        location: location.trim(),
        department: department.trim() || undefined,
        description: description.trim(),
        requirements: requirements.trim(),
        responsibilities: responsibilities.trim(),
        openPositions: parseInt(openPositions) || 1,
        backupPercentage: getBackupPercentagePreference(),
        status: 'open',
        licenseRequired,
        requiredLicenseTypes: licenseRequired ? requiredLicenseTypes : [],
        screeningCriteria,
        publishSettings: {
          linkedin: publishLinkedIn,
          indeed: publishIndeed,
          glassdoor: publishGlassdoor,
        },
        shiftSchedule: {
          startTime: shiftStartTime,
          endTime: shiftEndTime,
          workDays,
          jobStartDate: jobStartDate.toISOString(),
          jobEndDate: jobEndDate?.toISOString() ?? null,
        },
        salaryMin: effSalaryMin,
        salaryMax: effSalaryMax,
        employmentType,
      });
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
      await queryClient.invalidateQueries({ queryKey: ['active-clients'] });
      if (clientId) {
        await queryClient.invalidateQueries({ queryKey: ['active-client', clientId] });
      }
      toast.success('Job created and published successfully');
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create job');
    } finally {
      setSaving(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-[min(100vw-1.5rem,72rem)] max-w-6xl h-[min(94vh,920px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="shrink-0 border-b px-6 py-5 text-left space-y-1.5">
          <DialogTitle className="text-xl flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-muted-foreground shrink-0" />
            {selectedTemplate
              ? `Create Job from "${selectedTemplate.name}" Template`
              : 'Create New Job'}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Fill in placement details, schedule, pay, and screening so recruiters can match employees quickly.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5 max-w-none">
            <Card className="p-4 border-primary/40 bg-primary/5 shadow-none">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-background border">
                  <Users className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">External employees</p>
                  <p className="text-sm text-muted-foreground">
                    Jobs are created for client placements only.
                  </p>
                </div>
              </div>
            </Card>

            <JobFormSection
              icon={Briefcase}
              title="Basic information"
              description="Title, client, location, and role details."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Job Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Warehouse Associate"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Active Client *</Label>
                  <Select
                    value={clientId || undefined}
                    onValueChange={handleClientSelect}
                    disabled={clientLocked}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select active client" />
                    </SelectTrigger>
                    <SelectContent>
                      {agencyClients.length === 0 && !clientLocked ? (
                        <SelectItem value="__none" disabled>
                          No active clients — add one first
                        </SelectItem>
                      ) : clientLocked && defaultActiveClient ? (
                        <SelectItem value={defaultActiveClient.id}>
                          {defaultActiveClient.name}
                        </SelectItem>
                      ) : (
                        agencyClients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="location">Location *</Label>
                  <AddressAutocompleteInput
                    value={location}
                    onChange={setLocation}
                    onPlaceSelected={() => {}}
                    placeholder="e.g., Toronto, ON"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Input
                    id="department"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    placeholder="e.g., Operations"
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="openPositions">Number of positions</Label>
                  <Input
                    id="openPositions"
                    type="number"
                    min="1"
                    value={openPositions}
                    onChange={(e) => setOpenPositions(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="employmentType">Employment type</Label>
                  <Select value={employmentType} onValueChange={(v) => setEmploymentType(v as any)}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full-time">Full-time</SelectItem>
                      <SelectItem value="part-time">Part-time</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="temporary">Temporary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-1">
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Job description…"
                    rows={4}
                    className="min-h-[110px] resize-y"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="requirements">Requirements</Label>
                  <Textarea
                    id="requirements"
                    value={requirements}
                    onChange={(e) => setRequirements(e.target.value)}
                    placeholder="Job requirements…"
                    rows={4}
                    className="min-h-[110px] resize-y"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="responsibilities">Responsibilities</Label>
                  <Textarea
                    id="responsibilities"
                    value={responsibilities}
                    onChange={(e) => setResponsibilities(e.target.value)}
                    placeholder="Job responsibilities…"
                    rows={4}
                    className="min-h-[110px] resize-y"
                  />
                </div>
              </div>
            </JobFormSection>

            <JobFormSection
              icon={Clock}
              title="Shift schedule"
              description="Work days, hours, and job start/end dates."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="shiftStartTime">Shift start time</Label>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      id="shiftStartTime"
                      type="time"
                      value={shiftStartTime}
                      onChange={(e) => setShiftStartTime(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="shiftEndTime">Shift end time</Label>
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                    <Input
                      id="shiftEndTime"
                      type="time"
                      value={shiftEndTime}
                      onChange={(e) => setShiftEndTime(e.target.value)}
                      className="h-11"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Work days</Label>
                <div className="flex flex-wrap gap-2">
                  {WORK_DAYS.map((day) => (
                    <Badge
                      key={day}
                      variant={workDays.includes(day) ? 'default' : 'outline'}
                      className="cursor-pointer px-3 py-1.5 text-sm"
                      onClick={() => toggleWorkDay(day)}
                    >
                      {day.slice(0, 3)}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Job start date *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'h-11 w-full justify-start text-left font-normal',
                          !jobStartDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {jobStartDate ? format(jobStartDate, 'PPP') : <span>Pick a date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={jobStartDate}
                        onSelect={(date) => date && setJobStartDate(date)}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="space-y-2">
                  <Label>Job end date (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          'h-11 w-full justify-start text-left font-normal',
                          !jobEndDate && 'text-muted-foreground'
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {jobEndDate ? format(jobEndDate, 'PPP') : <span>No end date</span>}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="p-2 border-b">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full"
                          onClick={() => setJobEndDate(undefined)}
                        >
                          Clear date
                        </Button>
                      </div>
                      <Calendar
                        mode="single"
                        selected={jobEndDate}
                        onSelect={setJobEndDate}
                        disabled={(date) => date < jobStartDate}
                        initialFocus
                        className="pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </JobFormSection>

            <JobFormSection
              icon={DollarSign}
              title="Compensation & work type"
              description="Pay structure and onsite / remote / hybrid."
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payType">Pay type</Label>
                  <Select value={payType} onValueChange={(v) => setPayType(v as 'fixed' | 'range')}>
                    <SelectTrigger id="payType" className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="range">Salary range</SelectItem>
                      <SelectItem value="fixed">Fixed price</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {payType === 'fixed' ? (
                  <div className="space-y-2 sm:col-span-1 lg:col-span-2">
                    <Label htmlFor="salaryFixed">Salary / rate</Label>
                    <Input
                      id="salaryFixed"
                      type="number"
                      value={salaryFixed}
                      onChange={(e) => setSalaryFixed(e.target.value)}
                      placeholder="e.g., 25 or 60000"
                      className="h-11"
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="salaryMin">Salary min</Label>
                      <Input
                        id="salaryMin"
                        type="number"
                        value={salaryMin}
                        onChange={(e) => setSalaryMin(e.target.value)}
                        placeholder="e.g., 50000"
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="salaryMax">Salary max</Label>
                      <Input
                        id="salaryMax"
                        type="number"
                        value={salaryMax}
                        onChange={(e) => setSalaryMax(e.target.value)}
                        placeholder="e.g., 80000"
                        className="h-11"
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="remoteOption">Work location</Label>
                  <Select value={remoteOption} onValueChange={(v) => setRemoteOption(v as any)}>
                    <SelectTrigger className="h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="onsite">On-site</SelectItem>
                      <SelectItem value="remote">Remote</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </JobFormSection>

            <JobFormSection
              icon={Filter}
              title="Screening criteria"
              description="Used to match employees to this job order."
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minExperience">Min experience (years)</Label>
                  <Input
                    id="minExperience"
                    type="number"
                    min="0"
                    value={minExperience}
                    onChange={(e) => setMinExperience(e.target.value)}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="educationLevel">Education level</Label>
                  <Select value={educationLevel} onValueChange={setEducationLevel}>
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High School">High School</SelectItem>
                      <SelectItem value="Associate's Degree">Associate&apos;s Degree</SelectItem>
                      <SelectItem value="Bachelor's Degree">Bachelor&apos;s Degree</SelectItem>
                      <SelectItem value="Master's Degree">Master&apos;s Degree</SelectItem>
                      <SelectItem value="PhD">PhD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Required skills</Label>
                <p className="text-xs text-muted-foreground">
                  Same skill list as employees — used for matching to job orders.
                </p>
                <JobSkillsPicker
                  selected={requiredSkills}
                  onChange={handleRequiredSkillsChange}
                  badgeVariant="default"
                  emptyLabel="Search and select required skills…"
                />
              </div>
            </JobFormSection>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <JobFormSection
                icon={Share2}
                title="Auto-publish to"
                description="Optional job boards when the job is created."
              >
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="linkedin"
                      checked={publishLinkedIn}
                      onCheckedChange={(checked) => setPublishLinkedIn(checked === true)}
                    />
                    <Label htmlFor="linkedin" className="flex items-center gap-2 cursor-pointer">
                      <Linkedin className="h-4 w-4 text-blue-600" />
                      LinkedIn
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="indeed"
                      checked={publishIndeed}
                      onCheckedChange={(checked) => setPublishIndeed(checked === true)}
                    />
                    <Label htmlFor="indeed" className="flex items-center gap-2 cursor-pointer">
                      <Globe className="h-4 w-4 text-purple-600" />
                      Indeed
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="glassdoor"
                      checked={publishGlassdoor}
                      onCheckedChange={(checked) => setPublishGlassdoor(checked === true)}
                    />
                    <Label htmlFor="glassdoor" className="flex items-center gap-2 cursor-pointer">
                      <Globe className="h-4 w-4 text-green-600" />
                      Glassdoor
                    </Label>
                  </div>
                </div>
              </JobFormSection>

              <JobFormSection
                icon={IdCard}
                title="License requirement"
                description="Gate employees who must hold specific licenses."
              >
                <div className="space-y-2">
                  <Label>Does this job require a license?</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={licenseRequired ? 'default' : 'outline'}
                      onClick={() => setLicenseRequired(true)}
                    >
                      Yes
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!licenseRequired ? 'default' : 'outline'}
                      onClick={() => {
                        setLicenseRequired(false);
                        setRequiredLicenseTypes([]);
                      }}
                    >
                      No
                    </Button>
                  </div>
                </div>
                {licenseRequired && (
                  <div className="space-y-2">
                    <Label>Required license types *</Label>
                    <div className="flex flex-wrap gap-2">
                      {LICENSE_TYPE_OPTIONS.map((type) => (
                        <Badge
                          key={type}
                          variant={requiredLicenseTypes.includes(type) ? 'default' : 'outline'}
                          className="cursor-pointer px-3 py-1.5"
                          onClick={() => toggleRequiredLicenseType(type)}
                        >
                          {type}
                        </Badge>
                      ))}
                    </div>
                    {requiredLicenseTypes.length === 0 && (
                      <p className="text-xs text-destructive">
                        Select at least one required license type
                      </p>
                    )}
                  </div>
                )}
              </JobFormSection>
            </div>
          </div>
        </div>

        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-10 px-5"
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving} className="h-10 px-5">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Job
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}