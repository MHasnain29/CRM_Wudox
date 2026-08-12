import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDocumentStore, GeneratedDocument } from '@/lib/documentStore';
import { toast } from '@/hooks/use-toast';
import { jsPDF } from 'jspdf';
import { FileText, Trash2, Copy, Download, Eye, User, Clock, Loader2 } from 'lucide-react';
import { format } from 'date-fns';

// Generate PDF from HTML content using jsPDF
const generatePdfFromHtml = (htmlContent: string): Promise<Blob> => {
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
        y += 4;
      } else if (tagName === 'h3') {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        y += 2;
      } else {
        doc.setFontSize(10);
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

export function GeneratedDocumentsPanel() {
  const { generatedDocuments, deleteGeneratedDocument } = useDocumentStore();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewDoc, setViewDoc] = useState<GeneratedDocument | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleCopy = (doc: GeneratedDocument) => {
    // Strip HTML tags for clipboard
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = doc.content;
    navigator.clipboard.writeText(tempDiv.textContent || tempDiv.innerText || '');
    toast({ title: 'Copied', description: 'Document content copied to clipboard.' });
  };

  const handleDownload = async (doc: GeneratedDocument) => {
    setDownloadingId(doc.id);
    
    try {
      // Generate PDF from stored HTML content
      const pdfBlob = await generatePdfFromHtml(doc.content);
      
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.templateName}_${doc.clientName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      toast({ title: 'Downloaded', description: 'PDF document downloaded.' });
    } catch (error) {
      console.error('Error downloading:', error);
      toast({ title: 'Error', description: 'Failed to download document.', variant: 'destructive' });
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteGeneratedDocument(deleteId);
      setDeleteId(null);
      toast({ title: 'Deleted', description: 'Generated document deleted.' });
    }
  };

  return (
    <>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{generatedDocuments.length} document(s) generated</p>
        {generatedDocuments.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <FileText className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <p className="text-base font-medium mb-1">No documents generated yet</p>
              <p className="text-muted-foreground text-sm text-center max-w-sm">
                Go to the Templates tab, select a template and generate a document for a client
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {generatedDocuments.map((doc) => (
                  <Card key={doc.id} className="p-3 hover:bg-muted/30 transition-colors">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{doc.templateName}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="secondary" className="text-xs gap-1">
                              <User className="h-3 w-3" />
                              {doc.clientName}
                            </Badge>
                            <Badge variant="outline" className="text-xs">
                              PDF
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {format(new Date(doc.generatedAt), 'MMM d, yyyy h:mm a')}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewDoc(doc)}
                          className="h-7 px-2"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(doc)}
                          className="h-7 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownload(doc)}
                          className="h-7 px-2"
                          disabled={downloadingId === doc.id}
                        >
                          {downloadingId === doc.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(doc.id)}
                          className="h-7 px-2 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
          </div>
        )}
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the generated document.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* View Document Dialog */}
      <Dialog open={!!viewDoc} onOpenChange={() => setViewDoc(null)}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewDoc?.templateName}</DialogTitle>
            <DialogDescription>
              Generated for {viewDoc?.clientName} on{' '}
              {viewDoc && format(new Date(viewDoc.generatedAt), 'MMMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>

          {viewDoc && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => handleCopy(viewDoc)}>
                  <Copy className="h-4 w-4 mr-1" />
                  Copy Text
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => handleDownload(viewDoc)}
                  disabled={downloadingId === viewDoc.id}
                >
                  {downloadingId === viewDoc.id ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-1" />
                  )}
                  {downloadingId === viewDoc.id ? 'Downloading...' : 'Download PDF'}
                </Button>
              </div>

              <ScrollArea className="h-[400px] rounded-lg border bg-white p-6">
                <div
                  className="prose prose-sm max-w-none text-black"
                  style={{ fontFamily: 'Arial, sans-serif', lineHeight: '1.6' }}
                  dangerouslySetInnerHTML={{ __html: viewDoc.content }}
                />
              </ScrollArea>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
