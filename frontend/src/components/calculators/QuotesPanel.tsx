import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
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
import { useQuoteStore, Quote, formatCurrency, formatPercent } from '@/lib/quoteStore';
import { toast } from '@/hooks/use-toast';
import { 
  FileText, 
  Trash2, 
  Copy, 
  Download, 
  Eye,
  Clock,
  User,
  Calculator
} from 'lucide-react';
import { format } from 'date-fns';

export function QuotesPanel() {
  const { quotes, deleteQuote } = useQuoteStore();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewQuote, setViewQuote] = useState<Quote | null>(null);

  const getTypeLabel = (type: Quote['calculatorType']) => {
    const labels = {
      MARKUP: 'Markup',
      REVERSE_MARKUP: 'Reverse Markup',
      SAVINGS: 'Savings',
    };
    return labels[type];
  };

  const getTypeBadgeVariant = (type: Quote['calculatorType']) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
      MARKUP: 'default',
      REVERSE_MARKUP: 'secondary',
      SAVINGS: 'outline',
    };
    return variants[type];
  };

  const handleCopySummary = (quote: Quote) => {
    navigator.clipboard.writeText(quote.summary);
    toast({
      title: 'Copied',
      description: 'Quote summary copied to clipboard.',
    });
  };

  const handleDownloadCSV = (quote: Quote) => {
    const headers = ['Field', 'Value'];
    const rows = [
      ['Title', quote.title],
      ['Type', getTypeLabel(quote.calculatorType)],
      ['Created', format(new Date(quote.createdAt), 'MMM d, yyyy h:mm a')],
      ['Client', quote.clientName || ''],
      ['Summary', quote.summary],
      ['Notes', quote.notes || ''],
      ...Object.entries(quote.inputs).map(([key, val]) => [`Input: ${key}`, String(val)]),
      ...Object.entries(quote.results).map(([key, val]) => [`Result: ${key}`, String(val)]),
    ];
    
    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quote-${quote.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({
      title: 'Downloaded',
      description: 'Quote CSV file downloaded.',
    });
  };

  const handleDelete = () => {
    if (deleteId) {
      deleteQuote(deleteId);
      setDeleteId(null);
      toast({
        title: 'Deleted',
        description: 'Quote has been deleted.',
      });
    }
  };

  const renderQuoteDetails = (quote: Quote) => {
    switch (quote.calculatorType) {
      case 'MARKUP':
        return (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Hourly Wage</p>
              <p className="font-medium">{formatCurrency(quote.inputs.hourlyWage as number)}</p>
            </div>
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Markup %</p>
              <p className="font-medium">{formatPercent(quote.inputs.markupPercent as number)}</p>
            </div>
            <div className="bg-primary/10 p-2 rounded col-span-2">
              <p className="text-muted-foreground text-xs">Bill Rate</p>
              <p className="font-medium text-primary">{formatCurrency(quote.results.billRate as number)}</p>
            </div>
          </div>
        );
      case 'REVERSE_MARKUP':
        return (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Bill Rate</p>
              <p className="font-medium">{formatCurrency(quote.inputs.billRate as number)}</p>
            </div>
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Hourly Wage</p>
              <p className="font-medium">{formatCurrency(quote.inputs.hourlyWage as number)}</p>
            </div>
            <div className="bg-primary/10 p-2 rounded col-span-2">
              <p className="text-muted-foreground text-xs">Markup %</p>
              <p className="font-medium text-primary">{formatPercent(quote.results.markupPercent as number)}</p>
            </div>
          </div>
        );
      case 'SAVINGS':
        return (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Hourly Wage</p>
              <p className="font-medium">{formatCurrency(quote.inputs.hourlyWage as number)}</p>
            </div>
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Employees</p>
              <p className="font-medium">{quote.inputs.numEmployees}</p>
            </div>
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Client %</p>
              <p className="font-medium">{formatPercent(quote.inputs.clientPayrollPct as number)}</p>
            </div>
            <div className="bg-muted/50 p-2 rounded">
              <p className="text-muted-foreground text-xs">Agency %</p>
              <p className="font-medium">{formatPercent(quote.inputs.agencyPayrollPct as number)}</p>
            </div>
            <div className="bg-green-500/10 p-2 rounded col-span-2">
              <p className="text-muted-foreground text-xs">Yearly Savings</p>
              <p className="font-medium text-green-600">{formatCurrency(quote.results.totalYearlySaving as number)}</p>
            </div>
          </div>
        );
    }
  };

  return (
    <>
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5" />
            Saved Quotes
          </CardTitle>
          <CardDescription>
            {quotes.length} quote{quotes.length !== 1 ? 's' : ''} saved
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          {quotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-center px-4">
              <Calculator className="h-12 w-12 text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground text-sm">No quotes saved yet</p>
              <p className="text-muted-foreground/70 text-xs mt-1">
                Run a calculation and click "Create Quote" to save it
              </p>
            </div>
          ) : (
            <ScrollArea className="h-[calc(100vh-300px)] px-4 pb-4">
              <div className="space-y-3">
                {quotes.map((quote) => (
                  <Card key={quote.id} className="p-3 hover:bg-muted/30 transition-colors">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{quote.title}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant={getTypeBadgeVariant(quote.calculatorType)} className="text-xs">
                              {getTypeLabel(quote.calculatorType)}
                            </Badge>
                            {quote.clientName && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <User className="h-3 w-3" />
                                {quote.clientName}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {format(new Date(quote.createdAt), 'MMM d, yyyy h:mm a')}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewQuote(quote)}
                          className="h-7 px-2"
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopySummary(quote)}
                          className="h-7 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadCSV(quote)}
                          className="h-7 px-2"
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteId(quote.id)}
                          className="h-7 px-2 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Quote?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the quote.
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

      {/* View Quote Dialog */}
      <Dialog open={!!viewQuote} onOpenChange={() => setViewQuote(null)}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {viewQuote?.title}
            </DialogTitle>
            <DialogDescription>
              {viewQuote && format(new Date(viewQuote.createdAt), 'MMMM d, yyyy h:mm a')}
            </DialogDescription>
          </DialogHeader>

          {viewQuote && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={getTypeBadgeVariant(viewQuote.calculatorType)}>
                  {getTypeLabel(viewQuote.calculatorType)}
                </Badge>
                {viewQuote.clientName && (
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <User className="h-4 w-4" />
                    {viewQuote.clientName}
                  </span>
                )}
              </div>

              <div className="p-3 bg-muted rounded-lg">
                <p className="text-sm font-medium mb-1">Summary</p>
                <p className="text-sm text-muted-foreground">{viewQuote.summary}</p>
              </div>

              <div>
                <p className="text-sm font-medium mb-2">Details</p>
                {renderQuoteDetails(viewQuote)}
              </div>

              {viewQuote.notes && (
                <div>
                  <p className="text-sm font-medium mb-1">Notes</p>
                  <p className="text-sm text-muted-foreground">{viewQuote.notes}</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleCopySummary(viewQuote)}
                  className="flex-1"
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Summary
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleDownloadCSV(viewQuote)}
                  className="flex-1"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download CSV
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
