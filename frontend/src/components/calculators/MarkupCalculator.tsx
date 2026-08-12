import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Calculator, RotateCcw, Lightbulb } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/quoteStore';

interface MarkupResult {
  billRate: number;
  multiplier: number;
}

interface MarkupCalculatorProps {
  onCreateQuote: (inputs: Record<string, number>, results: Record<string, number>) => void;
}

export function MarkupCalculator({ onCreateQuote }: MarkupCalculatorProps) {
  const [hourlyWage, setHourlyWage] = useState<string>('');
  const [markupPercent, setMarkupPercent] = useState<string>('');
  const [result, setResult] = useState<MarkupResult | null>(null);
  const [errors, setErrors] = useState<{ hourlyWage?: string; markupPercent?: string }>({});

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    const wage = parseFloat(hourlyWage);
    const markup = parseFloat(markupPercent);

    if (!hourlyWage || isNaN(wage)) {
      newErrors.hourlyWage = 'Hourly wage is required';
    } else if (wage <= 0) {
      newErrors.hourlyWage = 'Hourly wage must be greater than 0';
    }

    if (!markupPercent && markupPercent !== '0') {
      newErrors.markupPercent = 'Markup percentage is required';
    } else if (isNaN(markup)) {
      newErrors.markupPercent = 'Invalid markup percentage';
    } else if (markup < 0) {
      newErrors.markupPercent = 'Markup percentage must be 0 or greater';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const calculate = () => {
    if (!validate()) {
      setResult(null);
      return;
    }

    const wage = parseFloat(hourlyWage);
    const markupPct = parseFloat(markupPercent) / 100;
    const multiplier = 1 + markupPct;
    const billRate = wage * multiplier;

    setResult({
      billRate: parseFloat(billRate.toFixed(2)),
      multiplier: parseFloat(multiplier.toFixed(4)),
    });
  };

  // Auto-calculate on valid input change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (hourlyWage && markupPercent) {
        calculate();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [hourlyWage, markupPercent]);

  const reset = () => {
    setHourlyWage('');
    setMarkupPercent('');
    setResult(null);
    setErrors({});
  };

  const fillExample = () => {
    setHourlyWage('18.00');
    setMarkupPercent('22.00');
  };

  const handleCreateQuote = () => {
    if (!result) return;
    onCreateQuote(
      { hourlyWage: parseFloat(hourlyWage), markupPercent: parseFloat(markupPercent) },
      { billRate: result.billRate, multiplier: result.multiplier }
    );
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Markup Calculator
              </CardTitle>
              <CardDescription>Calculate bill rate from hourly wage and markup percentage</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fillExample} className="text-muted-foreground">
              <Lightbulb className="h-4 w-4 mr-1" />
              Example
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="hourlyWage">Hourly Wage ($)</Label>
              <Input
                id="hourlyWage"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={hourlyWage}
                onChange={(e) => setHourlyWage(e.target.value)}
                className={errors.hourlyWage ? 'border-destructive' : ''}
              />
              {errors.hourlyWage && (
                <p className="text-sm text-destructive">{errors.hourlyWage}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="markupPercent">Markup Percentage (%)</Label>
              <Input
                id="markupPercent"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={markupPercent}
                onChange={(e) => setMarkupPercent(e.target.value)}
                className={errors.markupPercent ? 'border-destructive' : ''}
              />
              {errors.markupPercent && (
                <p className="text-sm text-destructive">{errors.markupPercent}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={calculate} className="flex-1">
              <Calculator className="h-4 w-4 mr-2" />
              Calculate
            </Button>
            <Button variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="border-primary/50 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center p-4 bg-background rounded-lg border">
              <p className="text-sm text-muted-foreground mb-1">Bill Rate</p>
              <p className="text-3xl font-bold text-primary">{formatCurrency(result.billRate)}</p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">Breakdown</h4>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Wage</p>
                  <p className="font-semibold">{formatCurrency(parseFloat(hourlyWage))}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Markup</p>
                  <p className="font-semibold">{formatPercent(parseFloat(markupPercent))}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Bill Rate</p>
                  <p className="font-semibold">{formatCurrency(result.billRate)}</p>
                </div>
              </div>
            </div>

            <Button onClick={handleCreateQuote} className="w-full" variant="secondary">
              Create Quote
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
