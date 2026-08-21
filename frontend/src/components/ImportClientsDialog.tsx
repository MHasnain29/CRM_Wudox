import { useEffect, useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Upload, FileText, ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, AlertTriangle, GitMerge, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  fetchImportMappingTemplate,
  saveImportMappingTemplate,
  checkContactImportDuplicates,
  type SavePendingImportClient,
  type PendingImportContact,
  type ContactImportRow,
  type ContactImportCheckResult,
} from '@/lib/api';
import {
  ClientStorageContextBanner,
  type ClientStorageContext,
} from '@/components/ClientStorageContextBanner';
import {
  describeClientFlow,
  isElevatedClientFlowConfig,
  type ClientFlowConfig,
} from '@/lib/clientDestinationFlow';

// ─── Field model ─────────────────────────────────────────────────────────────

/** CRM target fields the user can map a source column to. `_ignore` means skip. */
type CrmField =
  | '_ignore'
  | 'name'
  | 'industry'
  | 'address'
  | 'city'
  | 'region'
  | 'website'
  | 'companySize'
  | 'sourceId'
  | 'contactName'
  | 'contactTitle'
  | 'contactPhone'
  | 'contactExtension'
  | 'contactEmail'
  | 'contactLinkedin';

const CRM_FIELDS: Array<{ value: CrmField; label: string; required?: boolean }> = [
  { value: '_ignore', label: '(Ignore)' },
  { value: 'name', label: 'Company name', required: true },
  { value: 'sourceId', label: 'External ID (optional)' },
  { value: 'industry', label: 'Industry' },
  { value: 'address', label: 'Address' },
  { value: 'city', label: 'City' },
  { value: 'region', label: 'Province / region' },
  { value: 'website', label: 'Website' },
  { value: 'companySize', label: 'Company size / employees' },
  { value: 'contactName', label: 'Contact name' },
  { value: 'contactTitle', label: 'Contact title' },
  { value: 'contactPhone', label: 'Contact phone' },
  { value: 'contactExtension', label: 'Contact extension' },
  { value: 'contactEmail', label: 'Contact email' },
  { value: 'contactLinkedin', label: 'Contact LinkedIn' },
];

/** Synonyms used for auto-mapping. Compared after stripping non-alphanumeric chars and lowercasing. */
const SYNONYMS: Record<CrmField, string[]> = {
  _ignore: ['sr', 'srno', 'sno', 'row', 'index', '#'],
  name: ['name', 'companyname', 'company', 'account', 'client', 'organization', 'org'],
  // Do not auto-map bare "id" — rows are grouped by company name, not opaque IDs.
  sourceId: ['companyid', 'accountid', 'externalid', 'groupid', 'parentid', 'importsourceid'],
  industry: ['keyword', 'category', 'industry', 'sector'],
  address: ['address', 'street', 'streetaddress', 'fulladdress'],
  city: ['city', 'town'],
  region: ['province', 'state', 'region'],
  website: ['website', 'url', 'site', 'web', 'homepage'],
  companySize: ['employee', 'employees', 'size', 'headcount', 'numemployees', 'employeecount'],
  contactName: ['concernedperson', 'contact', 'contactname', 'fullname', 'person', 'contactperson'],
  contactTitle: ['designation', 'title', 'jobtitle', 'position', 'role'],
  contactPhone: ['phone', 'tel', 'telephone', 'mobile', 'phonenumber'],
  contactExtension: ['extension', 'ext'],
  contactEmail: ['email', 'mail', 'emailaddress'],
  contactLinkedin: ['linkedin', 'linkedinprofile', 'linkedinurl', 'li'],
};

const normalizeHeader = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const autoMapField = (header: string): CrmField => {
  const n = normalizeHeader(header);
  if (!n) return '_ignore';
  for (const [field, syns] of Object.entries(SYNONYMS) as Array<[CrmField, string[]]>) {
    if (syns.some((s) => s === n)) return field;
  }
  // contains fallback (helps things like "first phone (mobile)" → contactPhone)
  for (const [field, syns] of Object.entries(SYNONYMS) as Array<[CrmField, string[]]>) {
    if (syns.some((s) => n.includes(s) && s.length >= 4)) return field;
  }
  return '_ignore';
};

/** Stable SHA-1 of sorted, lowercased headers. Used as the mapping-template key. */
async function headerFingerprint(headers: string[]): Promise<string> {
  const canon = [...headers].map((h) => h.toLowerCase().trim()).sort().join('|');
  const buf = new TextEncoder().encode(canon);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── File parsing ────────────────────────────────────────────────────────────

interface ParsedFile {
  headers: string[];
  rows: string[][];
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Row-number columns we drop at parse time — they have no CRM value and just clutter the wizard. */
const NOISE_HEADERS = new Set(SYNONYMS._ignore.map(normalizeHeader));

/** Remove columns whose normalized header is in NOISE_HEADERS. Drops them from headers and every row. */
function stripNoiseColumns({ headers, rows }: ParsedFile): ParsedFile {
  const keepIndices: number[] = [];
  const keptHeaders: string[] = [];
  headers.forEach((h, i) => {
    if (!NOISE_HEADERS.has(normalizeHeader(h))) {
      keepIndices.push(i);
      keptHeaders.push(h);
    }
  });
  if (keepIndices.length === headers.length) return { headers, rows };
  return {
    headers: keptHeaders,
    rows: rows.map((r) => keepIndices.map((i) => r[i] ?? '')),
  };
}

async function parseFile(file: File): Promise<ParsedFile> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 1) return { headers: [], rows: [] };
    const headers = parseCsvLine(lines[0]);
    const rows = lines.slice(1).map(parseCsvLine);
    return stripNoiseColumns({ headers, rows });
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const sheet = wb.worksheets[0];
    if (!sheet) return { headers: [], rows: [] };
    const headers: string[] = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = String(cell.text ?? cell.value ?? '').trim();
    });
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const cells: string[] = [];
      for (let c = 1; c <= headers.length; c++) {
        const cell = row.getCell(c);
        // .text handles scientific-notation numbers, dates, etc. as display strings.
        const v = cell.text ?? cell.value ?? '';
        cells[c - 1] = typeof v === 'object' ? JSON.stringify(v) : String(v).trim();
      }
      rows.push(cells);
    });
    return stripNoiseColumns({ headers: headers.map((h) => h ?? ''), rows });
  }
  throw new Error('Unsupported file type. Please upload a .csv, .xlsx, or .xls file.');
}

// ─── Public types ────────────────────────────────────────────────────────────

// Kept for backwards-compat with existing imports of this name.
export interface PendingClient {
  id: string;
  name: string;
  industry: string;
  location: string;
  address: string;
  companySize: string;
  tags: string[];
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  importedAt: Date;
}

