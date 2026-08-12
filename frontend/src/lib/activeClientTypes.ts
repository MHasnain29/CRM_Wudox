export type ActiveClientStatus = 'active' | 'inactive';

export interface ActiveClient {
  id: string;
  name: string;
  industry: string;
  location: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  status: ActiveClientStatus;
  agencyId: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ActiveClientInput = Omit<ActiveClient, 'id' | 'createdAt' | 'updatedAt'>;
