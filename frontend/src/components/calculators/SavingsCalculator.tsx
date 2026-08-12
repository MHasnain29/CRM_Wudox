import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Calculator, Plus, Trash2, Copy, TrendingUp, TrendingDown, Settings } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/quoteStore';

interface ProspectData {
  id: string;
  name: string;
  hourlyWage: string;
  agencyHourlyWage: string;
  clientPayrollPct: string;
  agencyPayrollPct: string;
  numEmployees: string;
  yearlyHours: string;
}

interface SavingsResult {
  totalCostClient: number;
  totalCostAgency: number;
  savingPerHour: number;
  totalYearlySaving: number;
}

interface SavingsCalculatorProps {
  onCreateQuote: (inputs: Record<string, number>, results: Record<string, number>) => void;
}

interface DefaultValues {
  hourlyWage: string;
  agencyHourlyWage: string;
  clientPayrollPct: string;
  agencyPayrollPct: string;
  numEmployees: string;
  yearlyHours: string;
}

const defaultDefaults: DefaultValues = {
  hourlyWage: '17.60',
  agencyHourlyWage: '17.60',
  clientPayrollPct: '18',
  agencyPayrollPct: '15',
  numEmployees: '10',
  yearlyHours: '2080',
};

const createDefaultProspect = (defaults: DefaultValues): ProspectData => ({
  id: `prospect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
  name: 'New Prospect',
  hourlyWage: defaults.hourlyWage,
  agencyHourlyWage: defaults.agencyHourlyWage,
  clientPayrollPct: defaults.clientPayrollPct,
  agencyPayrollPct: defaults.agencyPayrollPct,
  numEmployees: defaults.numEmployees,
  yearlyHours: defaults.yearlyHours,
});

const calculateResults = (prospect: ProspectData): SavingsResult | null => {
  const clientWage = parseFloat(prospect.hourlyWage);
  const agencyWage = parseFloat(prospect.agencyHourlyWage);
  const clientPct = parseFloat(prospect.clientPayrollPct) / 100;
  const agencyPct = parseFloat(prospect.agencyPayrollPct) / 100;
  const employees = parseInt(prospect.numEmployees);
  const hours = parseFloat(prospect.yearlyHours);

  if (isNaN(clientWage) || isNaN(agencyWage) || isNaN(clientPct) || isNaN(agencyPct) || isNaN(employees) || isNaN(hours)) {
    return null;
  }

  if (clientWage <= 0 || agencyWage <= 0 || employees < 1 || hours <= 0) {
    return null;
  }

  const totalCostClient = clientWage * (1 + clientPct);
  const totalCostAgency = agencyWage * (1 + agencyPct);
  const savingPerHour = totalCostClient - totalCostAgency;
  const totalYearlySaving = savingPerHour * employees * hours;

  return {
    totalCostClient: parseFloat(totalCostClient.toFixed(2)),
    totalCostAgency: parseFloat(totalCostAgency.toFixed(2)),
    savingPerHour: parseFloat(savingPerHour.toFixed(2)),
    totalYearlySaving: parseFloat(totalYearlySaving.toFixed(2)),
  };
};

interface ProspectTableProps {
  prospect: ProspectData;
  onUpdate: (id: string, field: keyof ProspectData, value: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (prospect: ProspectData) => void;
  onCreateQuote: (inputs: Record<string, number>, results: Record<string, number>) => void;
  canDelete: boolean;
}

function ProspectTable({ prospect, onUpdate, onDelete, onDuplicate, onCreateQuote, canDelete }: ProspectTableProps) {
  const result = calculateResults(prospect);
  const isNegativeSaving = result && result.savingPerHour < 0;
  const yearlyHoursTotal = parseInt(prospect.numEmployees) * parseFloat(prospect.yearlyHours) || 0;

  const handleCreateQuote = () => {
    if (!result) return;
    onCreateQuote(
      {
        hourlyWage: parseFloat(prospect.hourlyWage),
        clientPayrollPct: parseFloat(prospect.clientPayrollPct),
        agencyPayrollPct: parseFloat(prospect.agencyPayrollPct),
        numEmployees: parseInt(prospect.numEmployees),
        yearlyHours: parseFloat(prospect.yearlyHours),
      },
      {
        totalCostClient: result.totalCostClient,
        totalCostAgency: result.totalCostAgency,
        savingPerHour: result.savingPerHour,
        totalYearlySaving: result.totalYearlySaving,
      }
    );
  };

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <Input
            value={prospect.name}
            onChange={(e) => onUpdate(prospect.id, 'name', e.target.value)}
            className="text-lg font-semibold border-0 p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent"
            placeholder="Prospect Name"
          />
          <div className="flex items-center gap-2">
            {result && (
              isNegativeSaving ? (
                <Badge variant="destructive" className="gap-1">
                  <TrendingDown className="h-3 w-3" />
                  Loss
                </Badge>
              ) : (
                <Badge variant="default" className="gap-1 bg-green-600">
                  <TrendingUp className="h-3 w-3" />
                  Saving
                </Badge>
              )
            )}
            <Button variant="ghost" size="icon" onClick={() => onDuplicate(prospect)} title="Duplicate">
              <Copy className="h-4 w-4" />
            </Button>
            {canDelete && (
              <Button variant="ghost" size="icon" onClick={() => onDelete(prospect.id)} className="text-destructive" title="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Combined Table */}
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-[200px]">Metric</TableHead>
                <TableHead className="text-center">Value (Client)</TableHead>
                <TableHead className="text-center">Value (Agency)</TableHead>
                <TableHead className="text-center">Saving</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell className="font-medium">Per Hour</TableCell>
                <TableCell className="text-center p-1">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prospect.hourlyWage}
                    onChange={(e) => onUpdate(prospect.id, 'hourlyWage', e.target.value)}
                    className="text-center h-8 w-24 mx-auto"
                    placeholder="0.00"
                  />
                </TableCell>
                <TableCell className="text-center p-1">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={prospect.agencyHourlyWage}
                    onChange={(e) => onUpdate(prospect.id, 'agencyHourlyWage', e.target.value)}
                    className="text-center h-8 w-24 mx-auto"
                    placeholder="0.00"
                  />
                </TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Payroll Cost</TableCell>
                <TableCell className="text-center p-1">
                  <div className="flex items-center justify-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prospect.clientPayrollPct}
                      onChange={(e) => onUpdate(prospect.id, 'clientPayrollPct', e.target.value)}
                      className="text-center h-8 w-20"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </TableCell>
                <TableCell className="text-center p-1">
                  <div className="flex items-center justify-center gap-1">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={prospect.agencyPayrollPct}
                      onChange={(e) => onUpdate(prospect.id, 'agencyPayrollPct', e.target.value)}
                      className="text-center h-8 w-20"
                      placeholder="0"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
              </TableRow>
              <TableRow className="bg-muted/30">
                <TableCell className="font-semibold">Total Cost per Hour</TableCell>
                <TableCell className="text-center font-semibold">
                  {result ? formatCurrency(result.totalCostClient) : '—'}
                </TableCell>
                <TableCell className="text-center font-semibold">
                  {result ? formatCurrency(result.totalCostAgency) : '—'}
                </TableCell>
                <TableCell className={`text-center font-bold ${isNegativeSaving ? 'text-destructive' : 'text-green-600'}`}>
                  {result ? formatCurrency(result.savingPerHour) : '—'}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Number of Employees</TableCell>
                <TableCell className="text-center p-1">
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={prospect.numEmployees}
                    onChange={(e) => onUpdate(prospect.id, 'numEmployees', e.target.value)}
                    className="text-center h-8 w-24 mx-auto"
                    placeholder="1"
                  />
                </TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium">Yearly Hours</TableCell>
                <TableCell className="text-center p-1">
                  <Input
                    type="number"
                    step="1"
                    min="1"
                    value={prospect.yearlyHours}
                    onChange={(e) => onUpdate(prospect.id, 'yearlyHours', e.target.value)}
                    className="text-center h-8 w-24 mx-auto"
                    placeholder="2080"
                  />
                </TableCell>
                <TableCell className="text-center text-muted-foreground">
                  <span className="text-xs">Total: {yearlyHoursTotal.toLocaleString()} hrs</span>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
              </TableRow>
              <TableRow className="bg-primary/5">
                <TableCell className="font-bold text-primary">Yearly Saving</TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
                <TableCell className="text-center text-muted-foreground">—</TableCell>
                <TableCell className={`text-center font-bold text-lg ${isNegativeSaving ? 'text-destructive' : 'text-green-600'}`}>
                  {result ? formatCurrency(result.totalYearlySaving) : '—'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {result && (
          <Button onClick={handleCreateQuote} className="w-full" variant="secondary" size="sm">
            Create Quote
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function SavingsCalculator({ onCreateQuote }: SavingsCalculatorProps) {
  const [defaults, setDefaults] = useState<DefaultValues>(defaultDefaults);
  const [tempDefaults, setTempDefaults] = useState<DefaultValues>(defaultDefaults);
  const [isDefaultsOpen, setIsDefaultsOpen] = useState(false);
  const [prospects, setProspects] = useState<ProspectData[]>([createDefaultProspect(defaults)]);

  const handleOpenDefaults = useCallback(() => {
    setTempDefaults(defaults);
    setIsDefaultsOpen(true);
  }, [defaults]);

  const handleSaveDefaults = useCallback(() => {
    setDefaults(tempDefaults);
    setIsDefaultsOpen(false);
  }, [tempDefaults]);

  const handleCancelDefaults = useCallback(() => {
    setTempDefaults(defaults);
    setIsDefaultsOpen(false);
  }, [defaults]);

  const handleUpdateTempDefaults = useCallback((field: keyof DefaultValues, value: string) => {
    setTempDefaults(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleUpdateProspect = useCallback((id: string, field: keyof ProspectData, value: string) => {
    setProspects(prev => prev.map(p => 
      p.id === id ? { ...p, [field]: value } : p
    ));
  }, []);

  const handleAddProspect = useCallback(() => {
    setProspects(prev => [...prev, createDefaultProspect(defaults)]);
  }, [defaults]);

  const handleDeleteProspect = useCallback((id: string) => {
    setProspects(prev => prev.filter(p => p.id !== id));
  }, []);

  const handleDuplicateProspect = useCallback((prospect: ProspectData) => {
    const newProspect: ProspectData = {
      ...prospect,
      id: `prospect-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: `${prospect.name} (Copy)`,
    };
    setProspects(prev => [...prev, newProspect]);
  }, []);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Savings Calculator
              </CardTitle>
              <CardDescription>Compare client vs agency payroll overhead costs for multiple prospects</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Dialog open={isDefaultsOpen} onOpenChange={setIsDefaultsOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" onClick={handleOpenDefaults}>
                    <Settings className="h-4 w-4 mr-1" />
                    Edit Defaults
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle>Default Values</DialogTitle>
                    <DialogDescription>
                      Set default values that will be used when creating new prospects.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="clientHourly">Client Hourly Rate</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">$</span>
                          <Input
                            id="clientHourly"
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempDefaults.hourlyWage}
                            onChange={(e) => handleUpdateTempDefaults('hourlyWage', e.target.value)}
                            placeholder="17.60"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="agencyHourly">Agency Hourly Rate</Label>
                        <div className="flex items-center gap-1">
                          <span className="text-sm text-muted-foreground">$</span>
                          <Input
                            id="agencyHourly"
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempDefaults.agencyHourlyWage}
                            onChange={(e) => handleUpdateTempDefaults('agencyHourlyWage', e.target.value)}
                            placeholder="17.60"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="clientPayroll">Client Payroll %</Label>
                        <div className="flex items-center gap-1">
                          <Input
                            id="clientPayroll"
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempDefaults.clientPayrollPct}
                            onChange={(e) => handleUpdateTempDefaults('clientPayrollPct', e.target.value)}
                            placeholder="18"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="agencyPayroll">Agency Payroll %</Label>
                        <div className="flex items-center gap-1">
                          <Input
                            id="agencyPayroll"
                            type="number"
                            step="0.01"
                            min="0"
                            value={tempDefaults.agencyPayrollPct}
                            onChange={(e) => handleUpdateTempDefaults('agencyPayrollPct', e.target.value)}
                            placeholder="15"
                          />
                          <span className="text-sm text-muted-foreground">%</span>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="employees">Number of Employees</Label>
                        <Input
                          id="employees"
                          type="number"
                          step="1"
                          min="1"
                          value={tempDefaults.numEmployees}
                          onChange={(e) => handleUpdateTempDefaults('numEmployees', e.target.value)}
                          placeholder="10"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="yearlyHours">Yearly Hours</Label>
                        <Input
                          id="yearlyHours"
                          type="number"
                          step="1"
                          min="1"
                          value={tempDefaults.yearlyHours}
                          onChange={(e) => handleUpdateTempDefaults('yearlyHours', e.target.value)}
                          placeholder="2080"
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={handleCancelDefaults}>
                      Cancel
                    </Button>
                    <Button onClick={handleSaveDefaults}>
                      Save Defaults
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Button onClick={handleAddProspect} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Prospect
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6">
        {prospects.map((prospect) => (
          <ProspectTable
            key={prospect.id}
            prospect={prospect}
            onUpdate={handleUpdateProspect}
            onDelete={handleDeleteProspect}
            onDuplicate={handleDuplicateProspect}
            onCreateQuote={onCreateQuote}
            canDelete={prospects.length > 1}
          />
        ))}
      </div>
    </div>
  );
}
