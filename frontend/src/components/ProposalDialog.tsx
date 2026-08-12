import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Client, ProposalAttachment, PricingType, PaymentTerms, AgreementType, AgreementPricing } from '@/lib/types';
import { Upload, X, FileText, File, BookOpen, Loader2, Plus, Briefcase, Mail } from 'lucide-react';
import { fetchDefaultFilesForProposal, fetchClient, pandaDocGetTemplates, fetchProposalJobTitles, fetchProposalTypeTemplates, fetchReviewTemplates, type ProposalDefaultFile, type ReviewTemplate } from '@/lib/api';
import { useCanManageCallScripts, useCanWriteProposals } from '@/lib/access';
import { EmailRichTextEditor } from '@/components/EmailRichTextEditor';
import { toast } from 'sonner';
import { useActAs } from '@/hooks/useActAs';

interface ProposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lead's owning agency. When set, all template/default-file fetches inside the
   *  dialog target THIS agency, not the viewer's home agency. Required when an
   *  elevated user submits a proposal on behalf of another agency's lead. */
  leadSubCompanyId?: string;
  onSave: (data: {
    locationType: 'single' | 'multiple';
    selectedClients: string[];
    agreementTypes: AgreementType[];
    tempPricing?: AgreementPricing;
    directPricing?: AgreementPricing;
    paymentTerms: PaymentTerms;
    comment: string;
    clientMessage: string;
    isForReview: boolean;
    reviewTemplateId?: string;
    attachments: ProposalAttachment[];
    /** Raw files for uploading to server (same order as attachments) */
    attachmentFiles?: File[];
    selectedDefaultFileIds: string[];
    selectedContactId?: string;
    pandaDocTemplateId?: string;
    pandaDocTemplateName?: string;
    positions: { name: string; count: number }[];
  }) => void;
  onCancel: () => void;
  clients: Client[];
  currentClientId: string;
  isSubmitting?: boolean;
  initialValues?: ProposalDialogInitialValues;
}

export interface ProposalDialogInitialValues {
  agreementTypes?: AgreementType[];
  paymentTerms?: PaymentTerms;
  tempPricingType?: PricingType;
  tempPricingValue?: string;
  tempMinimumHours?: string;
  directPricingType?: PricingType;
  directPricingValue?: string;
  comment?: string;
  clientMessage?: string;
  selectedContactId?: string;
  selectedDefaultFileIds?: string[];
  positions?: { name: string; count: number }[];
}

