import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Calculator, RotateCcw, Lightbulb, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/quoteStore';

interface ReverseMarkupResult {
  markupPercent: number;
  ratio: number;
}

interface ReverseMarkupCalculatorProps {
  onCreateQuote: (inputs: Record<string, number>, results: Record<string, number>) => void;
}

export function ReverseMarkupCalculator({ onCreateQuote }: ReverseMarkupCalculatorProps) {
  const [billRate, setBillRate] = useState<string>('');
  const [hourlyWage, setHourlyWage] = useState<string>('');
  const [result, setResult] = useState<ReverseMarkupResult | null>(null);
  const [errors, setErrors] = useState<{ billRate?: string; hourlyWage?: string }>({});

  const validate = (): boolean => {
    const newErrors: typeof errors = {};
    const bill = parseFloat(billRate);
    const wage = parseFloat(hourlyWage);

    if (!billRate || isNaN(bill)) {
      newErrors.billRate = 'Bill rate is required';
    } else if (bill <= 0) {
      newErrors.billRate = 'Bill rate must be greater than 0';
    }

    if (!hourlyWage || isNaN(wage)) {
      newErrors.hourlyWage = 'Hourly wage is required';
    } else if (wage <= 0) {
      newErrors.hourlyWage = 'Hourly wage must be greater than 0';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const calculate = () => {
    if (!validate()) {
      setResult(null);
      return;
    }

    const bill = parseFloat(billRate);
    const wage = parseFloat(hourlyWage);
    const ratio = bill / wage;
    const markupPct = (ratio - 1) * 100;

    setResult({
      markupPercent: parseFloat(markupPct.toFixed(2)),
      ratio: parseFloat(ratio.toFixed(4)),
    });
  };

  // Auto-calculate on valid input change
  useEffect(() => {
    const timer = setTimeout(() => {
      if (billRate && hourlyWage) {
        calculate();
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [billRate, hourlyWage]);

  const reset = () => {
    setBillRate('');
    setHourlyWage('');
    setResult(null);
    setErrors({});
  };

  const fillExample = () => {
    setBillRate('30.50');
    setHourlyWage('25.00');
  };

  const handleCreateQuote = () => {
    if (!result) return;
    onCreateQuote(
      { billRate: parseFloat(billRate), hourlyWage: parseFloat(hourlyWage) },
      { markupPercent: result.markupPercent, ratio: result.ratio }
    );
  };

  const isNegativeMarkup = result && result.markupPercent < 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Reverse Markup Calculator
              </CardTitle>
              <CardDescription>Calculate markup percentage from bill rate and hourly wage</CardDescription>
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
              <Label htmlFor="billRate">Bill Rate ($)</Label>
              <Input
                id="billRate"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={billRate}
                onChange={(e) => setBillRate(e.target.value)}
                className={errors.billRate ? 'border-destructive' : ''}
              />
              {errors.billRate && (
                <p className="text-sm text-destructive">{errors.billRate}</p>
              )}
            </div>
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
        <Card className={`border-primary/50 ${isNegativeMarkup ? 'bg-destructive/5 border-destructive/50' : 'bg-primary/5'}`}>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              Results
              {isNegativeMarkup && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Negative Markup
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isNegativeMarkup && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Bill Rate is below Wage (negative markup). This means you would be losing money on this arrangement.
                </AlertDescription>
              </Alert>
            )}

            <div className="text-center p-4 bg-background rounded-lg border">
              <p className="text-sm text-muted-foreground mb-1">Markup Percentage</p>
              <p className={`text-3xl font-bold ${isNegativeMarkup ? 'text-destructive' : 'text-primary'}`}>
                {formatPercent(result.markupPercent)}
              </p>
            </div>

            <div className="space-y-2">
              <h4 className="font-medium text-sm text-muted-foreground">Breakdown</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Bill Rate</p>
                  <p className="font-semibold">{formatCurrency(parseFloat(billRate))}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Wage</p>
                  <p className="font-semibold">{formatCurrency(parseFloat(hourlyWage))}</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Ratio (B / W)</p>
                  <p className="font-semibold">{result.ratio}x</p>
                </div>
                <div className="bg-muted/50 p-3 rounded-lg">
                  <p className="text-muted-foreground">Markup %</p>
                  <p className={`font-semibold ${isNegativeMarkup ? 'text-destructive' : ''}`}>
                    {formatPercent(result.markupPercent)}
                  </p>
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
