// A single text item (or partial item) that appears on the same baseline as a
// placeholder, after it. Stored at upload time so fillTemplate can erase these
// items and redraw them shifted left to close the gap when the substituted
// value is shorter than the placeholder.
export interface AnchorLineItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
}

export interface AnchorBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  originalText: string;
  // true when text follows on the same baseline (inline sentence/paragraph).
  // false / undefined → standalone cell (signature table, etc.).
  isInline?: boolean;
  // Text items on the same baseline that come after the placeholder.
  // Used for gap-closing reflow in fillTemplate.
  lineItems?: AnchorLineItem[];
}

export type AnchorToken =
  | 'today'
  | 'agency_name'
  | 'client_name'
  | 'client_industry'
  | 'minimum_hours'
  | 'bill_rate'
  | 'payment_days'
  | 'sender_name'
  | 'signing_authority';

export type AnchorMap = Partial<Record<AnchorToken, AnchorBox[]>>;

export interface AnchorExtractionResult {
  map: AnchorMap;
  detected: AnchorToken[];
  missed: AnchorToken[];
  totalOccurrences: number;
}