export function ProposalDialog({
  open,
  onOpenChange,
  leadSubCompanyId,
  onSave,
  onCancel,
  clients,
  currentClientId,
  isSubmitting = false,
  initialValues,
}: ProposalDialogProps) {
  const canChangeTemplate = useCanManageCallScripts();
  const canWriteProposals = useCanWriteProposals();
  const actAs = useActAs();

  useEffect(() => {
    if (open && !canWriteProposals) {
      onOpenChange(false);
      toast.error('You do not have permission to create proposals');
    }
  }, [open, canWriteProposals, onOpenChange]);

  const { data: defaultFilesData } = useQuery({
    queryKey: ['proposal-default-files', leadSubCompanyId ?? null],
    queryFn: () => fetchDefaultFilesForProposal(leadSubCompanyId),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const defaultFiles: ProposalDefaultFile[] = defaultFilesData ?? [];

  // PandaDoc templates — agency-scoped via lead mapping
  const { data: pandaDocTemplates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['pandadoc-templates', leadSubCompanyId ?? null],
    queryFn: () => pandaDocGetTemplates({ subCompanyId: leadSubCompanyId }),
    staleTime: 5 * 60 * 1000,
    enabled: open && !!leadSubCompanyId,
  });

  const { data: reviewTemplates = [] } = useQuery<ReviewTemplate[]>({
    queryKey: ['review-templates', leadSubCompanyId ?? null],
    queryFn: () => fetchReviewTemplates(leadSubCompanyId),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // Job titles for position options
  const { data: jobTitles = [] } = useQuery({
    queryKey: ['proposal-job-titles'],
    queryFn: fetchProposalJobTitles,
    staleTime: 10 * 60 * 1000,
    enabled: open,
  });

  // Proposal type → template mapping from settings
  const { data: typeTemplates } = useQuery({
    queryKey: ['proposal-type-templates', leadSubCompanyId ?? null],
    queryFn: () => fetchProposalTypeTemplates(leadSubCompanyId),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  // Fetch current client contacts.
  // Include actAs.userId in the key so switching act-as user busts the cache
  // (contacts are scoped to the effective actor — a stale cache from Ramish's
  // session would have contacts:[] for Noah's clients, then never refetch).
  const { data: currentClientData } = useQuery({
    queryKey: ['client', currentClientId, actAs.isActive ? actAs.userId : null],
    queryFn: () => fetchClient(currentClientId),
    enabled: open && !!currentClientId,
    staleTime: 2 * 60 * 1000,
  });
  const clientContacts = (currentClientData?.contacts ?? []).filter((c) => !c.isUnsubscribed && c.email);

  const [locationType, setLocationType] = useState<'single' | 'multiple'>('single');
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [selectedAgreementTypes, setSelectedAgreementTypes] = useState<AgreementType[]>([]);
  // Temp pricing state
  const [tempPricingType, setTempPricingType] = useState<PricingType>('markup');
  const [tempPricingValue, setTempPricingValue] = useState<string>('');
  const [tempMinimumHours, setTempMinimumHours] = useState<string>('480');
  
  // Direct pricing state
  const [directPricingType, setDirectPricingType] = useState<PricingType>('markup');
  const [directPricingValue, setDirectPricingValue] = useState<string>('');
  
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>('net_30');
  const [clientMessage, setClientMessage] = useState('');
  const [isForReview, setIsForReview] = useState(false);
  const [selectedReviewTemplateId, setSelectedReviewTemplateId] = useState<string>('');
  const [comment, setComment] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [attachments, setAttachments] = useState<ProposalAttachment[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [selectedDefaultFileIds, setSelectedDefaultFileIds] = useState<Set<string>>(new Set());
  const [selectedPandaDocTemplateId, setSelectedPandaDocTemplateId] = useState<string>('');
  const [positions, setPositions] = useState<{ name: string; count: number }[]>([]);
  const [positionDraft, setPositionDraft] = useState<string>('');
  const [positionCountDraft, setPositionCountDraft] = useState<string>('1');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Apply initialValues when dialog opens (Submit Again resubmit flow)
  useEffect(() => {
    if (open && initialValues) {
      if (initialValues.agreementTypes)     setSelectedAgreementTypes(initialValues.agreementTypes);
      if (initialValues.paymentTerms)       setPaymentTerms(initialValues.paymentTerms);
      if (initialValues.tempPricingType)    setTempPricingType(initialValues.tempPricingType);
      if (initialValues.tempPricingValue)   setTempPricingValue(initialValues.tempPricingValue);
      if (initialValues.tempMinimumHours)   setTempMinimumHours(initialValues.tempMinimumHours);
      if (initialValues.directPricingType)  setDirectPricingType(initialValues.directPricingType);
      if (initialValues.directPricingValue) setDirectPricingValue(initialValues.directPricingValue);
      if (initialValues.comment)            setComment(initialValues.comment);
      if (initialValues.clientMessage)      setClientMessage(initialValues.clientMessage);
      if (initialValues.selectedContactId)  setSelectedContactId(initialValues.selectedContactId);
      if (initialValues.selectedDefaultFileIds) setSelectedDefaultFileIds(new Set(initialValues.selectedDefaultFileIds));
      if (initialValues.positions)          setPositions(initialValues.positions);
    }
  }, [open, initialValues]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-select all default files when dialog opens (skip if initialValues provides its own selection)
  useEffect(() => {
    if (open && defaultFiles.length > 0 && !initialValues?.selectedDefaultFileIds) {
      setSelectedDefaultFileIds(new Set(defaultFiles.map((f) => f.id)));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select primary contact when contacts load (skip if initialValues set one)
  useEffect(() => {
    if (clientContacts.length > 0 && !selectedContactId) {
      const primary = clientContacts.find((c) => c.isPrimary) ?? clientContacts[0];
      setSelectedContactId(primary.id);
    }
  }, [clientContacts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select PandaDoc template based on agreement type mapping.
  // Both uses Temp + Direct templates server-side (not the legacy combined Both template).
  useEffect(() => {
    if (!typeTemplates) return;
    if (selectedAgreementTypes.length === 2) {
      // Backend stamps temp + direct; clear single picker so FE does not send bothTemplateId
      setSelectedPandaDocTemplateId('');
    } else if (selectedAgreementTypes.length === 1) {
      const type = selectedAgreementTypes[0];
      if (type === 'temp' && typeTemplates.tempTemplateId) {
        setSelectedPandaDocTemplateId(typeTemplates.tempTemplateId);
      } else if (type === 'direct_placement' && typeTemplates.directTemplateId) {
        setSelectedPandaDocTemplateId(typeTemplates.directTemplateId);
      }
    }
  }, [selectedAgreementTypes.join(','), typeTemplates?.tempTemplateId, typeTemplates?.directTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stamp the active review template for single-type review submits.
  // Both review stamps Temp + Direct templates on the server.
  useEffect(() => {
    if (!isForReview) {
      setSelectedReviewTemplateId('');
      return;
    }
    const hasTemp = selectedAgreementTypes.includes('temp');
    const hasDirect = selectedAgreementTypes.some((t) => t.startsWith('direct'));
    if (hasTemp && hasDirect) {
      setSelectedReviewTemplateId('');
      return;
    }
    const slot = hasTemp ? 'temp_agreement' : hasDirect ? 'direct_placement' : null;
    const tpl = slot ? reviewTemplates.find((t) => t.documentType === slot) : null;
    setSelectedReviewTemplateId(tpl?.id ?? '');
  }, [isForReview, selectedAgreementTypes.join(','), reviewTemplates]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter out the current client and apply search
  const availableClients = clients
    .filter(c => c.id !== currentClientId)
    .filter(c => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return (
        c.name.toLowerCase().includes(search) ||
        c.address.toLowerCase().includes(search) ||
        c.location.toLowerCase().includes(search)
      );
    });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newFiles = Array.from(files);
    const newAttachments: ProposalAttachment[] = newFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
    }));

    setAttachments(prev => [...prev, ...newAttachments]);
    setAttachmentFiles(prev => [...prev, ...newFiles]);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    const index = attachments.findIndex(a => a.id === id);
    if (index === -1) return;
    setAttachments(prev => prev.filter(a => a.id !== id));
    setAttachmentFiles(prev => prev.filter((_, i) => i !== index));
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  const toggleAgreementType = (type: AgreementType) => {
    setSelectedAgreementTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const handleSave = () => {
    const tempPricing: AgreementPricing | undefined = selectedAgreementTypes.includes('temp') 
      ? {
          pricingType: tempPricingType,
          pricingValue: parseFloat(tempPricingValue) || 0,
          minimumHours: parseInt(tempMinimumHours) || 480,
        }
      : undefined;

    const directPricing: AgreementPricing | undefined = selectedAgreementTypes.includes('direct_placement')
      ? {
          pricingType: directPricingType,
          pricingValue: parseFloat(directPricingValue) || 0,
        }
      : undefined;

    onSave({
      locationType,
      selectedClients: locationType === 'multiple' ? selectedClients : [],
      agreementTypes: selectedAgreementTypes,
      tempPricing,
      directPricing,
      paymentTerms,
      comment,
      clientMessage,
      isForReview,
      reviewTemplateId: isForReview && selectedReviewTemplateId ? selectedReviewTemplateId : undefined,
      attachments,
      attachmentFiles: attachmentFiles.length > 0 ? attachmentFiles : undefined,
      selectedDefaultFileIds: [...selectedDefaultFileIds],
      selectedContactId: selectedContactId || undefined,
      pandaDocTemplateId: selectedPandaDocTemplateId || undefined,
      pandaDocTemplateName: selectedPandaDocTemplateId
        ? pandaDocTemplates.find((t) => t.id === selectedPandaDocTemplateId)?.name
        : undefined,
      positions,
    });
    handleClose();
  };

  const handleCancel = () => {
    onCancel();
    handleClose();
  };

  const handleClose = () => {
    setLocationType('single');
    setSelectedClients([]);
    setSelectedAgreementTypes([]);
    setTempPricingType('markup');
    setTempPricingValue('');
    setTempMinimumHours('480');
    setDirectPricingType('markup');
    setDirectPricingValue('');
    setPaymentTerms('net_30');
    setClientMessage('');
    setIsForReview(false);
    setSelectedReviewTemplateId('');
    setComment('');
    setSearchTerm('');
    setAttachments([]);
    setAttachmentFiles([]);
    setSelectedDefaultFileIds(new Set());
    setSelectedPandaDocTemplateId('');
    setSelectedContactId('');
    setPositions([]);
    setPositionDraft('');
    setPositionCountDraft('1');
    onOpenChange(false);
  };

  const toggleClient = (clientId: string) => {
    setSelectedClients(prev =>
      prev.includes(clientId)
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    );
  };

  const isSaveDisabled = selectedAgreementTypes.length === 0 || isSubmitting;

  const selectedContact = clientContacts.find((c) => c.id === selectedContactId);

  if (!canWriteProposals) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] w-full h-[90vh] overflow-hidden flex flex-col gap-0 p-0">

        {/* ── Header ── */}
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle>Proposal Details</DialogTitle>
          <DialogDescription>
            Compose your message on the left and complete the proposal settings on the right.
          </DialogDescription>
        </DialogHeader>

        {/* ── Two-panel body ── */}
        <div className="flex flex-1 min-h-0">

          {/* ════ LEFT PANEL — Message Composer ════ */}
          <div className="w-[44%] shrink-0 border-r flex flex-col bg-slate-50/30">

            {/* Panel header */}
            <div className="px-4 py-3 border-b shrink-0 flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-md bg-blue-50 flex items-center justify-center shrink-0">
                <Mail className="h-3.5 w-3.5 text-blue-500" />
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight">Message to Client</p>
                <p className="text-xs text-muted-foreground">Included in the proposal email</p>
              </div>
            </div>

            {/* Recipient bar */}
            <div className="px-4 py-2 border-b bg-white shrink-0 flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-6 shrink-0">To:</span>
              {selectedContact ? (
                <span className="text-sm font-medium bg-slate-100 border border-slate-200 rounded px-2.5 py-0.5 truncate">
                  {selectedContact.name}
                  {selectedContact.email ? ` <${selectedContact.email}>` : ''}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground italic">
                  Select a contact on the right to populate recipient
                </span>
              )}
            </div>

            {/* Rich text editor — stretches to fill remaining panel height */}
            <div className="flex-1 min-h-0 flex flex-col">
              <EmailRichTextEditor
                value={clientMessage}
                onChange={setClientMessage}
                placeholder="Write your message to the client…"
                stretch
              />
            </div>

          </div>{/* /left-panel */}

          {/* ════ RIGHT PANEL — Form Fields ════ */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* Location Type */}
            <div className="space-y-3">
              <Label>Location Type</Label>
              <RadioGroup
                value={locationType}
                onValueChange={(value) => setLocationType(value as 'single' | 'multiple')}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="single" id="single" />
                  <Label htmlFor="single" className="font-normal cursor-pointer">Single Location</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="multiple" id="multiple" />
                  <Label htmlFor="multiple" className="font-normal cursor-pointer">Multiple Locations</Label>
                </div>
              </RadioGroup>
            </div>

            {locationType === 'multiple' && (
              <div className="space-y-3">
                <Label>Select Additional Locations</Label>
                <Input
                  placeholder="Search by name, address, or location..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="mb-2"
                />
                <ScrollArea className="h-[150px] rounded-md border p-4">
                  {availableClients.length === 0 ? (
                    <div className="text-sm text-muted-foreground text-center py-8">
                      {searchTerm ? 'No matching clients found' : 'No other clients available'}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {availableClients.map((client) => (
                        <div
                          key={client.id}
                          className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                        >
                          <Checkbox
                            id={client.id}
                            checked={selectedClients.includes(client.id)}
                            onCheckedChange={() => toggleClient(client.id)}
                          />
                          <div className="flex-1 space-y-1">
                            <Label htmlFor={client.id} className="font-medium cursor-pointer">
                              {client.name}
                            </Label>
                            <div className="text-sm text-muted-foreground">
                              <div>{client.address}</div>
                              <div>{client.location}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                {selectedClients.length > 0 && (
                  <div className="text-sm text-muted-foreground">
                    {selectedClients.length} location{selectedClients.length !== 1 ? 's' : ''} selected
                  </div>
                )}
              </div>
            )}

            {/* Client Contact Selection */}
            <div className="space-y-2">
              <Label>Send To (Client Contact)</Label>
              {clientContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground border rounded-lg p-3">
                  No contacts with email addresses found for this client.
                </p>
              ) : (
                <Select value={selectedContactId} onValueChange={setSelectedContactId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a contact..." />
                  </SelectTrigger>
                  <SelectContent>
                    {clientContacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.name}{contact.isPrimary ? ' (Primary)' : ''}{contact.title ? ` — ${contact.title}` : ''} · {contact.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Agreement Type */}
            <div className="space-y-3">
              <Label>Agreement Type (select one or both)</Label>
              <p className="text-xs text-muted-foreground">
                Selecting both prepares two separate agreements (Temporary and Direct Placement) — not one combined document.
              </p>
              <div className="space-y-3">
                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="temp"
                    checked={selectedAgreementTypes.includes('temp')}
                    onCheckedChange={() => toggleAgreementType('temp')}
                  />
                  <Label htmlFor="temp" className="font-normal cursor-pointer">
                    Temporary / Temporary to Permanent Staffing Agreement
                  </Label>
                </div>
                <div className="flex items-start space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors">
                  <Checkbox
                    id="direct_placement"
                    checked={selectedAgreementTypes.includes('direct_placement')}
                    onCheckedChange={() => toggleAgreementType('direct_placement')}
                  />
                  <Label htmlFor="direct_placement" className="font-normal cursor-pointer">
                    Direct Placement Agreement
                  </Label>
                </div>
              </div>
            </div>

            {/* PandaDoc Template */}
            {selectedAgreementTypes.length > 0 && (
              <div className="space-y-2">
                <Label>
                  {selectedAgreementTypes.length === 2 ? 'Documents the client will receive' : 'PandaDoc Template'}
                </Label>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading templates...
                  </div>
                ) : selectedAgreementTypes.length === 2 ? (
                  <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm space-y-2">
                    <p className="text-muted-foreground">
                      Both selected — the client gets <strong className="text-foreground">two separate agreements</strong> (not one combined file):
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span>
                          <span className="font-medium">Temporary / Temp-to-Perm</span>
                          <span className="text-muted-foreground">
                            {' — '}
                            {typeTemplates?.tempTemplateName
                              || (typeTemplates?.tempTemplateId
                                ? (pandaDocTemplates.find((t) => t.id === typeTemplates.tempTemplateId)?.name ?? 'Temp template')
                                : 'not configured in Settings')}
                          </span>
                        </span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="mt-0.5 h-1.5 w-1.5 rounded-full bg-purple-500 shrink-0" />
                        <span>
                          <span className="font-medium">Direct Placement</span>
                          <span className="text-muted-foreground">
                            {' — '}
                            {typeTemplates?.directTemplateName
                              || (typeTemplates?.directTemplateId
                                ? (pandaDocTemplates.find((t) => t.id === typeTemplates.directTemplateId)?.name ?? 'Direct template')
                                : 'not configured in Settings')}
                          </span>
                        </span>
                      </li>
                    </ul>
                    {(!typeTemplates?.tempTemplateId || !typeTemplates?.directTemplateId) && (
                      <p className="text-xs text-amber-700">
                        Set both Temp and Direct templates in Settings → Proposal Templates before submitting.
                      </p>
                    )}
                    {isForReview && (
                      <p className="text-xs text-muted-foreground">
                        Review Only: client gets two emails with filled PDFs (no signing links).
                      </p>
                    )}
                  </div>
                ) : pandaDocTemplates.length === 0 ? (
                  <p className="text-sm text-muted-foreground border rounded-lg p-3">
                    No PandaDoc templates available.
                  </p>
                ) : canChangeTemplate ? (
                  <>
                    <Select value={selectedPandaDocTemplateId} onValueChange={setSelectedPandaDocTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a PandaDoc template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {pandaDocTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!selectedPandaDocTemplateId && typeTemplates && (
                      <p className="text-xs text-muted-foreground">
                        No default template configured for this agreement type. You can set one in Settings → Proposal Templates.
                      </p>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    {selectedPandaDocTemplateId
                      ? (pandaDocTemplates.find((t) => t.id === selectedPandaDocTemplateId)?.name ?? selectedPandaDocTemplateId)
                      : <span className="text-muted-foreground">No template assigned for this type.</span>
                    }
                  </div>
                )}
              </div>
            )}

            {/* Temp Pricing */}
            {selectedAgreementTypes.includes('temp') && (
              <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
                <h4 className="font-medium">Temporary / Temporary to Permanent Pricing</h4>
                <div className="space-y-3">
                  <Label>Pricing</Label>
                  <div className="flex gap-3">
                    <Select value={tempPricingType} onValueChange={(value) => setTempPricingType(value as PricingType)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="markup">Markup (%)</SelectItem>
                        <SelectItem value="bill_rate">Bill Rate ($)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {tempPricingType === 'markup' ? '%' : '$'}
                      </span>
                      <Input
                        type="number"
                        placeholder={tempPricingType === 'markup' ? 'Enter markup percentage' : 'Enter bill rate'}
                        value={tempPricingValue}
                        onChange={(e) => setTempPricingValue(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Minimum Hours for Temp to Permanent</Label>
                  <Input
                    type="number"
                    placeholder="Enter minimum hours"
                    value={tempMinimumHours}
                    onChange={(e) => setTempMinimumHours(e.target.value)}
                    min={480}
                  />
                  <p className="text-xs text-muted-foreground">
                    Minimum number of hours for temp to permanent is 480.
                  </p>
                </div>
              </div>
            )}

            {/* Direct Pricing */}
            {selectedAgreementTypes.includes('direct_placement') && (
              <div className="space-y-4 p-4 rounded-lg border bg-muted/30">
                <h4 className="font-medium">Direct Placement Pricing</h4>
                <div className="space-y-3">
                  <Label>Pricing</Label>
                  <div className="flex gap-3">
                    <Select value={directPricingType} onValueChange={(value) => setDirectPricingType(value as PricingType)}>
                      <SelectTrigger className="w-[160px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="markup">Markup (%)</SelectItem>
                        <SelectItem value="bill_rate">Bill Rate ($)</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {directPricingType === 'markup' ? '%' : '$'}
                      </span>
                      <Input
                        type="number"
                        placeholder={directPricingType === 'markup' ? 'Enter markup percentage' : 'Enter bill rate'}
                        value={directPricingValue}
                        onChange={(e) => setDirectPricingValue(e.target.value)}
                        className="pl-8"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Terms */}
            <div className="space-y-3">
              <Label>Payment Terms</Label>
              <Select value={paymentTerms} onValueChange={(value) => setPaymentTerms(value as PaymentTerms)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="net_7">Net 7</SelectItem>
                  <SelectItem value="net_15">Net 15</SelectItem>
                  <SelectItem value="net_30">Net 30</SelectItem>
                  <SelectItem value="net_45">Net 45</SelectItem>
                  <SelectItem value="net_60">Net 60</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Send for Review */}
            {(() => {
              const hasTemp   = selectedAgreementTypes.includes('temp');
              const hasDirect = selectedAgreementTypes.some((t) => t.startsWith('direct'));
              const isBoth = hasTemp && hasDirect;
              const tempTpl = reviewTemplates.find((t) => t.documentType === 'temp_agreement');
              const directTpl = reviewTemplates.find((t) => t.documentType === 'direct_placement');
              const slot = isBoth ? 'both_pair' : hasTemp ? 'temp_agreement' : hasDirect ? 'direct_placement' : null;
              const noTemplate = isBoth
                ? !(tempTpl && directTpl)
                : slot !== null && !reviewTemplates.find((t) => t.documentType === slot);
              return (
                <div className={`rounded-lg border p-4 transition-colors ${isForReview ? 'bg-amber-50/60 border-amber-300' : 'bg-muted/20'}`}>
                  <div className="flex items-start space-x-3">
                    <Checkbox
                      id="isForReview"
                      checked={isForReview}
                      disabled={noTemplate}
                      onCheckedChange={(checked) => { setIsForReview(Boolean(checked)); }}
                      className="mt-0.5"
                    />
                    <div className="space-y-1 flex-1">
                      <Label htmlFor="isForReview" className={`font-medium cursor-pointer flex items-center gap-2 ${noTemplate ? 'opacity-50' : ''}`}>
                        <Mail className="h-4 w-4 text-amber-600" />
                        Send for Review Only (no PandaDoc signing)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {noTemplate
                          ? isBoth
                            ? "Director hasn't uploaded both Temp and Direct review templates yet."
                            : "Director hasn't uploaded a review template for this agreement type yet."
                          : isForReview
                            ? isBoth
                              ? 'Manager will approve and send two separate review emails (Temp + Direct). No signing links are issued.'
                              : 'Manager will approve and send a filled agreement to the client by email. No signing link is issued.'
                            : 'Check this if you want the client to receive a preview of the agreement before the formal signing step.'}
                      </p>
                      {isForReview && slot && (
                        <p className="text-xs text-amber-700 mt-2 italic">
                          {isBoth
                            ? 'Two filled PDFs will be emailed separately — one Temporary and one Direct Placement.'
                            : 'The system will send a filled PDF to the client based on your selected agreement type.'}
                        </p>
                      )}
                      {isForReview && !slot && (
                        <p className="text-xs text-amber-700 mt-2 italic">
                          Select an agreement type above to see which document will be sent.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Positions */}
            <div className="space-y-3">
              <Label className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                Positions
              </Label>
              <p className="text-xs text-muted-foreground -mt-1">
                Add the positions and the number of workers needed for each.
              </p>
              <div className="flex gap-2">
                <Select value={positionDraft} onValueChange={setPositionDraft}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select a position..." />
                  </SelectTrigger>
                  <SelectContent>
                    {jobTitles.map((jt) => (
                      <SelectItem key={jt.id} value={jt.name}>{jt.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={positionCountDraft}
                  onChange={(e) => setPositionCountDraft(e.target.value)}
                  className="w-20"
                  placeholder="Qty"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!positionDraft}
                  onClick={() => {
                    const count = Math.max(1, parseInt(positionCountDraft) || 1);
                    setPositions((prev) => {
                      const existing = prev.findIndex((p) => p.name === positionDraft);
                      if (existing !== -1) {
                        const updated = [...prev];
                        updated[existing] = { name: positionDraft, count };
                        return updated;
                      }
                      return [...prev, { name: positionDraft, count }];
                    });
                    setPositionDraft('');
                    setPositionCountDraft('1');
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {positions.length > 0 && (
                <div className="space-y-2">
                  {positions.map((pos) => (
                    <div key={pos.name} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                      <span className="text-sm font-medium">{pos.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">×{pos.count}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPositions((prev) => prev.filter((p) => p.name !== pos.name))}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Default files */}
            {defaultFiles.length > 0 && (
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  Default Proposal Files
                </Label>
                <p className="text-xs text-muted-foreground -mt-1">
                  Select which default files to include with this proposal for manager review.
                </p>
                <div className="space-y-2">
                  {defaultFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
                      onClick={() =>
                        setSelectedDefaultFileIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(file.id)) next.delete(file.id);
                          else next.add(file.id);
                          return next;
                        })
                      }
                    >
                      <Checkbox
                        id={`df-${file.id}`}
                        checked={selectedDefaultFileIds.has(file.id)}
                        onCheckedChange={() =>
                          setSelectedDefaultFileIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(file.id)) next.delete(file.id);
                            else next.add(file.id);
                            return next;
                          })
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {file.mimeType?.includes('pdf') ? (
                          <FileText className="h-4 w-4 text-red-500 shrink-0" />
                        ) : (
                          <File className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <Label
                          htmlFor={`df-${file.id}`}
                          className="text-sm font-normal cursor-pointer truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {file.name}
                        </Label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attachments */}
            <div className="space-y-3">
              <Label>Attachments</Label>
              <div
                className="border-2 border-dashed rounded-lg p-6 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Click to upload files or drag and drop</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, Images</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif"
                />
              </div>
              {attachments.length > 0 && (
                <div className="space-y-2 mt-3">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                    >
                      <div className="flex items-center gap-3">
                        {getFileIcon(attachment.type)}
                        <div>
                          <p className="text-sm font-medium truncate max-w-[240px]">{attachment.name}</p>
                          <p className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</p>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeAttachment(attachment.id)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Comment */}
            <div className="space-y-3">
              <Label htmlFor="comment">Comment</Label>
              <Textarea
                id="comment"
                placeholder="Add any notes or details about this proposal..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
              />
            </div>

          </div>{/* /right-panel */}

        </div>{/* /two-panel body */}

        {/* ── Footer ── */}
        <div className="px-6 py-3 border-t shrink-0 flex justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleSave} disabled={isSaveDisabled}>
            {isSubmitting ? 'Submitting...' : 'Submit Proposal'}
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}