import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useDocumentStore,
  DocumentTemplate,
  generateDocumentId,
  replaceFieldsInContent,
  getFieldSuggestions,
} from '@/lib/documentStore';
import { toast } from '@/hooks/use-toast';
import { jsPDF } from 'jspdf';
import { FileText, Download, Copy, Eye, Sparkles, Loader2 } from 'lucide-react';

interface GenerateDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: DocumentTemplate | null;
}

export function GenerateDocumentDialog({
  open,
  onOpenChange,
  template,
}: GenerateDocumentDialogProps) {
  const { addGeneratedDocument } = useDocumentStore();
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [previewContent, setPreviewContent] = useState('');
  const [activeTab, setActiveTab] = useState('fields');
  const [isDownloading, setIsDownloading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  // Initialize field values when template changes
  useEffect(() => {
    if (template) {
      const initialValues: Record<string, string> = {};
      template.fields.forEach((field) => {
        initialValues[field.placeholder] = '';
      });
      setFieldValues(initialValues);
      setPreviewContent(template.content);
    }
  }, [template]);

  // Update preview when field values change
  useEffect(() => {
    if (template) {
      const replaced = replaceFieldsInContent(template.content, fieldValues);
      setPreviewContent(replaced);
    }
  }, [fieldValues, template]);

  const handleFieldChange = (placeholder: string, value: string) => {
    setFieldValues((prev) => ({
      ...prev,
      [placeholder]: value,
    }));
  };

  // Generate PDF from HTML content using jsPDF
  const generatePdfFromHtml = (htmlContent: string, fileName: string): Promise<Blob> => {
    return new Promise((resolve) => {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      // Parse HTML and extract text
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = htmlContent;
      
      const pageWidth = 210;
      const pageHeight = 297;
      const margin = 20;
      const lineHeight = 6;
      const contentWidth = pageWidth - margin * 2;
      
      let y = margin;
      
      // Process each element
      const elements = tempDiv.querySelectorAll('h2, h3, p, br, div');
      
      elements.forEach((element) => {
        const tagName = element.tagName.toLowerCase();
        const text = element.textContent?.trim() || '';
        
        if (!text && tagName !== 'br' && !element.hasAttribute('style')) return;
        
        // Check for page break
        if (tagName === 'div' && element.getAttribute('style')?.includes('page-break')) {
          doc.addPage();
          y = margin;
          return;
        }
        
        // Add line break
        if (tagName === 'br') {
          y += lineHeight;
          return;
        }
        
        // Check if we need a new page
        if (y > pageHeight - margin) {
          doc.addPage();
          y = margin;
        }
        
        // Style based on element type
        if (tagName === 'h2') {
          doc.setFontSize(14);
          doc.setFont('helvetica', 'bold');
          y += 4; // Extra space before heading
        } else if (tagName === 'h3') {
          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          y += 2;
        } else {
          doc.setFontSize(10);
          // Check if it's bold text
          if (element.querySelector('strong') || element.innerHTML.includes('<strong>')) {
            doc.setFont('helvetica', 'bold');
          } else {
            doc.setFont('helvetica', 'normal');
          }
        }
        
        // Split text to fit within page width
        const lines = doc.splitTextToSize(text, contentWidth);
        
        lines.forEach((line: string) => {
          if (y > pageHeight - margin) {
            doc.addPage();
            y = margin;
          }
          doc.text(line, margin, y);
          y += lineHeight;
        });
        
        // Extra space after headings
        if (tagName === 'h2' || tagName === 'h3') {
          y += 2;
        }
      });
      
      const blob = doc.output('blob');
      resolve(blob);
    });
  };

  const handleGenerate = async () => {
    if (!template) return;

    // Check if all fields are filled
    const emptyFields = template.fields.filter(
      (f) => !fieldValues[f.placeholder]?.trim()
    );
    
    if (emptyFields.length > 0) {
      toast({
        title: 'Missing Fields',
        description: `Please fill in all fields: ${emptyFields.map((f) => f.name).join(', ')}`,
        variant: 'destructive',
      });
      return;
    }

    setIsGenerating(true);

    try {
      const clientName = fieldValues['[Client Company Name]'] || 
                         fieldValues['[Client Name]'] || 
                         'Unknown Client';

      addGeneratedDocument({
        id: generateDocumentId(),
        templateId: template.id,
        templateName: template.name,
        clientName,
        fieldValues,
        content: previewContent,
        generatedAt: new Date().toISOString(),
      });

      toast({
        title: 'Document Generated',
        description: `Document for "${clientName}" has been generated and saved.`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating document:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate document. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyContent = () => {
    // Strip HTML tags for clipboard
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = previewContent;
    navigator.clipboard.writeText(tempDiv.textContent || tempDiv.innerText || '');
    toast({
      title: 'Copied',
      description: 'Document content copied to clipboard.',
    });
  };

  const handleDownload = async () => {
    if (!template) return;
    
    setIsDownloading(true);
    
    try {
      const clientName = fieldValues['[Client Company Name]'] || fieldValues['[Client Name]'] || 'Client';
      
      // Generate PDF from HTML content
      const pdfBlob = await generatePdfFromHtml(previewContent, `${template.name}_${clientName}`);
      
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${template.name}_${clientName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({
        title: 'Downloaded',
        description: 'PDF document downloaded successfully.',
      });
    } catch (error) {
      console.error('Error downloading:', error);
      toast({
        title: 'Error',
        description: 'Failed to download document. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const filledCount = template?.fields.filter(
    (f) => fieldValues[f.placeholder]?.trim()
  ).length || 0;
  const totalCount = template?.fields.length || 0;
  const allFilled = filledCount === totalCount && totalCount > 0;

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Generate Document
          </DialogTitle>
          <DialogDescription>
            Fill in the fields below to generate "{template.name}" for a client.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="fields" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Fill Fields ({filledCount}/{totalCount})
            </TabsTrigger>
            <TabsTrigger value="preview" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fields" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-4">
                {template.fields.map((field, index) => {
                  const suggestions = getFieldSuggestions(field.name);
                  const isFilled = !!fieldValues[field.placeholder]?.trim();

                  return (
                    <div key={index} className="space-y-2">
                      <Label
                        htmlFor={`field-${index}`}
                        className="flex items-center gap-2"
                      >
                        <span>{field.name}</span>
                        {isFilled && (
                          <span className="text-xs text-green-600">✓</span>
                        )}
                      </Label>
                      <Input
                        id={`field-${index}`}
                        value={fieldValues[field.placeholder] || ''}
                        onChange={(e) =>
                          handleFieldChange(field.placeholder, e.target.value)
                        }
                        placeholder={`Enter ${field.name.toLowerCase()}`}
                        className={isFilled ? 'border-green-500/50' : ''}
                      />
                      {suggestions.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {suggestions.map((suggestion, i) => (
                            <Button
                              key={i}
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() =>
                                handleFieldChange(field.placeholder, suggestion)
                              }
                            >
                              {suggestion}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="space-y-2">
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={handleCopyContent}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy Text
                </Button>
                <Button variant="outline" size="sm" onClick={handleDownload} disabled={isDownloading}>
                  {isDownloading ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  {isDownloading ? 'Generating...' : 'Download PDF'}
                </Button>
              </div>
              <ScrollArea className="h-[350px] rounded-lg border bg-white p-6">
                <div
                  ref={previewRef}
                  className="prose prose-sm max-w-none text-black"
                  style={{ fontFamily: 'Arial, sans-serif', lineHeight: '1.6' }}
                  dangerouslySetInnerHTML={{ __html: previewContent }}
                />
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleGenerate} disabled={!allFilled || isGenerating}>
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Generating...
              </>
            ) : (
              'Generate & Save'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
