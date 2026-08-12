import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Paperclip, X, File, Plus, Trash2, Star, CheckCircle2, AlertCircle } from 'lucide-react';
import { Client, ClientContact } from '@/lib/types';
import { toast } from 'sonner';
import { createClient, updateClient, uploadDocument, checkClientAddressExists, fetchSettingsIndustries, createIndustryRequest, fetchSettingsJobTitles, createJobTitleRequest, fetchSettingsTags, syncSettingsFromClients, fetchClientFacets } from '@/lib/api';
import { AddressAutocompleteInput } from '@/components/employees/form/AddressAutocompleteInput';
import { useStore } from '@/lib/store';
import {
  ClientStorageContextBanner,
  formatClientCreatedToast,
  type ClientStorageContext,
} from '@/components/ClientStorageContextBanner';
import {
  describeClientFlow,
  isElevatedClientFlowConfig,
  type ClientFlowConfig,
} from '@/lib/clientDestinationFlow';

const CREATE_STEPS = ['Address', 'Company', 'Contacts', 'Attachments'] as const;
const EDIT_STEPS = ['Address', 'Company', 'Contacts'] as const;

/** Canadian provinces and territories for the dropdown. */
const CANADIAN_PROVINCES = [
  'Alberta',
  'British Columbia',
  'Manitoba',
  'New Brunswick',
  'Newfoundland and Labrador',
  'Northwest Territories',
  'Nova Scotia',
  'Nunavut',
  'Ontario',
  'Prince Edward Island',
  'Quebec',
  'Saskatchewan',
  'Yukon',
] as const;

/** Map common province/region codes or partial names to full province name. */
function normalizeProvinceFromSearch(region: string): string {
  if (!region?.trim()) return '';
  const r = region.trim();
  const codeMap: Record<string, string> = {
    AB: 'Alberta',
    BC: 'British Columbia',
    MB: 'Manitoba',
    NB: 'New Brunswick',
    NL: 'Newfoundland and Labrador',
    NT: 'Northwest Territories',
    NS: 'Nova Scotia',
    NU: 'Nunavut',
    ON: 'Ontario',
    PE: 'Prince Edward Island',
    QC: 'Quebec',
    SK: 'Saskatchewan',
    YT: 'Yukon',
  };
  const upper = r.toUpperCase();
  if (codeMap[upper]) return codeMap[upper];
  const match = CANADIAN_PROVINCES.find((p) => p.toLowerCase() === r.toLowerCase() || p.toLowerCase().startsWith(r.toLowerCase()));
  return match ?? r;
}

/** Format Canadian postal code: uppercase, space after 3rd character (A1A 1A1), max 7 chars. */
function formatCanadianPostalCode(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
  if (cleaned.length <= 3) return cleaned;
  return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
}

interface AddClientDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: 'create' | 'edit';
  client?: Client | null;
  /** Called after client and attachments are saved; use to refetch client list */
  onClientAdded?: () => void;
  /** Called when the request was queued for director approval (no client id yet) */
  onPendingSubmitted?: () => void;
  onClientUpdated?: () => void;
  onPendingEditSubmitted?: () => void;
  subCompanyId?: string;
  /** Role-aware flow from Settings → Approvals (agency, super user, or database manager). */
  clientFlowConfig?: ClientFlowConfig | null;
  destinationAgencies?: Array<{ id: string; name: string }>;
  /** Legacy fallback when clientFlowConfig is not loaded yet. */
  storageContext?: ClientStorageContext;
}

