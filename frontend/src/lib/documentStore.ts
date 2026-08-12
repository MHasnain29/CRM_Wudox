import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface DocumentField {
  name: string;
  placeholder: string; // e.g., "[Client Company Name]"
  value?: string;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  fileName: string;
  fileType: 'pdf' | 'docx' | 'txt' | 'other'; // Track file type
  content: string; // Raw text content with placeholders (for display/preview)
  pdfBytes?: string; // Base64 encoded original PDF bytes
  fields: DocumentField[];
  expiryDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  templateName: string;
  clientName: string;
  fieldValues: Record<string, string>;
  content: string; // Content with fields replaced
  pdfBytes?: string; // Base64 encoded generated PDF bytes
  generatedAt: string;
}

interface DocumentStore {
  templates: DocumentTemplate[];
  generatedDocuments: GeneratedDocument[];
  addTemplate: (template: DocumentTemplate) => void;
  updateTemplate: (id: string, updates: Partial<DocumentTemplate>) => void;
  deleteTemplate: (id: string) => void;
  getTemplate: (id: string) => DocumentTemplate | undefined;
  addGeneratedDocument: (doc: GeneratedDocument) => void;
  deleteGeneratedDocument: (id: string) => void;
}

export const useDocumentStore = create<DocumentStore>()(
  persist(
    (set, get) => ({
      templates: [],
      generatedDocuments: [],
      addTemplate: (template) =>
        set((state) => ({ templates: [template, ...state.templates] })),
      updateTemplate: (id, updates) =>
        set((state) => ({
          templates: state.templates.map((t) =>
            t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t
          ),
        })),
      deleteTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((t) => t.id !== id),
        })),
      getTemplate: (id) => get().templates.find((t) => t.id === id),
      addGeneratedDocument: (doc) =>
        set((state) => ({
          generatedDocuments: [doc, ...state.generatedDocuments],
        })),
      deleteGeneratedDocument: (id) =>
        set((state) => ({
          generatedDocuments: state.generatedDocuments.filter((d) => d.id !== id),
        })),
    }),
    {
      name: 'document-templates-storage',
    }
  )
);

// Generate unique ID
export const generateDocumentId = (): string => {
  return `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Extract fields from document content
// Matches patterns like [Field Name], [Client Company Name], [Date], etc.
export const extractFieldsFromContent = (content: string): DocumentField[] => {
  const fieldPattern = /\[([^[\]]+)\]/g;
  const matches = content.matchAll(fieldPattern);
  const fieldsMap = new Map<string, DocumentField>();

  for (const match of matches) {
    const placeholder = match[0]; // e.g., "[Client Company Name]"
    const name = match[1]; // e.g., "Client Company Name"
    
    // Use placeholder as key to avoid duplicates
    if (!fieldsMap.has(placeholder)) {
      fieldsMap.set(placeholder, {
        name,
        placeholder,
      });
    }
  }

  return Array.from(fieldsMap.values());
};

// Replace fields in content with actual values
export const replaceFieldsInContent = (
  content: string,
  fieldValues: Record<string, string>
): string => {
  let result = content;
  
  for (const [placeholder, value] of Object.entries(fieldValues)) {
    // Escape special regex characters in placeholder
    const escapedPlaceholder = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPlaceholder, 'g');
    result = result.replace(regex, value);
  }
  
  return result;
};

// Common field suggestions based on field name
export const getFieldSuggestions = (fieldName: string): string[] => {
  const lowerName = fieldName.toLowerCase();
  
  if (lowerName.includes('date')) {
    return [new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })];
  }
  
  if (lowerName.includes('agency name')) {
    return ['Your Agency Name'];
  }
  
  if (lowerName.includes('fee') || lowerName.includes('%')) {
    return ['10%', '15%', '20%', '25%'];
  }
  
  return [];
};
