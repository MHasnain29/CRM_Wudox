import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  pandaDocGetTemplatesDetailed,
  pandaDocGetPrefill,
  pandaDocSendDocument,
  pandaDocVoidDocument,
  type PandaDocTemplateDetailed,
  type PandaDocPrefillData,
} from '@/lib/api';
import {
  FileSignature,
  Search,
  ChevronRight,
  ChevronLeft,
  User,
  Check,
  Loader2,
  AlertCircle,
  Send,
  File,
  Phone,
  Mail,
  Building2,
  Tag,
} from 'lucide-react';
import { toast } from 'sonner';

// ─── Token auto-fill matching ─────────────────────────────────────────────────

function matchToken(tokenName: string, prefill: PandaDocPrefillData): string {
  const n = tokenName.toLowerCase().replace(/[^a-z0-9]/g, '');
  const p = prefill.proposal;
  const map: Record<string, string> = {
    // Client
    client: prefill.client.name,
    clientname: prefill.client.name,
    companyname: prefill.client.name,
    clientcompanyname: prefill.client.name,
    clientindustry: prefill.client.industry,
    industry: prefill.client.industry,
    typeofbusiness: prefill.client.industry,
    businesstype: prefill.client.industry,
    clientlocation: prefill.client.location,
    clientcity: prefill.client.location,
    location: prefill.client.location,
    clientaddress: prefill.client.address,
    address: prefill.client.address,
    companysize: prefill.client.companySize,
    clientcompanysize: prefill.client.companySize,
    // Contact / Signing Authority
    contactname: prefill.contact?.name ?? '',
    recipientname: prefill.contact?.name ?? '',
    contactfirstname: prefill.contact?.firstName ?? '',
    recipientfirstname: prefill.contact?.firstName ?? '',
    contactlastname: prefill.contact?.lastName ?? '',
    recipientlastname: prefill.contact?.lastName ?? '',
    contacttitle: prefill.contact?.title ?? '',
    jobtitle: prefill.contact?.title ?? '',
    signingauthority: prefill.contact?.title ?? '',
    designation: prefill.contact?.title ?? '',
    signingauthoritydesignation: prefill.contact?.title ?? '',
    contactemail: prefill.contact?.email ?? '',
    recipientemail: prefill.contact?.email ?? '',
    contactphone: prefill.contact?.phone ?? '',
    recipientphone: prefill.contact?.phone ?? '',
    // Sender
    sendername: prefill.sender.name,
    repname: prefill.sender.name,
    salesrepname: prefill.sender.name,
    senderfirstname: prefill.sender.firstName,
    senderlastname: prefill.sender.lastName,
    senderemail: prefill.sender.email,
    repemail: prefill.sender.email,
    salesrepemail: prefill.sender.email,
    senderphone: prefill.sender.phone,
    // Agency
    agencyname: prefill.agency.name,
    staffingagency: prefill.agency.name,
    agencycompanyname: prefill.agency.name,
    // Date
    date: prefill.date.today,
    today: prefill.date.today,
    datetoday: prefill.date.today,
    todaydate: prefill.date.today,
    currentdate: prefill.date.today,
    signingdate: prefill.date.today,
    agreementdate: prefill.date.today,
    effectivedate: prefill.date.today,
    year: prefill.date.year,
    currentyear: prefill.date.year,
    // Lead
    contractvalue: prefill.lead.value,
    dealvalue: prefill.lead.value,
    leadvalue: prefill.lead.value,
    value: prefill.lead.value,
    // Proposal — payment terms ("# of days" → stripped: "ofdays")
    ofdays: p?.paymentDays ?? '',
    numberofdays: p?.paymentDays ?? '',
    paymentdays: p?.paymentDays ?? '',
    netdays: p?.paymentDays ?? '',
    paymentterms: p?.paymentTermsLabel ?? '',
    // Proposal — minimum hours ("# of hours" → stripped: "ofhours")
    ofhours: p?.minimumHours ?? '',
    minimumhours: p?.minimumHours ?? '',
    tempminimumhours: p?.minimumHours ?? '',
    ofhoursmintortempopermanent: p?.minimumHours ?? '',
    minhours: p?.minimumHours ?? '',
    // Proposal — bill rate / markup ("bill rate $/markup %" → stripped: "billratemarkup")
    billratemarkup: p?.billingRate ?? '',
    billrate: p?.billingRate ?? '',
    markup: p?.billingRate ?? '',
    rate: p?.billingRate ?? '',
    billingrate: p?.billingRate ?? '',
    // Proposal — agreement type
    agreementtype: p?.agreementTypeLabel ?? '',
    employmenttype: p?.agreementTypeLabel ?? '',
  };
  return map[n] ?? '';
}