interface ImportClientsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with grouped clients that do NOT exist yet. Options = agency id + destination when org allows choice. */
  onImport: (
    clients: SavePendingImportClient[],
    options?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
  ) => void | Promise<void>;
  /** Called with rows whose company already exists in the CRM — their contacts are appended to the existing client. */
  onImportContacts: (
    rows: ContactImportRow[],
    options?: { subCompanyId?: string; importDestination?: 'global' | 'agency' },
  ) => void | Promise<void>;
  /** Agency selected in the top filter — imports are queued for this franchise only. */
  targetAgencyName?: string;
  /** SubCompanyId of the target agency, used for scoping the duplicate check. */
  targetSubCompanyId?: string;
  /** Role-aware flow from Settings → Approvals. */
  clientFlowConfig?: ClientFlowConfig | null;
  destinationAgencies?: Array<{ id: string; name: string }>;
  /** Legacy fallback when clientFlowConfig is not loaded yet. */
  storageContext?: ClientStorageContext;
}

type WizardStep = 'upload' | 'map' | 'group';

/** Internal type: SavePendingImportClient with row-count metadata for UI display. */
type GroupedClientWithMeta = SavePendingImportClient & { _rowCount: number };

/** Spreadsheet/CSV line numbers (header = 1, first data row = 2) keyed by normalized values. */
type ImportSourceRowIndex = {
  emails: Map<string, number[]>;
  phones: Map<string, number[]>;
  companyNames: Map<string, number[]>;
};

function normalizeConflictEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeConflictPhone(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeConflictCompanyName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function pushRowNumber(map: Map<string, number[]>, key: string, fileRow: number) {
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    if (!existing.includes(fileRow)) existing.push(fileRow);
  } else {
    map.set(key, [fileRow]);
  }
}

/** Map contact/company values from the uploaded file to 1-based file line numbers. */
function buildImportSourceRowIndex(
  parsed: ParsedFile,
  mapping: Record<string, CrmField>,
): ImportSourceRowIndex {
  const emails = new Map<string, number[]>();
  const phones = new Map<string, number[]>();
  const companyNames = new Map<string, number[]>();

  const fieldForHeader = (target: CrmField): string => {
    for (const [h, f] of Object.entries(mapping)) {
      if (f === target) return h;
    }
    return '';
  };

  const hName = fieldForHeader('name');
  const hEmail = fieldForHeader('contactEmail');
  const hPhone = fieldForHeader('contactPhone');
  const hNameIdx = hName ? parsed.headers.indexOf(hName) : -1;
  const hEmailIdx = hEmail ? parsed.headers.indexOf(hEmail) : -1;
  const hPhoneIdx = hPhone ? parsed.headers.indexOf(hPhone) : -1;

  parsed.rows.forEach((row, i) => {
    const fileRow = i + 2; // row 1 is the header
    const company = hNameIdx >= 0 ? (row[hNameIdx] ?? '').trim() : '';
    if (!company) return;
    pushRowNumber(companyNames, normalizeConflictCompanyName(company), fileRow);
    if (hEmailIdx >= 0) {
      pushRowNumber(emails, normalizeConflictEmail(row[hEmailIdx]), fileRow);
    }
    if (hPhoneIdx >= 0) {
      pushRowNumber(phones, normalizeConflictPhone(row[hPhoneIdx]), fileRow);
    }
  });

  return { emails, phones, companyNames };
}

/** First matching file line, or empty string. Appended as " (line N)". */
function lineSuffix(rows: number[] | undefined): string {
  if (!rows || rows.length === 0) return '';
  return ` (line ${rows[0]})`;
}

function rowsForEmail(index: ImportSourceRowIndex | null | undefined, email: string): number[] {
  return index?.emails.get(normalizeConflictEmail(email)) ?? [];
}

function rowsForPhone(index: ImportSourceRowIndex | null | undefined, phone: string): number[] {
  return index?.phones.get(normalizeConflictPhone(phone)) ?? [];
}

function rowsForCompany(index: ImportSourceRowIndex | null | undefined, name: string): number[] {
  return index?.companyNames.get(normalizeConflictCompanyName(name)) ?? [];
}

function countImportConflicts(result: ContactImportCheckResult): number {
  return (
    result.duplicateEmails.length +
    result.duplicatePhones.length +
    result.inFileDuplicateEmails.length +
    result.inFileDuplicatePhones.length +
    result.ambiguousMatches.length
  );
}

/** Map 1-based file line numbers → human-readable remarks for each conflict. */
function buildRowRemarksMap(
  result: ContactImportCheckResult,
  rowIndex?: ImportSourceRowIndex | null,
): Map<number, string[]> {
  const map = new Map<number, string[]>();

  const add = (lines: number[], remark: string) => {
    for (const line of lines) {
      const existing = map.get(line) ?? [];
      if (!existing.includes(remark)) existing.push(remark);
      map.set(line, existing);
    }
  };

  for (const email of result.inFileDuplicateEmails) {
    add(
      rowsForEmail(rowIndex, email),
      `Duplicate email in file: ${email}. This email appears more than once in the import file.`,
    );
  }
  for (const phone of result.inFileDuplicatePhones) {
    add(
      rowsForPhone(rowIndex, phone),
      `Duplicate phone in file: ${phone}. This phone number appears more than once in the import file.`,
    );
  }
  for (const d of result.ambiguousMatches) {
    add(
      rowsForCompany(rowIndex, d.matchValue),
      `Ambiguous company match: "${d.matchValue}" matched ${d.clientIds.length} existing clients on ${d.matchKey}. Refine the company name or ID so it matches exactly one client.`,
    );
  }
  for (const d of result.duplicateEmails) {
    add(
      rowsForEmail(rowIndex, d.email),
      `Email already in CRM: ${d.email} (existing client: ${d.clientName}).`,
    );
  }
  for (const d of result.duplicatePhones) {
    add(
      rowsForPhone(rowIndex, d.phone),
      `Phone already in CRM: ${d.phone} (existing client: ${d.clientName}).`,
    );
  }

  return map;
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, columnCount: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: 'middle', wrapText: true };
  for (let c = 1; c <= columnCount; c++) {
    const cell = header.getCell(c);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFEE2E2' },
    };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFFECACA' } },
    };
  }
  header.height = 22;
}

const ERROR_ROW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFECACA' },
};
const ERROR_ROW_FONT: Partial<ExcelJS.Font> = {
  color: { argb: 'FF991B1B' },
};