export function AddClientDialog({
  open,
  onOpenChange,
  mode = 'create',
  client = null,
  onClientAdded,
  onPendingSubmitted,
  onClientUpdated,
  onPendingEditSubmitted,
  subCompanyId,
  clientFlowConfig = null,
  destinationAgencies = [],
  storageContext,
}: AddClientDialogProps) {
  const isEditMode = mode === 'edit';
  const STEPS = isEditMode ? EDIT_STEPS : CREATE_STEPS;
  const currentSubCompany = useStore((s) => s.currentSubCompany);
  const elevatedConfig = isElevatedClientFlowConfig(clientFlowConfig) ? clientFlowConfig : null;
  const configMode = elevatedConfig?.destination;
  const agencyOnlyMode = configMode === 'agency';
  const bothMode = configMode === 'both';
  const [selectedAddDestination, setSelectedAddDestination] = useState<'global' | 'agency' | ''>('');
  const [selectedAgencyId, setSelectedAgencyId] = useState('');
  const agencyPath =
    agencyOnlyMode || (bothMode && selectedAddDestination === 'agency');
  const globalOnlyOrgMode = configMode === 'global';
  const isGlobalAdd =
    !isEditMode &&
    (globalOnlyOrgMode || (bothMode && selectedAddDestination === 'global'));
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(0);

  // Address
  const [unit, setUnit] = useState('');
  const [streetAddress, setStreetAddress] = useState('');
  const [city, setCity] = useState('');
  const [province, setProvince] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [checkingAddress, setCheckingAddress] = useState(false);

  // Basic info (step 2)
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [allowedIndustries, setAllowedIndustries] = useState<{ id: string; name: string; count: number }[]>([]);
  const [requestNewIndustryOpen, setRequestNewIndustryOpen] = useState(false);
  const [requestNewIndustryName, setRequestNewIndustryName] = useState('');
  const [requestingIndustry, setRequestingIndustry] = useState(false);
  const [allowedJobTitles, setAllowedJobTitles] = useState<{ id: string; name: string; count: number }[]>([]);
  const [requestNewJobTitleOpen, setRequestNewJobTitleOpen] = useState(false);
  const [requestNewJobTitleName, setRequestNewJobTitleName] = useState('');
  const [requestingJobTitle, setRequestingJobTitle] = useState(false);
  const [allowedTags, setAllowedTags] = useState<{ id: string; tag: string; count: number }[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const buildIndustryFallbackFromFacets = useCallback(
    async (opts?: { subCompanyId?: string }) => {
      try {
        const facets = await fetchClientFacets(opts);
        return facets.industries.map((name, index) => ({
          id: `facet-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name,
          count: 0,
        }));
      } catch {
        return [] as { id: string; name: string; count: number }[];
      }
    },
    [],
  );

  // Contacts
  const [contacts, setContacts] = useState<Array<Omit<ClientContact, 'clientId'> & { id?: string }>>([]);
  const [currentContact, setCurrentContact] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    phoneExtension: '',
    linkedin: '',
    website: '',
    isPrimary: false,
  });
  const [notOnLinkedIn, setNotOnLinkedIn] = useState(false);
  const [showCustomTitle, setShowCustomTitle] = useState(false);
  const [customTitle, setCustomTitle] = useState('');

  // Attachments
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  useEffect(() => {
    if (!open) return;
    if (!agencyPath || selectedAgencyId) return;
    if (subCompanyId && destinationAgencies.some((a) => a.id === subCompanyId)) {
      setSelectedAgencyId(subCompanyId);
      return;
    }
    if (destinationAgencies.length === 1) {
      setSelectedAgencyId(destinationAgencies[0].id);
    }
  }, [open, agencyPath, destinationAgencies, selectedAgencyId, subCompanyId]);

  useEffect(() => {
    if (!open) return;
    const effectiveSubCompanyId = agencyPath
      ? selectedAgencyId || undefined
      : (subCompanyId ?? currentSubCompany?.id);
    const opts = effectiveSubCompanyId ? { subCompanyId: effectiveSubCompanyId } : undefined;
    Promise.all([
      fetchSettingsIndustries(opts),
      fetchSettingsJobTitles(opts),
      fetchSettingsTags(opts),
    ])
      .then(async ([ind, job, tags]) => {
        let industriesData = ind.data;
        const allEmpty = ind.data.length === 0 && job.data.length === 0 && tags.data.length === 0;
        if (allEmpty) {
          try {
            await syncSettingsFromClients(opts);
            const [ind2, job2, tags2] = await Promise.all([
              fetchSettingsIndustries(opts),
              fetchSettingsJobTitles(opts),
              fetchSettingsTags(opts),
            ]);
            industriesData = ind2.data;
            setAllowedJobTitles(job2.data);
            setAllowedTags(tags2.data);
          } catch {
            industriesData = ind.data;
            setAllowedJobTitles(job.data);
            setAllowedTags(tags.data);
          }
        } else {
          industriesData = ind.data;
          setAllowedJobTitles(job.data);
          setAllowedTags(tags.data);
        }
        if (industriesData.length === 0) {
          industriesData = await buildIndustryFallbackFromFacets(opts);
        }
        setAllowedIndustries(industriesData);
      })
      .catch(() => {
        setAllowedIndustries([]);
        setAllowedJobTitles([]);
        setAllowedTags([]);
      });
  }, [open, agencyPath, selectedAgencyId, subCompanyId, currentSubCompany?.id, buildIndustryFallbackFromFacets]);

  // When contact has a title not in the allowed list (e.g. editing), show "Other" and sync customTitle
  useEffect(() => {
    if (
      step === 2 &&
      currentContact.title &&
      allowedJobTitles.length > 0 &&
      !allowedJobTitles.some((j) => j.name === currentContact.title)
    ) {
      setShowCustomTitle(true);
      setCustomTitle((prev) => prev || currentContact.title);
    }
  }, [step, currentContact.title, allowedJobTitles]);

  const handleRequestNewJobTitle = async () => {
    const name = requestNewJobTitleName.trim();
    if (!name) {
      toast.error('Enter job title');
      return;
    }
    setRequestingJobTitle(true);
    try {
      await createJobTitleRequest(name);
      setRequestNewJobTitleOpen(false);
      setRequestNewJobTitleName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit request');
    } finally {
      setRequestingJobTitle(false);
    }
  };

  const handleRequestNewIndustry = async () => {
    const name = requestNewIndustryName.trim();
    if (!name) {
      toast.error('Enter industry name');
      return;
    }
    setRequestingIndustry(true);
    try {
      await createIndustryRequest(name);
      setRequestNewIndustryOpen(false);
      setRequestNewIndustryName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to submit request');
    } finally {
      setRequestingIndustry(false);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    const maxSize = 20 * 1024 * 1024;
    const oversizedFiles = newFiles.filter((f) => f.size > maxSize);
    if (oversizedFiles.length > 0) {
      toast.error(`Files must be under 20MB: ${oversizedFiles.map((f) => f.name).join(', ')}`);
      return;
    }
    setUploadedFiles((prev) => [...prev, ...newFiles]);
    toast.success(`${newFiles.length} file(s) added`);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };
  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const handleAddContact = () => {
    if (!currentContact.name.trim() || !currentContact.email.trim()) {
      toast.error('Contact name and email are required');
      return;
    }
    const finalTitle = showCustomTitle ? customTitle : currentContact.title;
    if (!finalTitle.trim()) {
      toast.error('Job title is required');
      return;
    }
    if (!notOnLinkedIn && !currentContact.linkedin.trim()) {
      toast.error('LinkedIn profile is required (or check "Not on LinkedIn")');
      return;
    }
    const newContact = {
      id: crypto.randomUUID(),
      ...currentContact,
      title: finalTitle,
      isPrimary: contacts.length === 0 ? true : currentContact.isPrimary,
    };
    if (newContact.isPrimary) {
      setContacts((prev) => prev.map((c) => ({ ...c, isPrimary: false })));
    }
    setContacts((prev) => [...prev, newContact]);
    setCurrentContact({
      name: '',
      title: '',
      email: '',
      phone: '',
      phoneExtension: '',
      linkedin: '',
      website: '',
      isPrimary: false,
    });
    setNotOnLinkedIn(false);
    setShowCustomTitle(false);
    setCustomTitle('');
    toast.success('Contact added');
  };
  const removeContact = (index: number) => {
    setContacts((prev) => prev.filter((_, i) => i !== index));
  };
  const setPrimaryContact = (index: number) => {
    setContacts((prev) =>
      prev.map((c, i) => ({ ...c, isPrimary: i === index }))
    );
  };

  const addressValid = Boolean(
    streetAddress.trim() && city.trim() && province.trim() && postalCode.trim()
  );
  const companyStepValid = Boolean(
    name.trim() && industry.trim() && companySize.trim()
  );
  const contactsStepValid = Boolean(contacts.length >= 1);
  const handleNext = async () => {
    if (step === 0 && !addressValid) return;
    if (step === 1 && !companyStepValid) return;
    if (step === 2 && !contactsStepValid) return;
    if (step === 0 && !isEditMode) {
      const formattedPostal = formatCanadianPostalCode(postalCode);
      setPostalCode(formattedPostal);
      setCheckingAddress(true);
      try {
        const result = await checkClientAddressExists({
          unit: unit.trim() || undefined,
          streetAddress: streetAddress.trim(),
          city: city.trim(),
          region: province.trim(),
          postalCode: formattedPostal.trim(),
        });
        if (result.exists) {
          toast.error(
            result.clientName
              ? `This address already exists in the system (${result.clientName}). Please use a different address.`
              : 'This address already exists in the system. Please use a different address.'
          );
          return;
        }
      } catch {
        toast.error('Could not verify address. Please try again.');
        return;
      } finally {
        setCheckingAddress(false);
      }
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1);
  };

  const prefillFromClient = useCallback((source: Client) => {
    setStep(0);
    setName(source.name ?? '');
    setIndustry(source.industry ?? '');
    setCompanySize(source.companySize ?? '');
    setSelectedTags(source.tags ?? []);
    const [cityPart, provincePart] = (source.location || '').split(',').map((s) => s.trim());
    setCity(cityPart || '');
    setProvince(normalizeProvinceFromSearch(provincePart || ''));
    const addressParts = (source.address || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (addressParts.length >= 5) {
      setUnit(addressParts[0] ?? '');
      setStreetAddress(addressParts[1] ?? '');
      setPostalCode(addressParts[addressParts.length - 1] ?? '');
    } else if (addressParts.length >= 2) {
      setStreetAddress(addressParts[0] ?? '');
      setPostalCode(addressParts[addressParts.length - 1] ?? '');
    } else if (addressParts.length === 1) {
      setStreetAddress(addressParts[0] ?? '');
    } else {
      setStreetAddress('');
      setUnit('');
      setPostalCode('');
    }
    setContacts(
      (source.contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        title: c.title ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        phoneExtension: c.phoneExtension,
        linkedin: c.linkedin,
        website: c.website,
        isPrimary: c.isPrimary,
        isUnsubscribed: c.isUnsubscribed,
      })),
    );
    setUploadedFiles([]);
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Company name is required');
      return;
    }
    if (!industry.trim()) {
      toast.error('Industry is required');
      return;
    }
    if (!streetAddress.trim() || !city.trim() || !province.trim() || !postalCode.trim()) {
      toast.error('Address (street, city, province, postal code) is required');
      return;
    }
    if (!companySize.trim()) {
      toast.error('Company size is required');
      return;
    }
    if (contacts.length === 0) {
      toast.error('At least one contact is required');
      return;
    }
    if (bothMode && !isEditMode && !selectedAddDestination) {
      toast.error('Choose global database or agency for this client.');
      return;
    }
    if (agencyPath && !isEditMode && !selectedAgencyId) {
      toast.error('Select an agency for this client.');
      return;
    }

    setSubmitting(true);
    try {
      const formattedPostal = formatCanadianPostalCode(postalCode).trim();
      const fullAddress = [unit, streetAddress, city, province, formattedPostal]
        .filter(Boolean)
        .join(', ');

      const payload = {
        name: name.trim(),
        industry: industry.trim(),
        location: `${city}, ${province}`,
        address: fullAddress,
        companySize: companySize.trim(),
        tags: selectedTags.length > 0 ? selectedTags : undefined,
        contacts: contacts.map((c, i) => ({
          ...(c.id ? { id: c.id } : {}),
          name: c.name.trim(),
          title: c.title?.trim() || undefined,
          email: c.email?.trim() || undefined,
          phone: c.phone?.trim() || undefined,
          phoneExtension: c.phoneExtension?.trim() || undefined,
          linkedin: c.linkedin?.trim() || undefined,
          website: c.website?.trim() || undefined,
          isPrimary: i === 0,
        })),
        locationAddress: {
          unit: unit.trim() || undefined,
          streetAddress: streetAddress.trim() || undefined,
          city: city.trim() || undefined,
          region: province.trim() || undefined,
          postalCode: formattedPostal || undefined,
        },
        subCompanyId: isGlobalAdd
          ? undefined
          : agencyPath && !isEditMode
            ? selectedAgencyId || undefined
            : (subCompanyId ?? currentSubCompany?.id),
        databaseDestination:
          bothMode && !isEditMode && selectedAddDestination
            ? selectedAddDestination
            : globalOnlyOrgMode && !isEditMode
              ? 'global'
              : undefined,
      };

      if (isEditMode) {
        if (!client?.id) {
          toast.error('Client not found');
          return;
        }
        const updated = await updateClient(client.id, payload);
        if (updated.pendingEdit) {
          onPendingEditSubmitted?.();
          onClientUpdated?.();
          resetForm();
          onOpenChange(false);
          return;
        }
        toast.success(`Client "${updated.name}" updated successfully.`);
        onClientUpdated?.();
        resetForm();
        onOpenChange(false);
        return;
      }

      const created = await createClient(payload);

      if (created.pendingSubmission) {
        toast.success(created.message ?? `Submitted "${created.name}" for approval.`);
        onPendingSubmitted?.();
        onClientAdded?.();
        resetForm();
        onOpenChange(false);
        return;
      }

      if (!created.id) {
        toast.success(created.message ?? `Client "${name}" saved successfully.`);
        if (uploadedFiles.length > 0) {
          toast.info('Client was created, but attachments were skipped because no client id was returned.');
        }
        onClientAdded?.();
        resetForm();
        onOpenChange(false);
        return;
      }

      for (const file of uploadedFiles) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] ?? '' : result);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        await uploadDocument({
          clientId: created.id,
          name: file.name,
          fileBase64: base64,
          mimeType: file.type || undefined,
        });
      }

      toast.success(
        created.message ??
          (storageContext
            ? formatClientCreatedToast(name, storageContext)
            : uploadedFiles.length > 0
              ? `Client "${name}" and ${uploadedFiles.length} attachment(s) saved.`
              : `Client "${name}" added successfully!`),
      );
      onClientAdded?.();
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save client');
    } finally {
      setSubmitting(false);
    }
  };

  function resetForm() {
    setStep(0);
    setSelectedAgencyId('');
    setSelectedAddDestination('');
    setName('');
    setIndustry('');
    setCompanySize('');
    setSelectedTags([]);
    setUnit('');
    setStreetAddress('');
    setCity('');
    setProvince('');
    setPostalCode('');
    setContacts([]);
    setUploadedFiles([]);
  }

  const needsDestinationChoice = bothMode && !isEditMode;
  const needsAgencySelection = agencyPath && !isEditMode;
  const destinationSelected = !needsDestinationChoice || Boolean(selectedAddDestination);
  const agencySelected = !needsAgencySelection || Boolean(selectedAgencyId);

  const addDestinationSummary = useMemo(() => {
    if (!clientFlowConfig || isEditMode) return null;
    return describeClientFlow(clientFlowConfig, {
      flow: 'manual_add',
      selectedDestination: selectedAddDestination,
      selectedAgencyName: destinationAgencies.find((a) => a.id === selectedAgencyId)?.name,
    });
  }, [clientFlowConfig, isEditMode, selectedAddDestination, selectedAgencyId, destinationAgencies]);

  const addFlowNeedsChoice =
    (bothMode && !selectedAddDestination) || (agencyPath && !selectedAgencyId);

  const canGoNext =
    (step === 0 && addressValid && destinationSelected && agencySelected) ||
    (step === 1 && companyStepValid) ||
    (step === 2 && contactsStepValid);
  const isLastStep = step === STEPS.length - 1;

  useEffect(() => {
    if (!open) return;
    if (isEditMode && client) {
      prefillFromClient(client);
      return;
    }
    resetForm();
  }, [open, isEditMode, client, prefillFromClient]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>{isEditMode ? 'Edit Client' : 'Add New Client'}</DialogTitle>
          <DialogDescription>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </DialogDescription>
          <div className="flex gap-2 pt-2">
            {STEPS.map((label, i) => (
              <div
                key={label}
                className={`h-1.5 flex-1 rounded-full ${
                  i === step ? 'bg-primary' : i < step ? 'bg-primary/50' : 'bg-muted'
                }`}
                title={label}
              />
            ))}
          </div>
        </DialogHeader>

        {storageContext && !isEditMode && !clientFlowConfig && (
          <div className="px-6 pb-2 shrink-0">
            <ClientStorageContextBanner {...storageContext} />
          </div>
        )}

        {needsDestinationChoice && (
          <div className="px-6 pb-2 shrink-0">
            <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
              <p className="text-sm font-medium">Where should this client go?</p>
              <RadioGroup
                value={selectedAddDestination}
                onValueChange={(v) => {
                  setSelectedAddDestination(v as 'global' | 'agency');
                  if (v === 'global') setSelectedAgencyId('');
                }}
                className="space-y-2"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="global" id="add-dest-global" className="mt-0.5" />
                  <Label htmlFor="add-dest-global" className="font-normal cursor-pointer leading-snug">
                    Global database
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="agency" id="add-dest-agency" className="mt-0.5" />
                  <Label htmlFor="add-dest-agency" className="font-normal cursor-pointer leading-snug">
                    Agency (Client Visibility)
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </div>
        )}

        {needsAgencySelection && (
          <div className="px-6 pb-2 shrink-0">
            <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
              <Label htmlFor="add-client-agency-select" className="text-sm font-medium">
                Agency
              </Label>
              <Select value={selectedAgencyId} onValueChange={setSelectedAgencyId}>
                <SelectTrigger id="add-client-agency-select" className="max-w-sm">
                  <SelectValue placeholder="Select agency for this client…" />
                </SelectTrigger>
                <SelectContent>
                  {destinationAgencies.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {addDestinationSummary && (
          <div className="px-6 pb-2 shrink-0">
            <Alert variant={addFlowNeedsChoice ? 'destructive' : 'default'}>
              {addFlowNeedsChoice ? (
                <AlertCircle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <AlertDescription className="text-xs">{addDestinationSummary}</AlertDescription>
            </Alert>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Start typing a street address to get suggestions powered by Google Places.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit / Suite (optional)</Label>
                  <Input
                    id="unit"
                    placeholder="e.g., Suite 500"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  />
                </div>
                <div className="col-span-2 space-y-2">
                  <Label htmlFor="streetAddress">Street Address *</Label>
                  <AddressAutocompleteInput
                    value={streetAddress}
                    onChange={setStreetAddress}
                    onPlaceSelected={() => {}}
                    placeholder="e.g., 123 Main Street"
                    className="h-11"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input
                    id="city"
                    placeholder="e.g., San Francisco"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="province">Province *</Label>
                  <Select value={province || '__none__'} onValueChange={(v) => setProvince(v === '__none__' ? '' : v ?? '')}>
                    <SelectTrigger id="province">
                      <SelectValue placeholder="Select province" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select province</SelectItem>
                      {CANADIAN_PROVINCES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="postalCode">Postal Code *</Label>
                  <Input
                    id="postalCode"
                    placeholder="A1A 1A1"
                    value={postalCode}
                    onChange={(e) => setPostalCode(formatCanadianPostalCode(e.target.value))}
                    maxLength={7}
                  />
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Company Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., TechCorp Industries"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="industry">Industry *</Label>
                  <Select
                    value={(industry === '' ? '__none__' : industry) ?? '__none__'}
                    onValueChange={(v) => {
                      if (v === '__request_new__') {
                        setRequestNewIndustryOpen(true);
                        return;
                      }
                      setIndustry(v === '__none__' ? '' : v);
                    }}
                  >
                    <SelectTrigger id="industry">
                      <SelectValue placeholder="Select industry" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select industry</SelectItem>
                      {allowedIndustries.map((i) => (
                        <SelectItem key={i.id} value={i.name}>
                          {i.name}
                        </SelectItem>
                      ))}
                      <SelectItem value="__request_new__">Request new industry...</SelectItem>
                    </SelectContent>
                  </Select>
                  <Dialog open={requestNewIndustryOpen} onOpenChange={setRequestNewIndustryOpen}>
                    <DialogContent className="max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Request new industry</DialogTitle>
                        <DialogDescription>
                          Your request will be sent to an administrator. You can use this industry once it is approved.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="request-industry-name">Industry name</Label>
                          <Input
                            id="request-industry-name"
                            placeholder="e.g., FinTech"
                            value={requestNewIndustryName}
                            onChange={(e) => setRequestNewIndustryName(e.target.value)}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setRequestNewIndustryOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleRequestNewIndustry} disabled={requestingIndustry || !requestNewIndustryName.trim()}>
                          {requestingIndustry ? 'Submitting...' : 'Submit request'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="companySize">Company Size *</Label>
                  <Select value={companySize ?? '__none__'} onValueChange={(v) => setCompanySize(v === '__none__' ? '' : v ?? '')}>
                    <SelectTrigger id="companySize">
                      <SelectValue placeholder="Select size" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select size</SelectItem>
                      <SelectItem value="1-10 employees">1-10 employees</SelectItem>
                      <SelectItem value="11-50 employees">11-50 employees</SelectItem>
                      <SelectItem value="51-100 employees">51-100 employees</SelectItem>
                      <SelectItem value="101-500 employees">101-500 employees</SelectItem>
                      <SelectItem value="501-1000 employees">501-1000 employees</SelectItem>
                      <SelectItem value="1000+ employees">1000+ employees</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {allowedTags.length > 0 && (
                <div className="space-y-2">
                  <Label>Tags (optional)</Label>
                  <div className="flex flex-wrap gap-2">
                    {allowedTags.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTags.includes(t.tag)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedTags((prev) => [...prev, t.tag]);
                            else setSelectedTags((prev) => prev.filter((x) => x !== t.tag));
                          }}
                          className="rounded border-input"
                        />
                        <span className="text-sm">{t.tag}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Label>Contacts (add at least one)</Label>
              <div className="space-y-2">
                <Label htmlFor="contactName">Contact Name *</Label>
                <Input
                  id="contactName"
                  placeholder="e.g., John Doe"
                  value={currentContact.name}
                  onChange={(e) => setCurrentContact((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contactTitle">Job Title *</Label>
                <Select
                  value={
                    (showCustomTitle
                      ? '__other__'
                      : currentContact.title && allowedJobTitles.some((j) => j.name === currentContact.title)
                        ? currentContact.title
                        : currentContact.title
                          ? '__other__'
                          : '__none__') ?? '__none__'
                  }
                  onValueChange={(value) => {
                    if (value === '__request_new__') {
                      setRequestNewJobTitleOpen(true);
                      return;
                    }
                    if (value === '__other__') {
                      setShowCustomTitle(true);
                      setCurrentContact((prev) => ({ ...prev, title: customTitle || '' }));
                      return;
                    }
                    setShowCustomTitle(false);
                    setCustomTitle('');
                    setCurrentContact((prev) => ({ ...prev, title: value === '__none__' ? '' : value }));
                  }}
                >
                  <SelectTrigger id="contactTitle">
                    <SelectValue placeholder="Select job title" />
                  </SelectTrigger>
                  <SelectContent className="bg-background">
                    <SelectItem value="__none__">Select job title</SelectItem>
                    {allowedJobTitles.map((j) => (
                      <SelectItem key={j.id} value={j.name}>
                        {j.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="__request_new__">Request new job title...</SelectItem>
                    <SelectItem value="__other__">Other (enter below)</SelectItem>
                  </SelectContent>
                </Select>
                <Dialog open={requestNewJobTitleOpen} onOpenChange={setRequestNewJobTitleOpen}>
                  <DialogContent className="max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <DialogTitle>Request new job title</DialogTitle>
                      <DialogDescription>
                        Your request will be sent to an administrator. You can use this job title once it is approved.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="request-job-title-name">Job title</Label>
                        <Input
                          id="request-job-title-name"
                          placeholder="e.g., Chief of Staff"
                          value={requestNewJobTitleName}
                          onChange={(e) => setRequestNewJobTitleName(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setRequestNewJobTitleOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleRequestNewJobTitle} disabled={requestingJobTitle || !requestNewJobTitleName.trim()}>
                        {requestingJobTitle ? 'Submitting...' : 'Submit request'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              {showCustomTitle && (
                <div className="space-y-2">
                  <Label htmlFor="customTitle">Job Title (other) *</Label>
                  <Input
                    id="customTitle"
                    placeholder="Enter job title"
                    value={customTitle}
                    onChange={(e) => {
                      setCustomTitle(e.target.value);
                      setCurrentContact((prev) => ({ ...prev, title: e.target.value }));
                    }}
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Email *</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    placeholder="john@example.com"
                    value={currentContact.email}
                    onChange={(e) =>
                      setCurrentContact((prev) => ({ ...prev, email: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Phone</Label>
                  <div className="flex gap-2">
                    <Input
                      id="contactPhone"
                      placeholder="555-0123"
                      value={currentContact.phone}
                      onChange={(e) =>
                        setCurrentContact((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      className="flex-1"
                    />
                    <Input
                      id="contactPhoneExt"
                      placeholder="Ext"
                      value={currentContact.phoneExtension}
                      onChange={(e) =>
                        setCurrentContact((prev) => ({ ...prev, phoneExtension: e.target.value }))
                      }
                      className="w-20"
                    />
                  </div>
                </div>
              </div>
              {!notOnLinkedIn && (
                <div className="space-y-2">
                  <Label htmlFor="contactLinkedIn">LinkedIn Profile *</Label>
                  <Input
                    id="contactLinkedIn"
                    placeholder="https://linkedin.com/in/johndoe"
                    value={currentContact.linkedin}
                    onChange={(e) =>
                      setCurrentContact((prev) => ({ ...prev, linkedin: e.target.value }))
                    }
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="contactWebsite">Website</Label>
                <Input
                  id="contactWebsite"
                  placeholder="https://example.com"
                  value={currentContact.website}
                  onChange={(e) =>
                    setCurrentContact((prev) => ({ ...prev, website: e.target.value }))
                  }
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notOnLinkedIn"
                  checked={notOnLinkedIn}
                  onCheckedChange={(checked) => {
                    setNotOnLinkedIn(checked as boolean);
                    if (checked) setCurrentContact((prev) => ({ ...prev, linkedin: '' }));
                  }}
                />
                <Label htmlFor="notOnLinkedIn" className="text-sm font-normal cursor-pointer">
                  Not on LinkedIn
                </Label>
              </div>
              <Button type="button" onClick={handleAddContact} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Contact
              </Button>

              {contacts.length > 0 && (
                <div className="space-y-2">
                  <Label>Added Contacts ({contacts.length})</Label>
                  <div className="space-y-2">
                    {contacts.map((contact, index) => (
                      <Card key={index}>
                        <CardContent className="p-3">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-medium">{contact.name}</p>
                                {contact.isPrimary && (
                                  <Badge variant="secondary" className="text-xs">
                                    Primary
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">{contact.title}</p>
                              <p className="text-xs text-muted-foreground">{contact.email}</p>
                              {(contact.phone || contact.phoneExtension) && (
                                <p className="text-xs text-muted-foreground">
                                  {contact.phone}
                                  {contact.phoneExtension?.trim() && (
                                    <span className="ml-1">ext. {contact.phoneExtension.trim()}</span>
                                  )}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-1">
                              {!contact.isPrimary && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={() => setPrimaryContact(index)}
                                >
                                  <Star className="h-4 w-4" />
                                </Button>
                              )}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 p-0 text-destructive"
                                onClick={() => removeContact(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Attachments are optional. Add files if needed, then click Save.
              </p>
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                  isDragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/50'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
                <Paperclip className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop files here, or click to browse
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Select Files
                </Button>
                <p className="text-xs text-muted-foreground mt-2">Max 20MB per file</p>
              </div>
              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <Label>Uploaded Files ({uploadedFiles.length})</Label>
                  {uploadedFiles.map((file, index) => (
                    <Card key={index}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <File className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{file.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(file.size)}
                              </p>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-destructive"
                            onClick={() => removeFile(index)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isLastStep ? (
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                (needsDestinationChoice && !selectedAddDestination) ||
                (needsAgencySelection && !selectedAgencyId)
              }
            >
              {submitting ? 'Saving...' : 'Save'}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canGoNext || checkingAddress}>
              {checkingAddress ? 'Checking...' : 'Next'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
