import { useState, useRef } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDocumentStore, generateDocumentId, extractFieldsFromContent, DocumentField } from '@/lib/documentStore';
import { extractPdfToHtml, arrayBufferToBase64 } from '@/lib/pdfUtils';
import { toast } from '@/hooks/use-toast';
import { Upload, FileText, CalendarIcon, AlertCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import mammoth from 'mammoth';

interface UploadDocumentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UploadDocumentDialog({ open, onOpenChange }: UploadDocumentDialogProps) {
  const { addTemplate } = useDocumentStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [fields, setFields] = useState<DocumentField[]>([]);
  const [expiryDate, setExpiryDate] = useState<Date | undefined>();
  const [isProcessing, setIsProcessing] = useState(false);
  const [fileType, setFileType] = useState<'pdf' | 'docx' | 'txt' | 'other'>('other');
  const [pdfBytes, setPdfBytes] = useState<string | undefined>();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setFileName(file.name);
    setContent('');
    setFields([]);
    setPdfBytes(undefined);
    
    // Set default name from filename (without extension)
    const defaultName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');
    setName(defaultName);

    try {
      let text = '';
      const extension = file.name.toLowerCase().split('.').pop();
      
      if (extension === 'pdf') {
        setFileType('pdf');
        const arrayBuffer = await file.arrayBuffer();
        
        // Store original PDF bytes as base64
        setPdfBytes(arrayBufferToBase64(arrayBuffer));
        
        // Extract text as HTML for field detection and proper rendering
        const extracted = await extractPdfToHtml(arrayBuffer);
        text = extracted.htmlContent;
      } else if (extension === 'docx') {
        setFileType('docx');
        text = await readDocxFile(file);
      } else if (extension === 'doc') {
        toast({
          title: 'Unsupported Format',
          description: 'Old .doc format is not supported. Please save as .docx, .pdf, or .txt',
          variant: 'destructive',
        });
        setIsProcessing(false);
        return;
      } else {
        setFileType('txt');
        text = await readFileAsText(file);
      }
      
      setContent(text);
      
      // Extract fields from content
      const extractedFields = extractFieldsFromContent(text);
      setFields(extractedFields);
      
      if (extractedFields.length === 0) {
        toast({
          title: 'No Fields Found',
          description: 'No placeholder fields like [Field Name] were found in this document.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Fields Detected',
          description: `Found ${extractedFields.length} placeholder field(s) in the document.`,
        });
      }
    } catch (error) {
      console.error('Error reading file:', error);
      toast({
        title: 'Error Reading File',
        description: 'Could not read the file. Please try a different format.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  };

  const readDocxFile = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const arrayBuffer = reader.result as ArrayBuffer;
          const result = await mammoth.convertToHtml({ arrayBuffer });
          resolve(result.value);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  };

  const handleSave = () => {
    if (!name.trim()) {
      toast({ title: 'Error', description: 'Please enter a document name.', variant: 'destructive' });
      return;
    }
    if (!content.trim()) {
      toast({ title: 'Error', description: 'Please upload a document.', variant: 'destructive' });
      return;
    }

    const now = new Date().toISOString();
    addTemplate({
      id: generateDocumentId(),
      name: name.trim(),
      fileName,
      fileType,
      content,
      pdfBytes,
      fields,
      expiryDate: expiryDate?.toISOString(),
      createdAt: now,
      updatedAt: now,
    });

    toast({
      title: 'Template Saved',
      description: `Document template "${name}" has been saved with ${fields.length} field(s).`,
    });

    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setName('');
    setFileName('');
    setContent('');
    setFields([]);
    setExpiryDate(undefined);
    setFileType('other');
    setPdfBytes(undefined);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Document Template
          </DialogTitle>
          <DialogDescription>
            Upload a PDF or DOCX with placeholder fields like [Client Company Name] or [Date]. 
            These will be recognized and can be filled when generating documents.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Upload */}
          <div className="space-y-2">
            <Label>Document File</Label>
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
                "hover:border-primary hover:bg-muted/50",
                fileName ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.html,.doc,.docx"
                onChange={handleFileChange}
                className="hidden"
              />
              {fileName && !isProcessing ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium">{fileName}</p>
                    <p className="text-sm text-muted-foreground">
                      {fileType.toUpperCase()} • {fields.length} field(s) detected
                    </p>
                  </div>
                </div>
              ) : isProcessing ? (
                <div className="space-y-2">
                  <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Processing document...</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Click to upload or drag and drop
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Supports .pdf, .docx, .txt, .md, .html files
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Document Name */}
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Direct Placement Agreement"
            />
          </div>

          {/* Expiry Date */}
          <div className="space-y-2">
            <Label>Expiry Date (Optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !expiryDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {expiryDate ? format(expiryDate, 'PPP') : 'Select expiry date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={expiryDate}
                  onSelect={setExpiryDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Detected Fields */}
          {fields.length > 0 && (
            <div className="space-y-2">
              <Label>Detected Fields ({fields.length})</Label>
              <div className="flex flex-wrap gap-2 p-3 bg-muted rounded-lg">
                {fields.map((field, index) => (
                  <Badge key={index} variant="secondary">
                    {field.name}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Warning if no fields */}
          {content && fields.length === 0 && (
            <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
              <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-600">No placeholder fields found</p>
                <p className="text-muted-foreground">
                  Make sure your document contains fields in [Square Brackets] format.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!content || isProcessing}>
            {isProcessing ? 'Processing...' : 'Save Template'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
