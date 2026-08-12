import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;

export interface TextPosition {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pageIndex: number;
}

export interface ExtractedPdfContent {
  htmlContent: string;
  plainText: string;
  pageCount: number;
}

// Extract text content from PDF and convert to structured HTML
export async function extractPdfToHtml(pdfBytes: ArrayBuffer): Promise<ExtractedPdfContent> {
  const pdf = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
  let htmlContent = '';
  let plainText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    
    // Group text items by approximate line (using y position)
    const lines: Map<number, { text: string; x: number; fontSize: number; isBold: boolean }[]> = new Map();
    
    for (const item of textContent.items as any[]) {
      if (!item.str || item.str.trim() === '') continue;
      
      const transform = item.transform;
      const y = Math.round(viewport.height - transform[5]); // Round to group nearby items
      const x = transform[4];
      const fontSize = Math.abs(transform[0]) || 12;
      const fontName = item.fontName || '';
      const isBold = fontName.toLowerCase().includes('bold');
      
      // Group by y position with some tolerance (within 5 units = same line)
      const lineKey = Math.round(y / 5) * 5;
      
      if (!lines.has(lineKey)) {
        lines.set(lineKey, []);
      }
      lines.get(lineKey)!.push({ text: item.str, x, fontSize, isBold });
    }
    
    // Sort lines by y position (top to bottom)
    const sortedLines = Array.from(lines.entries()).sort((a, b) => a[0] - b[0]);
    
    // Add page break if not first page
    if (i > 1) {
      htmlContent += '<div style="page-break-before: always; margin-top: 30px;"></div>\n';
    }
    
    let prevY = 0;
    let prevFontSize = 12;
    
    for (const [lineY, items] of sortedLines) {
      // Sort items within line by x position (left to right)
      items.sort((a, b) => a.x - b.x);
      
      // Detect paragraph breaks (larger vertical gap)
      const yGap = lineY - prevY;
      if (prevY > 0 && yGap > prevFontSize * 2) {
        htmlContent += '<br/>\n';
      }
      
      // Combine text in line
      const lineText = items.map(item => item.text).join(' ');
      const maxFontSize = Math.max(...items.map(i => i.fontSize));
      const hasBold = items.some(i => i.isBold);
      
      // Detect headings (larger font or numbered sections)
      const isHeading = maxFontSize > 14 || /^[0-9]+\.?\s+[A-Z]/.test(lineText.trim());
      const isNumberedSection = /^#?\s*[0-9]+\.?\s+/.test(lineText.trim());
      
      if (isHeading || isNumberedSection) {
        const headingLevel = maxFontSize > 16 ? 'h2' : 'h3';
        htmlContent += `<${headingLevel} style="margin-top: 16px; margin-bottom: 8px; font-weight: bold;">${lineText}</${headingLevel}>\n`;
      } else if (hasBold && lineText.length < 100) {
        htmlContent += `<p style="margin-bottom: 4px;"><strong>${lineText}</strong></p>\n`;
      } else {
        htmlContent += `<p style="margin-bottom: 4px;">${lineText}</p>\n`;
      }
      
      plainText += lineText + '\n';
      prevY = lineY;
      prevFontSize = maxFontSize;
    }
  }
  
  return {
    htmlContent,
    plainText,
    pageCount: pdf.numPages
  };
}

// Simple text extraction for field detection
export async function extractTextFromPdf(pdfBytes: ArrayBuffer): Promise<string> {
  const result = await extractPdfToHtml(pdfBytes);
  return result.plainText;
}

// Convert ArrayBuffer to base64 string
export function arrayBufferToBase64(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer as ArrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert base64 string to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
