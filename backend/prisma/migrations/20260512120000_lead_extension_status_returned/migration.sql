-- Associate returned lead after deadline without extension request (audit trail in lead_extension_requests).
ALTER TYPE "LeadExtensionRequestStatus" ADD VALUE 'returned';