// ─── Token categorization ─────────────────────────────────────────────────────

function categorizeToken(name: string): 'date' | 'agency' | 'client' | 'contact' | 'sender' | 'lead' | 'proposal' | 'other' {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (/^(date|today|currentdate|signingdate|agreementdate|effectivedate|year|currentyear|datetoday|todaydate)/.test(n)) return 'date';
  if (/^(agency|staffingagency|agencycompany)/.test(n)) return 'agency';
  if (/^(contact|recipient|signingauthority|designation)/.test(n)) return 'contact';
  if (['senderfirstname','senderlastname','senderemail','senderphone','repemail','salesrepemail'].includes(n) || /^(sender|repname|salesrep)/.test(n)) return 'sender';
  if (/^(contractvalue|dealvalue|leadvalue)$/.test(n) || n === 'value') return 'lead';
  if (/^(client|company|industry|location|address|companysize|typeofbusiness|businesstype)/.test(n)) return 'client';
  if (/^(ofdays|numberofdays|paymentdays|netdays|paymentterms|ofhours|minimumhours|tempminimum|ofhoursmint|minhours|billrate|markup|rate|billingrate|agreementtype|employmenttype)/.test(n)) return 'proposal';
  return 'other';
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = [
  { num: 1, label: 'Template' },
  { num: 2, label: 'Contact' },
  { num: 3, label: 'Values' },
  { num: 4, label: 'Review' },
] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center py-1">
      {STEPS.map((step, i) => (
        <div key={step.num} className="flex items-center">
          <div
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              current === step.num
                ? 'bg-primary text-primary-foreground'
                : current > step.num
                ? 'bg-green-100 text-green-700'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {current > step.num ? (
              <Check className="h-3 w-3" />
            ) : (
              <span className="w-3 text-center">{step.num}</span>
            )}
            <span className="hidden sm:inline">{step.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`h-px w-5 mx-0.5 ${current > step.num ? 'bg-green-300' : 'bg-border'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Selectable card ──────────────────────────────────────────────────────────

function SelectableCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all select-none ${
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:border-primary/40 hover:bg-muted/30'
      }`}
    >
      <div
        className={`mt-0.5 h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
          selected ? 'border-primary' : 'border-muted-foreground'
        }`}
      >
        {selected && <div className="h-2 w-2 rounded-full bg-primary" />}
      </div>
      {children}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface ProposalForAgreement {
  id: string;
  pandaDocId?: string | null;
  pandaDocStatus?: string | null;
  lead: {
    subCompanyId?: string;
    client: { name: string };
    owner: { firstName: string; lastName: string; email: string };
  };
}

interface SendAgreementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal: ProposalForAgreement;
  onUpdate: (update: { pandaDocId?: string | null; pandaDocStatus?: string | null }) => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SendAgreementDialog({
  open,
  onOpenChange,
  proposal,
  onUpdate,
}: SendAgreementDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1
  const [templateSearch, setTemplateSearch] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<PandaDocTemplateDetailed | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  // Step 2
  const [selectedContactId, setSelectedContactId] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [prefillData, setPrefillData] = useState<PandaDocPrefillData | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  // Step 3
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [docMode, setDocMode] = useState<'values' | 'tokens'>('values');
  const [activeTokenName, setActiveTokenName] = useState<string | null>(null);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rightPaneRef = useRef<HTMLDivElement>(null);

  // Step 4
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Load templates — scoped to the proposal's agency mapping
  const leadAgencyId = proposal.lead.subCompanyId;
  const { data: templatesData, isLoading: templatesLoading, isError: templatesError } = useQuery({
    queryKey: ['pandadoc-templates-detailed', leadAgencyId ?? null],
    queryFn: () => pandaDocGetTemplatesDetailed({ subCompanyId: leadAgencyId }),
    staleTime: 5 * 60 * 1000,
    enabled: open && !!leadAgencyId,
  });

  const templates = templatesData?.templates ?? [];
  const filteredTemplates = templateSearch.trim()
    ? templates.filter((t) => t.name.toLowerCase().includes(templateSearch.toLowerCase()))
    : templates;

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep(1);
      setTemplateSearch('');
      setSelectedTemplate(null);
      setSelectedContactId('');
      setSelectedRole('');
      setPrefillData(null);
      setTokenValues({});
      setDocMode('values');
      setActiveTokenName(null);
      setMessage('');
    }
  }, [open]);

  // Auto-select role when template changes
  useEffect(() => {
    if (!selectedTemplate) return;
    if (selectedTemplate.roles.length === 1) {
      setSelectedRole(selectedTemplate.roles[0].name);
    } else {
      setSelectedRole('');
    }
  }, [selectedTemplate]);

  // Auto-fill tokens whenever template + prefill data are both ready
  useEffect(() => {
    if (!selectedTemplate || !prefillData) return;
    const auto: Record<string, string> = {};
    for (const token of selectedTemplate.tokens) {
      auto[token.name] = matchToken(token.name, prefillData);
    }
    setTokenValues(auto);
  }, [selectedTemplate, prefillData]);

  const loadPrefill = useCallback(
    async (contactId?: string) => {
      setPrefillLoading(true);
      try {
        const data = await pandaDocGetPrefill(proposal.id, contactId);
        setPrefillData(data);
        if (!contactId && data.selectedContactId) {
          setSelectedContactId(data.selectedContactId);
        }
      } catch {
        toast.error('Failed to load client data');
      } finally {
        setPrefillLoading(false);
      }
    },
    [proposal.id],
  );

  // Helpers
  const hasActiveDoc =
    !!proposal.pandaDocId &&
    ['document.sent', 'document.viewed', 'document.completed'].includes(proposal.pandaDocStatus ?? '');
  const isSigned = proposal.pandaDocStatus === 'document.completed';

  const contacts = prefillData?.contacts ?? [];
  const signableContacts = contacts.filter((c) => c.email && !c.isUnsubscribed);
  const selectedContact = contacts.find((c) => c.id === selectedContactId);

  // Actions
  const handleVoid = async () => {
    if (!proposal.pandaDocId) return;
    setIsVoiding(true);
    try {
      await pandaDocVoidDocument(proposal.pandaDocId);
      onUpdate({ pandaDocStatus: 'document.voided' });
      toast.success('Document voided — you can now send a new agreement');
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to void document');
    } finally {
      setIsVoiding(false);
    }
  };

  const handleStep1Next = async () => {
    if (!selectedTemplate) return;
    setStep(2);
    if (!prefillData) await loadPrefill();
  };

  const handleStep2Next = async () => {
    if (!selectedContactId || !selectedRole) return;
    await loadPrefill(selectedContactId);
    setStep(3);
  };

  const handleSend = async () => {
    if (!selectedTemplate || !selectedContact?.email || !selectedRole) return;
    const nameParts = selectedContact.name.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ') || firstName;

    const tokens = Object.entries(tokenValues)
      .filter(([, v]) => v.trim() !== '')
      .map(([name, value]) => ({ name, value }));

    setIsSending(true);
    try {
      const result = await pandaDocSendDocument({
        proposalId: proposal.id,
        templateId: selectedTemplate.id,
        recipientEmail: selectedContact.email,
        recipientFirstName: firstName,
        recipientLastName: lastName,
        recipientRole: selectedRole,
        message: message || undefined,
        tokens: tokens.length > 0 ? tokens : undefined,
      });
      onUpdate({ pandaDocId: result.documentId, pandaDocStatus: 'document.sent' });
      onOpenChange(false);
      toast.success(`Agreement sent to ${selectedContact.email}`);
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Failed to send agreement');
    } finally {
      setIsSending(false);
    }
  };

  const emptyTokenNames = (selectedTemplate?.tokens ?? [])
    .filter((t) => !(tokenValues[t.name]?.trim()))
    .map((t) => t.name);

  const focusToken = (name: string) => {
    setActiveTokenName(name);
    const el = inputRefs.current[name];
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); el.focus(); el.select(); }
  };

  const jumpToEmpty = () => {
    const first = emptyTokenNames[0];
    if (first) focusToken(first);
  };

  const renderDocument = () => {
    if (!selectedTemplate) return null;
    const tokens = selectedTemplate.tokens;
    const g: Record<string, string[]> = { date: [], agency: [], client: [], contact: [], sender: [], lead: [], proposal: [], other: [] };
    for (const t of tokens) g[categorizeToken(t.name)].push(t.name);

    const chip = (name: string) => {
      const val = tokenValues[name] ?? '';
      const empty = !val.trim();
      const active = activeTokenName === name;
      return (
        <span
          key={`chip-${name}`}
          onClick={() => focusToken(name)}
          className={`inline-flex items-center px-1.5 rounded cursor-pointer font-medium transition-all select-none leading-7 ${
            active
              ? 'bg-indigo-500 text-white border border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.2)]'
              : empty
              ? 'bg-amber-50 text-amber-600 border border-dashed border-amber-300 hover:bg-amber-100'
              : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
          }`}
        >
          {docMode === 'tokens' ? (
            <span className="font-mono text-[11px]">{name}</span>
          ) : empty ? (
            <span className="text-[11px] italic text-amber-400">not filled</span>
          ) : (
            <span className="text-[13px]">{val}</span>
          )}
        </span>
      );
    };

    const hasGroup = (cat: string) => g[cat].length > 0;
    const feeOther = g.other.filter((n) => /fee|rate|price|cost|bill/i.test(n));
    const plainOther = g.other.filter((n) => !/fee|rate|price|cost|bill/i.test(n));

    const sectionHead = (text: string) => (
      <h3 className="text-[10px] font-bold mt-5 mb-2 text-indigo-600 uppercase tracking-[0.06em] border-b border-indigo-100 pb-1">
        {text}
      </h3>
    );

    return (
      <>
        <h2 className="text-[11px] font-bold text-center mb-6 uppercase tracking-[0.12em] text-slate-900">
          Staffing Services Agreement
        </h2>

        {(hasGroup('date') || hasGroup('agency') || hasGroup('client')) && (
          <>
            {sectionHead('1 · Agreement')}
            <p className="mb-3 leading-8">
              {g.date.length > 0 && <>This Agreement is entered into as of {g.date.slice(0, 1).map(chip)}{' '}</>}
              {g.agency.length > 0 && <>between {g.agency.slice(0, 1).map(chip)} <em>("Agency")</em> and{' '}</>}
              {g.client.length > 0 && <>{g.client.slice(0, 1).map(chip)} <em>("Client")</em></>}
              {g.client.filter((n) => /industr/i.test(n)).map((n) => (
                <span key={n}>, operating in the {chip(n)} sector</span>
              ))}
              {g.client.filter((n) => /address/i.test(n)).map((n) => (
                <span key={n}>, located at {chip(n)}</span>
              ))}
              {'.'}
            </p>
            {g.client.slice(1).filter((n) => !/industr|address/i.test(n)).length > 0 && (
              <p className="mb-3 leading-8 flex flex-wrap gap-1 items-center">
                {g.client.slice(1).filter((n) => !/industr|address/i.test(n)).map(chip)}
              </p>
            )}
          </>
        )}

        {(hasGroup('lead') || hasGroup('proposal') || feeOther.length > 0) && (
          <>
            {sectionHead('2 · Fees & Terms')}
            <p className="mb-3 leading-8">
              {g.lead.map((n) => <span key={n}>Contract value: {chip(n)} </span>)}
              {g.proposal.map((n) => <span key={n}>{chip(n)} </span>)}
              {feeOther.map((n) => <span key={n}>{chip(n)} </span>)}
            </p>
          </>
        )}

        {hasGroup('contact') && (
          <>
            {sectionHead('3 · Client Representative')}
            <p className="mb-3 leading-8 flex flex-wrap gap-x-1 gap-y-1 items-center">
              {g.contact.map(chip)}
            </p>
          </>
        )}

        {hasGroup('sender') && (
          <>
            {sectionHead('4 · Prepared By')}
            <p className="mb-3 leading-8 flex flex-wrap gap-x-1 gap-y-1 items-center">
              {g.sender.map(chip)}
            </p>
          </>
        )}

        {plainOther.length > 0 && (
          <>
            {sectionHead('5 · Additional Fields')}
            <p className="mb-3 leading-8 flex flex-wrap gap-x-1 gap-y-1 items-center">
              {plainOther.map(chip)}
            </p>
          </>
        )}

        <div className="grid grid-cols-2 gap-5 mt-10 text-[11px] text-slate-400">
          <div><div className="border-t border-slate-200 pt-2">Client Signature</div></div>
          <div><div className="border-t border-slate-200 pt-2">Agency Signature</div></div>
        </div>
      </>
    );
  };

  const canGoNext =
    (step === 1 && !!selectedTemplate && !(hasActiveDoc && !isSigned)) ||
    (step === 2 && !!selectedContactId && !!selectedRole && !prefillLoading) ||
    (step === 3);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0 ${step === 3 && selectedTemplate && selectedTemplate.tokens.length > 0 ? 'max-w-4xl' : 'max-w-xl'}`}>
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileSignature className="h-5 w-5 text-primary shrink-0" />
              Send Agreement — {proposal.lead.client.name}
            </DialogTitle>
            {step === 3 && selectedTemplate && selectedTemplate.tokens.length > 0 && (
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all ${
                  emptyTokenNames.length === 0
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-amber-50 border-amber-200 text-amber-700'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${emptyTokenNames.length === 0 ? 'bg-green-500' : 'bg-amber-500'}`} />
                {emptyTokenNames.length === 0
                  ? `All ${selectedTemplate.tokens.length} filled ✓`
                  : `${emptyTokenNames.length} field${emptyTokenNames.length > 1 ? 's' : ''} empty`}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="px-6 pb-3 shrink-0">
          <StepIndicator current={step} />
        </div>

        <Separator className="shrink-0" />

        {/* Content */}
        <div className={`flex-1 min-h-0 flex flex-col ${step === 3 && selectedTemplate && selectedTemplate.tokens.length > 0 ? 'overflow-hidden' : 'overflow-y-auto px-6 py-4'}`}>

          {/* ── Step 1: Template ───────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              {hasActiveDoc && !isSigned && (
                <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Document already active</p>
                    <p className="text-xs text-amber-700 mt-0.5">
                      Status: <strong className="capitalize">{proposal.pandaDocStatus?.replace('document.', '')}</strong>.
                      Void it to send a new agreement.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                      onClick={handleVoid}
                      disabled={isVoiding}
                    >
                      {isVoiding && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      Void Document
                    </Button>
                  </div>
                </div>
              )}

              {isSigned && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-green-200 bg-green-50">
                  <Check className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-sm text-green-800 font-medium">This agreement has already been signed.</p>
                </div>
              )}

              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search templates…"
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {templatesLoading && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading PandaDoc templates…
                </div>
              )}

              {templatesError && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Could not load templates. Check your PandaDoc API key.
                </div>
              )}

              {!templatesLoading && !templatesError && filteredTemplates.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8 italic">
                  No templates mapped for this agency. Map them in Settings → Proposal Templates.
                </p>
              )}

              <div className="space-y-2">
                {filteredTemplates.map((template) => (
                  <SelectableCard
                    key={template.id}
                    selected={selectedTemplate?.id === template.id}
                    onClick={() => setSelectedTemplate(template)}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{template.name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {template.tokens.length > 0 && (
                          <Badge variant="secondary" className="text-xs h-4 px-1.5">
                            {template.tokens.length} token{template.tokens.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {template.fields.length > 0 && (
                          <Badge variant="outline" className="text-xs h-4 px-1.5">
                            {template.fields.length} field{template.fields.length !== 1 ? 's' : ''}
                          </Badge>
                        )}
                        {template.roles.length > 0 && (
                          <Badge variant="outline" className="text-xs h-4 px-1.5 bg-blue-50 text-blue-700 border-blue-200">
                            {template.roles.map((r) => r.name).join(', ')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </SelectableCard>
                ))}
              </div>
            </div>
          )}

          {/* ── Step 2: Contact & Role ─────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              {prefillLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading contacts…
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm font-semibold mb-3">Select recipient</p>
                    {signableContacts.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        No contacts with email addresses found for this client.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {signableContacts.map((contact) => (
                          <SelectableCard
                            key={contact.id}
                            selected={selectedContactId === contact.id}
                            onClick={() => setSelectedContactId(contact.id)}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium">{contact.name}</p>
                                {contact.isPrimary && (
                                  <Badge variant="secondary" className="text-xs h-4 px-1.5">Primary</Badge>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-3 mt-1">
                                {contact.title && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <User className="h-3 w-3" />
                                    {contact.title}
                                  </span>
                                )}
                                {contact.email && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Mail className="h-3 w-3" />
                                    {contact.email}
                                  </span>
                                )}
                                {contact.phone && (
                                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                                    <Phone className="h-3 w-3" />
                                    {contact.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          </SelectableCard>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Role selection */}
                  {selectedTemplate && selectedTemplate.roles.length > 1 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Signing role</Label>
                      <Select value={selectedRole} onValueChange={setSelectedRole}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role…" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedTemplate.roles.map((r) => (
                            <SelectItem key={r.id} value={r.name}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {selectedTemplate && selectedTemplate.roles.length === 1 && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm">
                      <Tag className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">
                        Signing role: <strong className="text-foreground">{selectedTemplate.roles[0].name}</strong>
                      </span>
                    </div>
                  )}

                  {selectedTemplate && selectedTemplate.roles.length === 0 && (
                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Signing role</Label>
                      <Input
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        placeholder="e.g. Client"
                      />
                      <p className="text-xs text-muted-foreground">
                        Must match a role name defined in the PandaDoc template.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Step 3: Token Values (split-pane) ─────────────────── */}
          {step === 3 && (
            <>
              {!selectedTemplate || selectedTemplate.tokens.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                    <Check className="h-6 w-6 text-green-600" />
                  </div>
                  <p className="font-medium">No placeholder values needed</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This template has no text tokens. Continue to review and send.
                  </p>
                </div>
              ) : (
                <div className="flex flex-1 min-h-0">
                  {/* ── Left pane: Document preview ── */}
                  <div className="flex flex-col border-r border-slate-100 min-h-0" style={{ width: '57%' }}>
                    {/* Toolbar */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/60 shrink-0">
                      <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                        <File className="h-3 w-3" />
                        Click any value to edit it
                      </span>
                      <div className="flex items-center gap-2">
                        {emptyTokenNames.length > 0 && (
                          <button
                            onClick={jumpToEmpty}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 flex items-center gap-1 transition-colors"
                          >
                            <AlertCircle className="h-3 w-3" />
                            Jump to empty
                          </button>
                        )}
                        <div className="flex bg-slate-100 rounded-md p-0.5 gap-0.5">
                          <button
                            onClick={() => setDocMode('values')}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded transition-all ${
                              docMode === 'values' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => setDocMode('tokens')}
                            className={`text-[11px] font-semibold px-2.5 py-1 rounded transition-all ${
                              docMode === 'tokens' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                            }`}
                          >
                            Token Names
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Document scroll */}
                    <div className="flex-1 overflow-y-auto p-5 bg-slate-50">
                      <div className="bg-white rounded-xl shadow-sm px-8 py-7 text-sm text-slate-700 relative min-h-[400px]">
{renderDocument()}
                      </div>
                    </div>
                  </div>

                  {/* ── Right pane: Token inputs ── */}
                  <div className="flex flex-col min-h-0" style={{ width: '43%' }}>
                    {/* Pane header */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-slate-100 bg-slate-50/60 shrink-0">
                      <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                        <Tag className="h-3 w-3" />
                        Token Values
                      </span>
                      {emptyTokenNames.length > 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {emptyTokenNames.length} empty
                        </span>
                      )}
                    </div>
                    {/* Fields scroll */}
                    <div ref={rightPaneRef} className="flex-1 overflow-y-auto">
                      {selectedTemplate.tokens.map((token) => {
                        const autoValue = prefillData ? matchToken(token.name, prefillData) : '';
                        const currentValue = tokenValues[token.name] ?? '';
                        const isEmpty = !currentValue.trim();
                        const isAutoFilled = autoValue !== '' && currentValue === autoValue;
                        const isActive = activeTokenName === token.name;
                        return (
                          <div
                            key={token.name}
                            className={`px-4 py-2.5 border-l-[3px] transition-all ${
                              isActive
                                ? 'bg-indigo-50/50 border-l-indigo-500'
                                : isEmpty
                                ? 'border-l-amber-300 hover:bg-slate-50'
                                : 'border-l-transparent hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="font-mono text-[10px] text-slate-400 truncate max-w-[70%]">{token.name}</span>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                  isAutoFilled
                                    ? 'bg-green-50 text-green-700'
                                    : isEmpty
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {isAutoFilled ? 'auto' : isEmpty ? 'empty' : 'filled'}
                              </span>
                            </div>
                            <input
                              ref={(el) => { inputRefs.current[token.name] = el; }}
                              value={currentValue}
                              onChange={(e) => setTokenValues((prev) => ({ ...prev, [token.name]: e.target.value }))}
                              onFocus={() => setActiveTokenName(token.name)}
                              onBlur={() => setTimeout(() => setActiveTokenName((prev) => (prev === token.name ? null : prev)), 100)}
                              placeholder={isEmpty ? 'Fill in…' : ''}
                              className={`w-full text-[13px] px-2.5 py-1.5 rounded-md border outline-none transition-all ${
                                isActive
                                  ? 'border-indigo-400 ring-2 ring-indigo-100 bg-indigo-50/20'
                                  : isEmpty
                                  ? 'border-dashed border-amber-300 bg-amber-50/30 placeholder:text-amber-400'
                                  : 'border-slate-200 bg-white'
                              }`}
                            />
                          </div>
                        );
                      })}
                    </div>
                    {/* Footer hint */}
                    <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/60 text-[10px] text-slate-400 flex items-center gap-1 shrink-0">
                      <span>💡</span>
                      <span>Tab between fields · Click a value in the document to jump here</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Step 4: Review & Send ──────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-5">
              {/* Summary */}
              <div className="rounded-lg border overflow-hidden text-sm">
                <div className="px-4 py-2.5 bg-muted/40 border-b">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Agreement Summary
                  </p>
                </div>

                <div className="divide-y">
                  <div className="px-4 py-3 flex items-start gap-3">
                    <File className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Template</p>
                      <p className="font-medium mt-0.5">{selectedTemplate?.name}</p>
                    </div>
                  </div>

                  {selectedContact && (
                    <div className="px-4 py-3 flex items-start gap-3">
                      <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Recipient</p>
                        <p className="font-medium mt-0.5">{selectedContact.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {selectedContact.email}
                          {selectedRole && <span className="ml-2">· Role: {selectedRole}</span>}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="px-4 py-3 flex items-start gap-3">
                    <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-muted-foreground">Client</p>
                      <p className="font-medium mt-0.5">{proposal.lead.client.name}</p>
                    </div>
                  </div>

                  {prefillData && (
                    <div className="px-4 py-3 flex items-start gap-3">
                      <Send className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Sent by</p>
                        <p className="font-medium mt-0.5">{prefillData.sender.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{prefillData.sender.email}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Token values preview */}
              {selectedTemplate && selectedTemplate.tokens.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                    Pre-filled Values
                  </p>
                  <div className="rounded-lg border divide-y overflow-hidden text-sm">
                    {selectedTemplate.tokens.map((token) => (
                      <div key={token.name} className="px-3 py-2 flex items-center gap-3">
                        <span className="text-muted-foreground font-mono text-xs w-36 shrink-0 truncate">
                          {token.name}
                        </span>
                        <span className="flex-1 truncate text-sm">
                          {tokenValues[token.name] || (
                            <span className="text-muted-foreground italic text-xs">empty</span>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Optional message */}
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">
                  Message{' '}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a personal message for the recipient email…"
                  rows={3}
                  className="resize-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <Separator className="shrink-0" />
        <div className="flex items-center justify-between px-6 py-4 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setStep((s) => Math.max(1, s - 1) as 1 | 2 | 3 | 4)}
            disabled={step === 1 || isSending || isVoiding}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSending}
            >
              Cancel
            </Button>

            {step < 4 ? (
              <Button
                size="sm"
                onClick={() => {
                  if (step === 1) handleStep1Next();
                  else if (step === 2) handleStep2Next();
                  else setStep(4);
                }}
                disabled={!canGoNext || isVoiding}
              >
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={handleSend} disabled={isSending}>
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <FileSignature className="h-4 w-4 mr-2" />
                    Send Agreement
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