function styleErrorDataRow(row: ExcelJS.Row, columnCount: number): void {
  for (let c = 1; c <= columnCount; c++) {
    const cell = row.getCell(c);
    cell.fill = ERROR_ROW_FILL;
    cell.font = ERROR_ROW_FONT;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

/**
 * Excel report with every uploaded row (not just conflicts).
 * Error rows are highlighted red; Remarks column explains each conflict.
 */
async function downloadImportErrorsExcel(
  result: ContactImportCheckResult,
  sourceFileName: string | undefined,
  rowIndex: ImportSourceRowIndex | null | undefined,
  parsed: ParsedFile | null | undefined,
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Wudox';
  wb.created = new Date();

  const total = countImportConflicts(result);
  const remarksByLine = buildRowRemarksMap(result, rowIndex);
  const errorRowCount = remarksByLine.size;

  const headers = parsed?.headers ?? [];
  const dataRows = parsed?.rows ?? [];
  const colCount = headers.length + 1; // + Remarks

  // Primary sheet: full upload with red error rows + Remarks (opens first).
  const allData = wb.addWorksheet('All data');
  allData.columns = [
    ...headers.map((h) => ({
      header: h,
      width: Math.min(36, Math.max(12, h.length + 2)),
    })),
    { header: 'Remarks', width: 72 },
  ];
  styleHeaderRow(allData, colCount);

  dataRows.forEach((cells, i) => {
    const fileLine = i + 2; // row 1 is header
    const remarks = remarksByLine.get(fileLine) ?? [];
    const remarkText = remarks.join(' | ');
    const excelRow = allData.addRow([...cells.map((c) => c ?? ''), remarkText]);
    if (remarks.length > 0) {
      styleErrorDataRow(excelRow, colCount);
    }
  });

  allData.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, dataRows.length + 1), column: colCount },
  };
  allData.views = [{ state: 'frozen', ySplit: 1 }];

  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Field', key: 'field', width: 28 },
    { header: 'Value', key: 'value', width: 56 },
  ];
  styleHeaderRow(summary, 2);
  summary.addRows([
    { field: 'Report', value: 'Client import — full data with errors' },
    { field: 'Generated', value: new Date().toISOString() },
    { field: 'Source file', value: sourceFileName || '(unknown)' },
    { field: 'Total rows', value: dataRows.length },
    { field: 'Rows with errors', value: errorRowCount },
    { field: 'Total conflicts', value: total },
    { field: 'Duplicate emails in file', value: result.inFileDuplicateEmails.length },
    { field: 'Duplicate phones in file', value: result.inFileDuplicatePhones.length },
    { field: 'Ambiguous company matches', value: result.ambiguousMatches.length },
    { field: 'Emails already in CRM', value: result.duplicateEmails.length },
    { field: 'Phones already in CRM', value: result.duplicatePhones.length },
    {
      field: 'Next step',
      value:
        'Rows highlighted in red on "All data" have errors — see the Remarks column. Fix those rows and re-upload.',
    },
  ]);
  const buffer = await wb.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `client-import-errors-${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ImportClientsDialog({
  open,
  onOpenChange,
  onImport,
  onImportContacts,
  targetAgencyName,
  targetSubCompanyId,
  clientFlowConfig = null,
  destinationAgencies = [],
  storageContext,
}: ImportClientsDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<WizardStep>('upload');
  const [fileName, setFileName] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Record<string, CrmField>>({});
  const [fingerprint, setFingerprint] = useState<string>('');
  const [templateBanner, setTemplateBanner] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedAgencyId, setSelectedAgencyId] = useState('');
  const [selectedImportDestination, setSelectedImportDestination] = useState<'global' | 'agency' | ''>('');
  const [dbCheck, setDbCheck] = useState<{
    status: 'idle' | 'checking' | 'done' | 'error';
    result: ContactImportCheckResult | null;
  }>({ status: 'idle', result: null });
  const [showAllErrors, setShowAllErrors] = useState(false);

  const elevatedConfig = isElevatedClientFlowConfig(clientFlowConfig) ? clientFlowConfig : null;
  const configMode = elevatedConfig?.destination;
  const agencyOnlyMode = configMode === 'agency';
  const bothMode = configMode === 'both';
  const showDestinationChoice = bothMode;
  const agencyPath =
    agencyOnlyMode || (bothMode && selectedImportDestination === 'agency');

  const resetAll = () => {
    setStep('upload');
    setFileName('');
    setParsed(null);
    setMapping({});
    setFingerprint('');
    setTemplateBanner(null);
    setSubmitting(false);
    setDbCheck({ status: 'idle', result: null });
    setShowAllErrors(false);
    setSelectedAgencyId('');
    setSelectedImportDestination('');
  };

  useEffect(() => {
    if (!agencyPath || selectedAgencyId) return;
    if (targetSubCompanyId && destinationAgencies.some((a) => a.id === targetSubCompanyId)) {
      setSelectedAgencyId(targetSubCompanyId);
      return;
    }
    if (destinationAgencies.length === 1) {
      setSelectedAgencyId(destinationAgencies[0].id);
    }
  }, [agencyPath, destinationAgencies, selectedAgencyId, targetSubCompanyId]);

  const effectiveDuplicateScopeId = agencyPath && selectedAgencyId
    ? selectedAgencyId
    : targetSubCompanyId;

  const importCheckParams = useMemo((): {
    importDestination?: 'global' | 'agency';
    subCompanyId?: string;
  } | null => {
    if (bothMode) {
      if (selectedImportDestination === 'global') return { importDestination: 'global' };
      if (selectedImportDestination === 'agency') {
        const subCompanyId = selectedAgencyId || targetSubCompanyId;
        return subCompanyId ? { importDestination: 'agency', subCompanyId } : null;
      }
      return null;
    }
    if (configMode === 'global') return { importDestination: 'global' };
    const subCompanyId = effectiveDuplicateScopeId;
    return subCompanyId ? { importDestination: 'agency', subCompanyId } : null;
  }, [
    bothMode,
    selectedImportDestination,
    selectedAgencyId,
    targetSubCompanyId,
    configMode,
    effectiveDuplicateScopeId,
  ]);

  const importDestinationSummary = useMemo(() => {
    if (!clientFlowConfig) return null;
    return describeClientFlow(clientFlowConfig, {
      flow: 'import',
      selectedDestination: selectedImportDestination,
      selectedAgencyName: destinationAgencies.find((a) => a.id === selectedAgencyId)?.name,
    });
  }, [clientFlowConfig, destinationAgencies, selectedAgencyId, selectedImportDestination]);

  useEffect(() => {
    if (!open) resetAll();
  }, [open]);

  // Step 1 → 2: parse file, fetch saved template (if any), auto-map the rest.
  const processFile = async (file: File) => {
    try {
      const p = await parseFile(file);
      if (p.headers.length === 0 || p.rows.length === 0) {
        toast({
          title: 'Empty file',
          description: 'No data rows detected. Please check the file and try again.',
          variant: 'destructive',
        });
        return;
      }
      const fp = await headerFingerprint(p.headers);
      let initialMapping: Record<string, CrmField> = {};
      let banner: string | null = null;
      try {
        const template = await fetchImportMappingTemplate(fp);
        if (template?.mapping) {
          // Use only mappings that match the current headers; auto-map the rest.
          for (const h of p.headers) {
            const saved = template.mapping[h];
            initialMapping[h] = (saved && (CRM_FIELDS.find((f) => f.value === saved) ? (saved as CrmField) : '_ignore')) || autoMapField(h);
          }
          const who = template.createdBy
            ? `${template.createdBy.firstName} ${template.createdBy.lastName}`
            : 'a teammate';
          banner = `Using saved mapping for this file format (last edited by ${who}).`;
        } else {
          initialMapping = Object.fromEntries(p.headers.map((h) => [h, autoMapField(h)]));
        }
      } catch {
        initialMapping = Object.fromEntries(p.headers.map((h) => [h, autoMapField(h)]));
      }

      setFileName(file.name);
      setParsed(p);
      setMapping(initialMapping);
      setFingerprint(fp);
      setTemplateBanner(banner);
      setStep('map');
    } catch (err) {
      toast({
        title: 'Could not parse file',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    await processFile(file);
  };

  const mappedFields = useMemo(() => new Set(Object.values(mapping)), [mapping]);
  const nameMapped = mappedFields.has('name');

  // Detect duplicate non-ignore mappings (e.g. two columns both mapped to "name").
  const duplicateFields = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of Object.values(mapping)) {
      if (v !== '_ignore') counts[v] = (counts[v] ?? 0) + 1;
    }
    return new Set(Object.entries(counts).filter(([, c]) => c > 1).map(([k]) => k));
  }, [mapping]);

  // ─── Step 3: group rows ────────────────────────────────────────────────────
  const groupedClients: GroupedClientWithMeta[] = useMemo(() => {
    if (!parsed) return [];

    type Bucket = {
      base: GroupedClientWithMeta;
      contacts: PendingImportContact[];
      rowCount: number;
    };
    const groups = new Map<string, Bucket>();

    const get = (header: string, row: string[]): string => {
      const idx = parsed.headers.indexOf(header);
      return idx >= 0 ? (row[idx] ?? '').trim() : '';
    };

    const fieldForHeader = (target: CrmField): string => {
      for (const [h, f] of Object.entries(mapping)) {
        if (f === target) return h;
      }
      return '';
    };

    const hName = fieldForHeader('name');
    const hIndustry = fieldForHeader('industry');
    const hAddress = fieldForHeader('address');
    const hCity = fieldForHeader('city');
    const hRegion = fieldForHeader('region');
    const hWebsite = fieldForHeader('website');
    const hCompanySize = fieldForHeader('companySize');
    const hSourceId = fieldForHeader('sourceId');
    const hContactName = fieldForHeader('contactName');
    const hContactTitle = fieldForHeader('contactTitle');
    const hContactPhone = fieldForHeader('contactPhone');
    const hContactExtension = fieldForHeader('contactExtension');
    const hContactEmail = fieldForHeader('contactEmail');
    const hContactLinkedin = fieldForHeader('contactLinkedin');

    for (const row of parsed.rows) {
      const name = hName ? get(hName, row) : '';
      if (!name) continue;

      const sourceId = hSourceId ? get(hSourceId, row) : '';
      // Group by company name (case-insensitive) so multi-contact rows merge without opaque IDs.
      const groupKey = `name:${normalizeConflictCompanyName(name)}`;

      const city = hCity ? get(hCity, row) : '';
      const region = hRegion ? get(hRegion, row) : '';
      const location = [city, region].filter(Boolean).join(', ');

      const contact: PendingImportContact = {
        name: hContactName ? get(hContactName, row) || name : name,
        title: hContactTitle ? get(hContactTitle, row) || null : null,
        email: hContactEmail ? get(hContactEmail, row) || null : null,
        phone: hContactPhone ? get(hContactPhone, row) || null : null,
        extension: hContactExtension ? get(hContactExtension, row) || null : null,
        linkedin: hContactLinkedin ? get(hContactLinkedin, row) || null : null,
      };

      const existing = groups.get(groupKey);
      if (existing) {
        existing.contacts.push(contact);
        existing.rowCount += 1;
        if (!existing.base.sourceId && sourceId) existing.base.sourceId = sourceId;
      } else {
        const base: GroupedClientWithMeta = {
          name,
          industry: hIndustry ? get(hIndustry, row) || null : null,
          location: location || null,
          address: hAddress ? get(hAddress, row) || null : null,
          companySize: hCompanySize ? get(hCompanySize, row) || null : null,
          website: hWebsite ? get(hWebsite, row) || null : null,
          employees: hCompanySize ? get(hCompanySize, row) || null : null,
          sourceId: sourceId || null,
          tags: [],
          contacts: [contact],
          _rowCount: 1,
        };
        groups.set(groupKey, { base, contacts: base.contacts ?? [], rowCount: 1 });
      }
    }

    return Array.from(groups.values()).map((g) => ({ ...g.base, contacts: g.contacts, _rowCount: g.rowCount }));
  }, [parsed, mapping]);

  const sourceRowIndex = useMemo(() => {
    if (!parsed) return null;
    return buildImportSourceRowIndex(parsed, mapping);
  }, [parsed, mapping]);

  const skippedRows = useMemo(() => {
    if (!parsed) return 0;
    const idx = Object.entries(mapping).find(([, f]) => f === 'name')?.[0];
    if (!idx) return parsed.rows.length;
    const hIdx = parsed.headers.indexOf(idx);
    return parsed.rows.filter((r) => !(r[hIdx] ?? '').trim()).length;
  }, [parsed, mapping]);

  // Run DB duplicate + existing-company check when the user reaches step 3 or changes import scope.
  // Companies that already exist are not conflicts: their contacts get appended instead.
  useEffect(() => {
    if (step !== 'group' || groupedClients.length === 0 || !importCheckParams) {
      if (step !== 'group') {
        setDbCheck({ status: 'idle', result: null });
      }
      return;
    }
    setDbCheck({ status: 'checking', result: null });
    const rows: ContactImportRow[] = groupedClients.map((c) => ({
      companyName: c.name,
      importSourceId: c.sourceId ?? null,
      contacts: c.contacts ?? [],
    }));
    checkContactImportDuplicates({ rows, ...importCheckParams })
      .then((result) => setDbCheck({ status: 'done', result }))
      .catch(() => setDbCheck({ status: 'error', result: null }));
  }, [step, groupedClients, importCheckParams]);

  /**
   * Split grouped rows using the check result:
   * matched rows → append contacts to the existing client; the rest → insert as new clients.
   */
  const importSplit = useMemo(() => {
    if (dbCheck.status !== 'done' || !dbCheck.result) return null;
    const matchedByRow = new Map(dbCheck.result.matched.map((m) => [m.rowIndex, m]));
    const newClients: GroupedClientWithMeta[] = [];
    const existing: Array<{ group: GroupedClientWithMeta; clientName: string }> = [];
    groupedClients.forEach((group, i) => {
      const match = matchedByRow.get(i);
      if (match) existing.push({ group, clientName: match.clientName });
      else newClients.push(group);
    });
    return { newClients, existing };
  }, [dbCheck, groupedClients]);

  const existingClientNameByGroup = useMemo(() => {
    const map = new Map<GroupedClientWithMeta, string>();
    for (const e of importSplit?.existing ?? []) map.set(e.group, e.clientName);
    return map;
  }, [importSplit]);

  const handleSendToPending = async () => {
    if (groupedClients.length === 0) {
      toast({ title: 'Nothing to import', description: 'No rows had a valid Company name.', variant: 'destructive' });
      return;
    }
    if (dbCheck.status !== 'done' || !dbCheck.result || countImportConflicts(dbCheck.result) > 0 || !importSplit) {
      toast({
        title: 'Import blocked',
        description: 'Fix conflicts in your file and re-upload before sending to pending.',
        variant: 'destructive',
      });
      return;
    }
    if (bothMode && !selectedImportDestination) {
      toast({
        title: 'Choose destination',
        description: 'Select global database or agency for this import.',
        variant: 'destructive',
      });
      return;
    }
    if (agencyPath && !selectedAgencyId) {
      toast({
        title: 'Select an agency',
        description: 'Choose which agency these clients should be imported into.',
        variant: 'destructive',
      });
      return;
    }
    setSubmitting(true);
    try {
      // Save mapping template for next time (best-effort; ignore failures).
      if (fingerprint) {
        try {
          await saveImportMappingTemplate({
            headerFingerprint: fingerprint,
            mapping: mapping as Record<string, string>,
            name: fileName || null,
          });
        } catch {
          /* non-fatal */
        }
      }
      const options = agencyPath
        ? { subCompanyId: selectedAgencyId, importDestination: 'agency' as const }
        : bothMode
          ? { importDestination: 'global' as const }
          : undefined;
      if (importSplit.newClients.length > 0) {
        await onImport(
          importSplit.newClients.map(({ _rowCount: _r, ...c }) => c),
          options,
        );
      }
      if (importSplit.existing.length > 0) {
        await onImportContacts(
          importSplit.existing.map(({ group }) => ({
            companyName: group.name,
            importSourceId: group.sourceId ?? null,
            contacts: group.contacts ?? [],
          })),
          options,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Failed to save',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const canAdvanceFromMap = nameMapped && duplicateFields.size === 0;

  // `hasConflicts` from the API also flags unmatched companies, but here unmatched simply
  // means "insert as new client" — only real duplicates/ambiguity block the import.
  const hasImportConflicts = dbCheck.result ? countImportConflicts(dbCheck.result) > 0 : false;
  const importCheckPending =
    step === 'group' &&
    groupedClients.length > 0 &&
    Boolean(importCheckParams) &&
    dbCheck.status === 'checking';
  const importCheckBlocked =
    step === 'group' &&
    groupedClients.length > 0 &&
    Boolean(importCheckParams) &&
    (dbCheck.status === 'error' || hasImportConflicts);
  const canSendToPending =
    !submitting &&
    groupedClients.length > 0 &&
    !(bothMode && !selectedImportDestination) &&
    !(agencyPath && !selectedAgencyId) &&
    Boolean(importCheckParams) &&
    dbCheck.status === 'done' &&
    !hasImportConflicts;

  const renderImportConfigBanner = () => {
    if (!importDestinationSummary) return null;
    const needsChoice =
      (bothMode && !selectedImportDestination) || (agencyPath && !selectedAgencyId);
    return (
      <Alert variant={needsChoice ? 'destructive' : 'default'}>
        {needsChoice ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        <AlertDescription className="text-xs">{importDestinationSummary}</AlertDescription>
      </Alert>
    );
  };

  const renderDestinationChoice = () => {
    if (!showDestinationChoice) return null;
    return (
      <div className="rounded-lg border p-4 space-y-3 bg-muted/20">
        <div>
          <p className="text-sm font-medium">Where should this import go?</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Global database = org-wide queue. Agency = that agency first, then Client Visibility → global.
          </p>
        </div>
        <RadioGroup
          value={selectedImportDestination}
          onValueChange={(v) => {
            setSelectedImportDestination(v as 'global' | 'agency');
            if (v === 'global') setSelectedAgencyId('');
          }}
          className="space-y-2"
        >
          <div className="flex items-start gap-2">
            <RadioGroupItem value="global" id="import-dest-global" className="mt-0.5" />
            <Label htmlFor="import-dest-global" className="font-normal cursor-pointer leading-snug">
              Global database
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="agency" id="import-dest-agency" className="mt-0.5" />
            <Label htmlFor="import-dest-agency" className="font-normal cursor-pointer leading-snug">
              Agency (Client Visibility)
            </Label>
          </div>
        </RadioGroup>
      </div>
    );
  };

  const renderAgencyPicker = () => {
    if (!agencyPath) return null;
    return (
      <div className="rounded-lg border p-4 space-y-2 bg-muted/20">
        <Label htmlFor="import-agency-select" className="text-sm font-medium">Agency</Label>
        <Select value={selectedAgencyId} onValueChange={setSelectedAgencyId}>
          <SelectTrigger id="import-agency-select" className="max-w-sm">
            <SelectValue placeholder="Select agency for this import…" />
          </SelectTrigger>
          <SelectContent>
            {destinationAgencies.map((a) => (
              <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          After approval, clients follow this agency&apos;s Client Visibility setting (Settings → Client Visibility).
        </p>
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <span className={step === 'upload' ? 'font-semibold text-foreground' : ''}>1. Upload</span>
      <span>›</span>
      <span className={step === 'map' ? 'font-semibold text-foreground' : ''}>2. Map columns</span>
      <span>›</span>
      <span className={step === 'group' ? 'font-semibold text-foreground' : ''}>3. Review groups</span>
    </div>
  );

  const renderUploadStep = () => (
    <div className="space-y-4">
      {renderImportConfigBanner()}
      {renderDestinationChoice()}
      {renderAgencyPicker()}
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isDragOver) setIsDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void processFile(f);
        }}
        className={[
          'group relative cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-all',
          isDragOver
            ? 'border-primary bg-primary/5 scale-[1.01]'
            : 'border-border hover:border-primary/50 hover:bg-muted/30',
        ].join(' ')}
      >
        <Input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleFileUpload}
          className="hidden"
          id="csv-upload"
        />
        <div className="flex flex-col items-center gap-3">
          <div
            className={[
              'flex h-16 w-16 items-center justify-center rounded-2xl transition-transform',
              isDragOver
                ? 'bg-primary text-primary-foreground scale-110'
                : 'bg-primary/10 text-primary group-hover:scale-105',
            ].join(' ')}
          >
            <Upload className="h-7 w-7" />
          </div>
          <div>
            <p className="text-base font-semibold">
              {isDragOver ? 'Drop your file to upload' : 'Drop a file here, or click to browse'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              The wizard auto-maps columns and lets you confirm.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center mt-1">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium">
              .csv
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium">
              .xlsx
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium">
              .xls
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
        <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <div className="space-y-1">
          <p className="font-medium">A few notes:</p>
          <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
            <li>First row should be your column headers.</li>
            <li>Rows with the same <strong>company name</strong> are merged into one client (contacts pooled).</li>
            <li>Row-number columns (Sr, #, Row) are skipped automatically.</li>
          </ul>
        </div>
      </div>
    </div>
  );

  const renderMapStep = () => {
    if (!parsed) return null;
    const previewRows = parsed.rows.slice(0, 3);
    return (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">
          File: <span className="font-medium">{fileName}</span> · {parsed.rows.length} rows
        </div>
        {templateBanner && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{templateBanner}</AlertDescription>
          </Alert>
        )}
        {!nameMapped && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Map at least one column to <strong>Company name</strong> to continue.
            </AlertDescription>
          </Alert>
        )}
        {duplicateFields.size > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Two or more columns map to the same field: {Array.from(duplicateFields).join(', ')}. Please change one.
            </AlertDescription>
          </Alert>
        )}

        <div>
          {(() => {
            const ignoredCount = Object.values(mapping).filter((v) => v === '_ignore').length;
            const mappedCount = parsed.headers.length - ignoredCount;
            const pct = parsed.headers.length === 0 ? 0 : Math.round((mappedCount / parsed.headers.length) * 100);
            const isGood = nameMapped && duplicateFields.size === 0;
            return (
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-medium whitespace-nowrap">Column mapping</span>
                <div
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border',
                    isGood
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
                  ].join(' ')}
                >
                  {isGood ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                  {mappedCount} / {parsed.headers.length} mapped
                </div>
                <div className="hidden sm:block flex-1 max-w-[200px] h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={isGood ? 'h-full bg-emerald-500 transition-all' : 'h-full bg-amber-500 transition-all'}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })()}
          {/* Card per source column. Left border colour communicates state at a glance. */}
          <div className="border rounded-md p-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
            {parsed.headers.map((h, i) => {
              const value = mapping[h] ?? '_ignore';
              const isIgnored = value === '_ignore';
              const sample = (parsed.rows[0]?.[i] ?? '').toString().trim();
              const sample2 = (parsed.rows[1]?.[i] ?? '').toString().trim();
              return (
                <div
                  key={`${h}-${i}`}
                  className={[
                    'flex flex-col gap-1 min-w-0 rounded-md border-l-[3px] bg-card/40 pl-2 pr-1 py-1.5 transition-colors',
                    isIgnored ? 'border-l-muted-foreground/20' : 'border-l-emerald-500',
                  ].join(' ')}
                >
                  <span
                    className="text-xs font-medium text-foreground truncate"
                    title={h || '(blank)'}
                  >
                    {h || <em className="text-muted-foreground">(blank)</em>}
                  </span>
                  <Select
                    value={value}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [h]: v as CrmField }))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CRM_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                          {f.required ? ' *' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Sample value(s) from the file so the mapper knows what's actually in the column. */}
                  <div className="text-[10px] text-muted-foreground leading-tight space-y-0.5 mt-0.5">
                    {sample && <div className="truncate" title={sample}>e.g. {sample}</div>}
                    {sample2 && sample2 !== sample && (
                      <div className="truncate opacity-70" title={sample2}>{sample2}</div>
                    )}
                    {!sample && !sample2 && <div className="italic opacity-60">(no data)</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <button
            type="button"
            className="text-xs font-medium underline-offset-2 hover:underline text-muted-foreground"
            onClick={() => setShowPreview((s) => !s)}
          >
            {showPreview ? 'Hide preview' : `Show preview (first 3 rows)`}
          </button>
          {showPreview && (
            <div className="border rounded-md overflow-x-auto mt-2">
              <table className="w-full text-xs">
                <thead className="bg-muted/40">
                  <tr>
                    {parsed.headers.map((h, i) => {
                      const f = mapping[h] ?? '_ignore';
                      const label = CRM_FIELDS.find((x) => x.value === f)?.label ?? '(Ignore)';
                      return (
                        <th key={`${h}-${i}`} className="text-left px-2 py-1 whitespace-nowrap">
                          <div>{h}</div>
                          <div className="text-[10px] text-muted-foreground font-normal">→ {label}</div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} className="border-t">
                      {parsed.headers.map((_, j) => (
                        <td key={j} className="px-2 py-1 whitespace-nowrap max-w-[180px] truncate">{r[j] ?? ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroupStep = () => {
    const showFew = groupedClients.slice(0, 12);
    const mergedCount = groupedClients.filter((c) => c._rowCount > 1).length;
    const totalMergedRows = groupedClients.reduce((sum, c) => sum + (c._rowCount > 1 ? c._rowCount : 0), 0);
    const dupEmails = dbCheck.result?.duplicateEmails ?? [];
    const dupPhones = dbCheck.result?.duplicatePhones ?? [];
    const ambiguousMatches = dbCheck.result?.ambiguousMatches ?? [];
    const inFileDupEmails = dbCheck.result?.inFileDuplicateEmails ?? [];
    const inFileDupPhones = dbCheck.result?.inFileDuplicatePhones ?? [];
    const hasDbConflicts =
      dupEmails.length > 0 || dupPhones.length > 0 || ambiguousMatches.length > 0;
    const hasInFileConflicts = inFileDupEmails.length > 0 || inFileDupPhones.length > 0;
    const hasAnyConflicts = hasDbConflicts || hasInFileConflicts;
    const totalConflictCount =
      dupEmails.length +
      dupPhones.length +
      ambiguousMatches.length +
      inFileDupEmails.length +
      inFileDupPhones.length;
    const newClientCount = importSplit?.newClients.length ?? 0;
    const existingClientCount = importSplit?.existing.length ?? 0;
    const splitReady = importSplit !== null;

    return (
      <div className="space-y-4">
        {renderImportConfigBanner()}
        {renderDestinationChoice()}
        {renderAgencyPicker()}

        {/* ── Stat chips ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { label: 'File rows', value: parsed?.rows.length ?? 0, color: 'text-foreground', bg: 'bg-muted/50' },
            { label: 'Unique companies', value: groupedClients.length, color: 'text-primary', bg: 'bg-primary/5 border-primary/20' },
            {
              label: 'New clients',
              value: splitReady ? newClientCount : '—',
              color: 'text-emerald-600 dark:text-emerald-400',
              bg: 'bg-emerald-500/8 border-emerald-500/20',
            },
            {
              label: 'Existing (add contacts)',
              value: splitReady ? existingClientCount : '—',
              color: 'text-blue-600 dark:text-blue-400',
              bg: 'bg-blue-500/8 border-blue-500/20',
            },
            {
              label: 'Merged groups',
              value: mergedCount,
              color: mergedCount > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground',
              bg: mergedCount > 0 ? 'bg-blue-500/8 border-blue-500/20' : 'bg-muted/50',
            },
            {
              label: 'Skipped rows',
              value: skippedRows,
              color: skippedRows > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
              bg: skippedRows > 0 ? 'bg-amber-500/8 border-amber-500/20' : 'bg-muted/50',
            },
          ].map(({ label, value, color, bg }) => (
            <div key={label} className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 ${bg}`}>
              <span className={`text-xl font-bold leading-none ${color}`}>{value}</span>
              <span className="text-[11px] text-muted-foreground font-medium">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Intra-file merge notice ─────────────────────────────── */}
        {mergedCount > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-4 py-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50">
              <GitMerge className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                {totalMergedRows} rows merged into {mergedCount} client{mergedCount > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-blue-700/70 dark:text-blue-300/70 mt-0.5">
                Rows sharing the same company name were combined — each group's contacts are pooled into one client.
              </p>
            </div>
          </div>
        )}

        {/* ── DB duplicate check status ───────────────────────────── */}
        {dbCheck.status === 'checking' && (
          <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
            <span className="h-4 w-4 shrink-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            <span className="text-sm text-muted-foreground">Checking for conflicts with existing CRM contacts…</span>
          </div>
        )}

        {dbCheck.status === 'error' && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-800 dark:text-red-200">
              Conflict check unavailable — import cannot proceed. Try again or fix your file and re-upload.
            </span>
          </div>
        )}

        {!importCheckParams && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-800 dark:text-amber-200">
              Choose an import destination before conflict checks can run.
            </span>
          </div>
        )}

        {dbCheck.status === 'done' && !hasAnyConflicts && importCheckParams && (
          <div className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">No conflicts found</p>
              <p className="text-xs text-emerald-700/70 dark:text-emerald-300/70">
                {existingClientCount > 0
                  ? `${newClientCount} new client${newClientCount === 1 ? '' : 's'} will be created and contacts will be added to ${existingClientCount} existing client${existingClientCount === 1 ? '' : 's'}.`
                  : 'All emails and phone numbers are new in the CRM.'}
              </p>
            </div>
          </div>
        )}

        {dbCheck.status === 'done' && hasAnyConflicts && dbCheck.result && (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 overflow-hidden">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 border-b border-red-200 dark:border-red-800">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    {totalConflictCount} conflict{totalConflictCount > 1 ? 's' : ''} found
                  </p>
                  <p className="text-xs text-red-700/70 dark:text-red-300/70">
                    Fix conflicts in your file and re-upload. Import cannot proceed.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-red-300 dark:border-red-700 bg-white/80 dark:bg-red-950/40 text-red-800 dark:text-red-200 hover:bg-red-100/80 dark:hover:bg-red-900/40"
                  onClick={() => setShowAllErrors(true)}
                >
                  <FileText className="h-3.5 w-3.5 mr-1.5" />
                  View complete errors
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-red-300 dark:border-red-700 bg-white/80 dark:bg-red-950/40 text-red-800 dark:text-red-200 hover:bg-red-100/80 dark:hover:bg-red-900/40"
                  onClick={() => {
                    void downloadImportErrorsExcel(dbCheck.result!, fileName, sourceRowIndex, parsed);
                  }}
                >
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Download Excel report
                </Button>
              </div>
            </div>
            <div className="px-4 py-3 space-y-3">
              {inFileDupEmails.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1.5 uppercase tracking-wide">
                    Duplicate emails in file ({inFileDupEmails.length})
                  </p>
                  <div className="space-y-1">
                    {inFileDupEmails.slice(0, 5).map((email) => (
                      <div key={email} className="rounded-md bg-red-100/60 dark:bg-red-900/20 px-2.5 py-1.5">
                        <span className="font-mono text-xs text-red-800 dark:text-red-200 truncate">
                          {email}{lineSuffix(rowsForEmail(sourceRowIndex, email))}
                        </span>
                      </div>
                    ))}
                    {inFileDupEmails.length > 5 && (
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 pl-1">+{inFileDupEmails.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
              {inFileDupPhones.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1.5 uppercase tracking-wide">
                    Duplicate phone numbers in file ({inFileDupPhones.length})
                  </p>
                  <div className="space-y-1">
                    {inFileDupPhones.slice(0, 5).map((phone) => (
                      <div key={phone} className="rounded-md bg-red-100/60 dark:bg-red-900/20 px-2.5 py-1.5">
                        <span className="font-mono text-xs text-red-800 dark:text-red-200 truncate">
                          {phone}{lineSuffix(rowsForPhone(sourceRowIndex, phone))}
                        </span>
                      </div>
                    ))}
                    {inFileDupPhones.length > 5 && (
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 pl-1">+{inFileDupPhones.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
              {ambiguousMatches.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1.5 uppercase tracking-wide">
                    Ambiguous company matches ({ambiguousMatches.length})
                  </p>
                  <div className="space-y-1">
                    {ambiguousMatches.slice(0, 5).map((d) => (
                      <div key={`${d.matchKey}:${d.matchValue}`} className="flex items-center justify-between gap-2 rounded-md bg-red-100/60 dark:bg-red-900/20 px-2.5 py-1.5">
                        <span className="text-xs text-red-800 dark:text-red-200 truncate">
                          {d.matchValue}{lineSuffix(rowsForCompany(sourceRowIndex, d.matchValue))}
                        </span>
                        <span className="text-[11px] text-red-600 dark:text-red-400 shrink-0">→ {d.clientIds.length} existing clients</span>
                      </div>
                    ))}
                    {ambiguousMatches.length > 5 && (
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 pl-1">+{ambiguousMatches.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
              {dupEmails.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1.5 uppercase tracking-wide">
                    Emails ({dupEmails.length})
                  </p>
                  <div className="space-y-1">
                    {dupEmails.slice(0, 5).map((d) => (
                      <div key={d.email} className="flex items-center justify-between gap-2 rounded-md bg-red-100/60 dark:bg-red-900/20 px-2.5 py-1.5">
                        <span className="font-mono text-xs text-red-800 dark:text-red-200 truncate">
                          {d.email}{lineSuffix(rowsForEmail(sourceRowIndex, d.email))}
                        </span>
                        <span className="text-[11px] text-red-600 dark:text-red-400 shrink-0">→ {d.clientName}</span>
                      </div>
                    ))}
                    {dupEmails.length > 5 && (
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 pl-1">+{dupEmails.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
              {dupPhones.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-700 dark:text-red-300 mb-1.5 uppercase tracking-wide">
                    Phone numbers ({dupPhones.length})
                  </p>
                  <div className="space-y-1">
                    {dupPhones.slice(0, 5).map((d) => (
                      <div key={d.phone} className="flex items-center justify-between gap-2 rounded-md bg-red-100/60 dark:bg-red-900/20 px-2.5 py-1.5">
                        <span className="font-mono text-xs text-red-800 dark:text-red-200 truncate">
                          {d.phone}{lineSuffix(rowsForPhone(sourceRowIndex, d.phone))}
                        </span>
                        <span className="text-[11px] text-red-600 dark:text-red-400 shrink-0">→ {d.clientName}</span>
                      </div>
                    ))}
                    {dupPhones.length > 5 && (
                      <p className="text-[11px] text-red-600/70 dark:text-red-400/70 pl-1">+{dupPhones.length - 5} more</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Groups table ────────────────────────────────────────── */}
        <div className="rounded-lg border overflow-hidden">
          <div className="max-h-[260px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                <tr className="bg-muted/60 border-b">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Company</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">External ID</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Industry</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contacts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {showFew.map((c, i) => (
                  <tr key={i} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{c.name}</span>
                        {splitReady && (
                          existingClientNameByGroup.has(c) ? (
                            <span
                              className="inline-flex items-center rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                              title={`Contacts will be added to existing client "${existingClientNameByGroup.get(c)}"`}
                            >
                              Existing · add contacts
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                              New client
                            </span>
                          )
                        )}
                        {c._rowCount > 1 && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700 px-1.5 py-0.5 text-[10px] font-semibold leading-none">
                            <GitMerge className="h-2.5 w-2.5" />
                            {c._rowCount} rows
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {c.sourceId
                        ? <Badge variant="secondary" className="font-mono text-[11px]">{c.sourceId}</Badge>
                        : <span className="text-muted-foreground/50 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground hidden sm:table-cell">
                      {c.industry || <span className="opacity-40">—</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={[
                        'inline-flex items-center justify-center rounded-full text-[11px] font-semibold min-w-[20px] h-5 px-1.5',
                        (c.contacts?.length ?? 0) > 1
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground',
                      ].join(' ')}>
                        {c.contacts?.length ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
                {groupedClients.length > showFew.length && (
                  <tr>
                    <td colSpan={4} className="px-4 py-2.5 text-center text-xs text-muted-foreground bg-muted/20">
                      +{groupedClients.length - showFew.length} more clients not shown
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    );
  };

  const conflictResult = dbCheck.result;
  const fullErrorSections: Array<{
    key: string;
    title: string;
    items: Array<{ key: string; primary: string; secondary?: string; mono?: boolean }>;
  }> = conflictResult
    ? [
        {
          key: 'inFileEmails',
          title: 'Duplicate emails in file',
          items: conflictResult.inFileDuplicateEmails.map((email) => ({
            key: email,
            primary: `${email}${lineSuffix(rowsForEmail(sourceRowIndex, email))}`,
            mono: true,
          })),
        },
        {
          key: 'inFilePhones',
          title: 'Duplicate phone numbers in file',
          items: conflictResult.inFileDuplicatePhones.map((phone) => ({
            key: phone,
            primary: `${phone}${lineSuffix(rowsForPhone(sourceRowIndex, phone))}`,
            mono: true,
          })),
        },
        {
          key: 'ambiguous',
          title: 'Ambiguous company matches',
          items: conflictResult.ambiguousMatches.map((d) => ({
            key: `${d.matchKey}:${d.matchValue}`,
            primary: `${d.matchValue}${lineSuffix(rowsForCompany(sourceRowIndex, d.matchValue))}`,
            secondary: `→ ${d.clientIds.length} existing clients`,
          })),
        },
        {
          key: 'emails',
          title: 'Emails already in CRM',
          items: conflictResult.duplicateEmails.map((d) => ({
            key: d.email,
            primary: `${d.email}${lineSuffix(rowsForEmail(sourceRowIndex, d.email))}`,
            secondary: `→ ${d.clientName}`,
            mono: true,
          })),
        },
        {
          key: 'phones',
          title: 'Phone numbers already in CRM',
          items: conflictResult.duplicatePhones.map((d) => ({
            key: d.phone,
            primary: `${d.phone}${lineSuffix(rowsForPhone(sourceRowIndex, d.phone))}`,
            secondary: `→ ${d.clientName}`,
            mono: true,
          })),
        },
      ].filter((s) => s.items.length > 0)
    : [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="!max-w-[1400px] w-[95vw] max-h-[95vh] overflow-y-auto overflow-x-hidden !gap-2 !p-4">
          <DialogHeader className="!space-y-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Import Clients
            </DialogTitle>
            <DialogDescription className="text-xs">
              Upload a CSV/Excel file, confirm the mapping, and review groups before they go to Pending for approval.
              New companies are inserted as clients; companies that already exist get the file&apos;s contacts added to them.
              {elevatedConfig?.destination === 'both' ? (
                <> When org allows both paths, choose global or agency on this screen (Settings → Approvals → Global Database).</>
              ) : targetAgencyName ? (
                <>
                  {' '}
                  Imports will be queued for <strong>{targetAgencyName}</strong> (the agency selected in the top filter).
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {storageContext && !clientFlowConfig && (
              <ClientStorageContextBanner {...storageContext} pending />
            )}
            {renderStepIndicator()}
            {step === 'upload' && renderUploadStep()}
            {step === 'map' && renderMapStep()}
            {step === 'group' && renderGroupStep()}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <div className="flex items-center gap-2">
              {step === 'map' && (
                <>
                  <Button variant="outline" onClick={() => setStep('upload')} disabled={submitting}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => setStep('group')} disabled={!canAdvanceFromMap}>
                    Next <ArrowRight className="h-4 w-4 ml-1" />
                  </Button>
                </>
              )}
              {step === 'group' && (
                <>
                  <Button variant="outline" onClick={() => setStep('map')} disabled={submitting}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={handleSendToPending}
                    disabled={!canSendToPending}
                  >
                    {submitting
                      ? 'Saving…'
                      : importCheckPending
                        ? 'Checking conflicts…'
                        : importCheckBlocked
                          ? 'Conflicts found'
                          : 'Send to Pending'}
                  </Button>
                </>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAllErrors} onOpenChange={setShowAllErrors}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col gap-3">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Complete import errors
            </DialogTitle>
            <DialogDescription className="text-xs">
              {conflictResult
                ? `${countImportConflicts(conflictResult)} conflict${countImportConflicts(conflictResult) === 1 ? '' : 's'}${fileName ? ` in ${fileName}` : ''}. Use this list to refine your file, then re-upload.`
                : 'No conflict details available.'}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto space-y-4 pr-1">
            {fullErrorSections.map((section) => (
              <div key={section.key}>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">
                  {section.title} ({section.items.length})
                </p>
                <div className="space-y-1">
                  {section.items.map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-2.5 py-1.5"
                    >
                      <span className={['text-xs truncate', item.mono ? 'font-mono' : ''].join(' ')}>
                        {item.primary}
                      </span>
                      {item.secondary ? (
                        <span className="text-[11px] text-muted-foreground shrink-0">{item.secondary}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!conflictResult}
              onClick={() => {
                if (conflictResult) {
                  void downloadImportErrorsExcel(conflictResult, fileName, sourceRowIndex, parsed);
                }
              }}
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download Excel report
            </Button>
            <Button type="button" size="sm" onClick={() => setShowAllErrors(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
