import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Lead, Client } from '@/lib/types';
import { FileText, File, Download, MapPin, Building2, Calendar, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';
import { downloadProposalAttachment, fetchProposalAttachmentBlob } from '@/lib/api';

interface ProposalDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: Lead | null;
  client: Client | null;
  clients: Client[];
}

export function ProposalDetailsDialog({
  open,
  onOpenChange,
  lead,
  client,
  clients,
}: ProposalDetailsDialogProps) {
  if (!lead || !client || !lead.proposalData) return null;

  const { proposalData } = lead;

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText className="h-4 w-4 text-red-500" />;
    return <File className="h-4 w-4 text-muted-foreground" />;
  };

  const selectedClientDetails = proposalData.selectedClients
    .map(id => clients.find(c => c.id === id))
    .filter(Boolean) as Client[];

  // Get agreement types - support both new and legacy format
  const agreementTypes = proposalData.agreementTypes || (proposalData.agreementType ? [proposalData.agreementType] : []);

  const getAgreementTypeLabel = (type: string) => {
    switch (type) {
      case 'temp':
        return 'Temporary / Temporary to Permanent Staffing Agreement';
      case 'direct_placement':
        return 'Direct Placement Agreement';
      default:
        return type;
    }
  };

  const formatPricing = (pricingType: string, pricingValue: number) => {
    return pricingType === 'markup' 
      ? `${pricingValue}% Markup` 
      : `$${pricingValue}/hr Bill Rate`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Proposal Details - {client.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Agreement Types */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Agreement Type(s)</h4>
            <div className="flex flex-wrap gap-2">
              {agreementTypes.map((type) => (
                <Badge key={type} variant="secondary">
                  {getAgreementTypeLabel(type)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Temp Pricing Section */}
          {(agreementTypes.includes('temp') && proposalData.tempPricing) && (
            <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
              <h4 className="font-medium">Temporary / Temporary to Permanent Pricing</h4>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {proposalData.tempPricing.pricingType === 'markup' ? 'Markup' : 'Bill Rate'}
                  </Badge>
                  <span className="font-medium">
                    {formatPricing(proposalData.tempPricing.pricingType, proposalData.tempPricing.pricingValue)}
                  </span>
                </div>
                {proposalData.tempPricing.minimumHours && (
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span>Minimum Hours: {proposalData.tempPricing.minimumHours}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Direct Placement Pricing Section */}
          {(agreementTypes.includes('direct_placement') && proposalData.directPricing) && (
            <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
              <h4 className="font-medium">Direct Placement Pricing</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {proposalData.directPricing.pricingType === 'markup' ? 'Markup' : 'Bill Rate'}
                </Badge>
                <span className="font-medium">
                  {formatPricing(proposalData.directPricing.pricingType, proposalData.directPricing.pricingValue)}
                </span>
              </div>
            </div>
          )}

          {/* Legacy Pricing Display - for backwards compatibility */}
          {!proposalData.tempPricing && !proposalData.directPricing && proposalData.pricingValue !== undefined && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">Pricing</h4>
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  {proposalData.pricingType === 'markup' ? 'Markup' : 'Bill Rate'}
                </Badge>
                <span className="font-medium">
                  {proposalData.pricingType === 'markup' 
                    ? `${proposalData.pricingValue}%` 
                    : `$${proposalData.pricingValue}/hr`}
                </span>
              </div>
            </div>
          )}

          {/* Payment Terms */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Payment Terms</h4>
            <Badge variant="secondary">
              {proposalData.paymentTerms.replace('net_', 'Net ')}
            </Badge>
          </div>

          {/* Location Type */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Location Type</h4>
            <Badge variant="secondary" className="capitalize">
              {proposalData.locationType === 'single' ? 'Single Location' : 'Multiple Locations'}
            </Badge>
          </div>

          {/* Primary Location */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Primary Location</h4>
            <div className="p-3 rounded-lg border bg-muted/30">
              <div className="font-medium">{client.name}</div>
              <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <MapPin className="h-3 w-3" />
                {client.address}
              </div>
              <div className="text-sm text-muted-foreground">{client.location}</div>
            </div>
          </div>

          {/* Additional Locations */}
          {proposalData.locationType === 'multiple' && selectedClientDetails.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                Additional Locations ({selectedClientDetails.length})
              </h4>
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-2">
                  {selectedClientDetails.map((c) => (
                    <div key={c.id} className="p-3 rounded-lg border">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {c.address}
                      </div>
                      <div className="text-sm text-muted-foreground">{c.location}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <Separator />

          {/* Attachments */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              Attachments ({proposalData.attachments.length})
            </h4>
            {proposalData.attachments.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No attachments</p>
            ) : (
              <CrmAttachmentList
                items={proposalData.attachments.map((attachment) => ({
                  id: attachment.id,
                  name: attachment.name,
                  mimeType: attachment.type,
                  size: attachment.size,
                }))}
                fetchBlob={(item) => fetchProposalAttachmentBlob(item.id)}
                onDownload={(item) => downloadProposalAttachment(item.id, item.name)}
              />
            )}
          </div>

          <Separator />

          {/* Comment */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Comments</h4>
            {proposalData.comment ? (
              <p className="text-sm whitespace-pre-wrap p-3 rounded-lg border bg-muted/30">
                {proposalData.comment}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">No comments</p>
            )}
          </div>

          {/* Created Date */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            Proposal sent on {format(new Date(proposalData.createdAt), 'MMM d, yyyy h:mm a')}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}