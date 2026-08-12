import {
  buildImportConflictResult,
  findInFileContactDuplicates,
  normalizeImportCompanyName,
  normalizeImportEmail,
  normalizeImportPhone,
} from './clientImportConflictCheck';

describe('clientImportConflictCheck', () => {
  describe('normalizers', () => {
    it('normalizes email to lowercase trimmed', () => {
      expect(normalizeImportEmail('  Foo@Bar.COM  ')).toBe('foo@bar.com');
    });

    it('normalizes phone by trimming', () => {
      expect(normalizeImportPhone('  555-0100  ')).toBe('555-0100');
    });

    it('normalizes company name case-insensitively', () => {
      expect(normalizeImportCompanyName('  Parmalat  ')).toBe('parmalat');
    });
  });

  describe('findInFileContactDuplicates', () => {
    it('detects duplicate emails within the file', () => {
      const result = findInFileContactDuplicates([
        {
          name: 'Acme',
          contacts: [{ name: 'A', email: 'a@acme.com' }],
        },
        {
          name: 'Beta',
          contacts: [{ name: 'B', email: 'a@acme.com' }],
        },
      ]);
      expect(result.inFileDuplicateEmails).toEqual(['a@acme.com']);
      expect(result.inFileDuplicatePhones).toEqual([]);
    });

    it('detects duplicate phones within the file', () => {
      const result = findInFileContactDuplicates([
        {
          name: 'Acme',
          contacts: [{ name: 'A', phone: '555-0100' }],
        },
        {
          name: 'Beta',
          contacts: [{ name: 'B', phone: '555-0100' }],
        },
      ]);
      expect(result.inFileDuplicatePhones).toEqual(['555-0100']);
      expect(result.inFileDuplicateEmails).toEqual([]);
    });

    it('returns no duplicates for a clean file', () => {
      const result = findInFileContactDuplicates([
        {
          name: 'Acme',
          contacts: [{ name: 'A', email: 'a@acme.com', phone: '555-0100' }],
        },
        {
          name: 'Beta',
          contacts: [{ name: 'B', email: 'b@beta.com', phone: '555-0200' }],
        },
      ]);
      expect(result.inFileDuplicateEmails).toEqual([]);
      expect(result.inFileDuplicatePhones).toEqual([]);
    });
  });

  describe('buildImportConflictResult', () => {
    it('marks mixed CRM and in-file conflicts', () => {
      const result = buildImportConflictResult(
        {
          duplicateEmails: [{ email: 'exists@crm.com', clientName: 'Existing', clientId: '1' }],
          duplicatePhones: [],
          duplicateCompanyNames: [{ name: 'Parmalat', clientName: 'Parmalat', clientId: '2' }],
        },
        {
          inFileDuplicateEmails: ['dup@file.com'],
          inFileDuplicatePhones: [],
        },
      );
      expect(result.hasConflicts).toBe(true);
      expect(result.duplicateEmails).toHaveLength(1);
      expect(result.duplicateCompanyNames).toHaveLength(1);
      expect(result.inFileDuplicateEmails).toEqual(['dup@file.com']);
    });

    it('passes when no conflicts exist', () => {
      const result = buildImportConflictResult(
        {
          duplicateEmails: [],
          duplicatePhones: [],
          duplicateCompanyNames: [],
        },
        {
          inFileDuplicateEmails: [],
          inFileDuplicatePhones: [],
        },
      );
      expect(result.hasConflicts).toBe(false);
    });
  });
});
