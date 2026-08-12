import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StickyHeader } from '@/components/StickyHeader';
import { MarkupCalculator } from '@/components/calculators/MarkupCalculator';
import { ReverseMarkupCalculator } from '@/components/calculators/ReverseMarkupCalculator';
import { SavingsCalculator } from '@/components/calculators/SavingsCalculator';
import { QuotesPanel } from '@/components/calculators/QuotesPanel';
import { CreateQuoteDialog } from '@/components/calculators/CreateQuoteDialog';
import { CalculatorType } from '@/lib/quoteStore';
import { Calculator, PercentCircle, PiggyBank } from 'lucide-react';

export default function Calculators() {
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [pendingQuote, setPendingQuote] = useState<{
    type: CalculatorType;
    inputs: Record<string, number>;
    results: Record<string, number>;
  } | null>(null);

  const handleCreateQuote = (
    type: CalculatorType,
    inputs: Record<string, number>,
    results: Record<string, number>
  ) => {
    setPendingQuote({ type, inputs, results });
    setQuoteDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="pt-6">
        <h1 className="text-2xl font-bold tracking-tight">Calculators</h1>
        <p className="text-muted-foreground">
          Calculate markup rates, reverse markup, and client savings
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr,380px]">
        {/* Main Calculator Area */}
        <div>
          <Tabs defaultValue="markup" className="space-y-4">
            <StickyHeader bleed={false}>
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="markup" className="flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  <span className="hidden sm:inline">Markup</span>
                </TabsTrigger>
                <TabsTrigger value="reverse" className="flex items-center gap-2">
                  <PercentCircle className="h-4 w-4" />
                  <span className="hidden sm:inline">Reverse Markup</span>
                </TabsTrigger>
                <TabsTrigger value="savings" className="flex items-center gap-2">
                  <PiggyBank className="h-4 w-4" />
                  <span className="hidden sm:inline">Savings</span>
                </TabsTrigger>
              </TabsList>
            </StickyHeader>

            <TabsContent value="markup">
              <MarkupCalculator
                onCreateQuote={(inputs, results) =>
                  handleCreateQuote('MARKUP', inputs, results)
                }
              />
            </TabsContent>

            <TabsContent value="reverse">
              <ReverseMarkupCalculator
                onCreateQuote={(inputs, results) =>
                  handleCreateQuote('REVERSE_MARKUP', inputs, results)
                }
              />
            </TabsContent>

            <TabsContent value="savings">
              <SavingsCalculator
                onCreateQuote={(inputs, results) =>
                  handleCreateQuote('SAVINGS', inputs, results)
                }
              />
            </TabsContent>
          </Tabs>
        </div>

        {/* Quotes Panel */}
        <div className="lg:sticky lg:top-6">
          <QuotesPanel />
        </div>
      </div>

      {/* Create Quote Dialog */}
      {pendingQuote && (
        <CreateQuoteDialog
          open={quoteDialogOpen}
          onOpenChange={setQuoteDialogOpen}
          calculatorType={pendingQuote.type}
          inputs={pendingQuote.inputs}
          results={pendingQuote.results}
        />
      )}
    </div>
  );
}
