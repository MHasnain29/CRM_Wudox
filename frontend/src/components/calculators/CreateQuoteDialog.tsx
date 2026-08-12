import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useQuoteStore, generateQuoteId, generateSummary, CalculatorType } from '@/lib/quoteStore';
import { toast } from '@/hooks/use-toast';
import { FileText } from 'lucide-react';

interface CreateQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calculatorType: CalculatorType;
  inputs: Record<string, number>;
  results: Record<string, number>;
}

export function CreateQuoteDialog({
  open,
  onOpenChange,
  calculatorType,
  inputs,
  results,
}: CreateQuoteDialogProps) {
  const { addQuote } = useQuoteStore();
  
  const getDefaultTitle = () => {
    const typeLabels: Record<CalculatorType, string> = {
      MARKUP: 'Markup Calculation',
      REVERSE_MARKUP: 'Reverse Markup Calculation',
      SAVINGS: 'Savings Analysis',
    };
    const now = new Date();
    return `${typeLabels[calculatorType]} - ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  const [title, setTitle] = useState(getDefaultTitle());
  const [clientName, setClientName] = useState('');
  const [notes, setNotes] = useState('');

  const handleSave = () => {
    const summary = generateSummary(calculatorType, inputs, results);
    
    addQuote({
      id: generateQuoteId(),
      createdAt: new Date().toISOString(),
      calculatorType,
      inputs,
      results,
      summary,
      title,
      clientName: clientName || undefined,
      notes: notes || undefined,
    });

    toast({
      title: 'Quote Created',
      description: 'Your quote has been saved successfully.',
    });

    // Reset form
    setTitle(getDefaultTitle());
    setClientName('');
    setNotes('');
    onOpenChange(false);
  };

  // Reset title when dialog opens with new data
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setTitle(getDefaultTitle());
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Create Quote
          </DialogTitle>
          <DialogDescription>
            Save this calculation as a quote for future reference.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Quote Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter quote title..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="clientName">Client Name (Optional)</Label>
            <Input
              id="clientName"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Enter client name..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional notes..."
              rows={3}
            />
          </div>

          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground font-medium mb-1">Preview Summary</p>
            <p className="text-sm">{generateSummary(calculatorType, inputs, results)}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            Save Quote
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
