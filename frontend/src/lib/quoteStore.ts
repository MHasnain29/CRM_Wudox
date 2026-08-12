import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type CalculatorType = 'MARKUP' | 'REVERSE_MARKUP' | 'SAVINGS';

export interface Quote {
  id: string;
  createdAt: string;
  calculatorType: CalculatorType;
  inputs: Record<string, number | string>;
  results: Record<string, number | string>;
  summary: string;
  title: string;
  clientName?: string;
  notes?: string;
}

interface QuoteStore {
  quotes: Quote[];
  addQuote: (quote: Quote) => void;
  deleteQuote: (id: string) => void;
  getQuote: (id: string) => Quote | undefined;
}

export const useQuoteStore = create<QuoteStore>()(
  persist(
    (set, get) => ({
      quotes: [],
      addQuote: (quote) => set((state) => ({ 
        quotes: [quote, ...state.quotes] 
      })),
      deleteQuote: (id) => set((state) => ({ 
        quotes: state.quotes.filter((q) => q.id !== id) 
      })),
      getQuote: (id) => get().quotes.find((q) => q.id === id),
    }),
    {
      name: 'calculator-quotes-storage',
    }
  )
);

// Helper to generate unique IDs
export const generateQuoteId = (): string => {
  return `quote-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Helper to format currency
export const formatCurrency = (value: number): string => {
  return `$${value.toFixed(2)}`;
};

// Helper to format percentage
export const formatPercent = (value: number): string => {
  return `${value.toFixed(2)}%`;
};

// Generate summary based on calculator type
export const generateSummary = (
  type: CalculatorType,
  inputs: Record<string, number>,
  results: Record<string, number>
): string => {
  switch (type) {
    case 'MARKUP':
      return `Hourly wage ${formatCurrency(inputs.hourlyWage)} with ${formatPercent(inputs.markupPercent)} markup gives bill rate ${formatCurrency(results.billRate)}.`;
    case 'REVERSE_MARKUP':
      return `Bill rate ${formatCurrency(inputs.billRate)} on wage ${formatCurrency(inputs.hourlyWage)} implies markup ${formatPercent(results.markupPercent)}.`;
    case 'SAVINGS':
      return `Client overhead ${formatPercent(inputs.clientPayrollPct)} vs agency ${formatPercent(inputs.agencyPayrollPct)} on ${formatCurrency(inputs.hourlyWage)}/hr saves ${formatCurrency(results.savingPerHour)}/hr. For ${inputs.numEmployees} employees at ${inputs.yearlyHours} hrs/yr saves ${formatCurrency(results.totalYearlySaving)}/yr.`;
    default:
      return '';
  }
};
