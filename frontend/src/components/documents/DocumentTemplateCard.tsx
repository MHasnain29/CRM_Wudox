import { DocumentTemplate } from '@/lib/documentStore';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FileText, Sparkles, Trash2, Clock, AlertTriangle } from 'lucide-react';
import { format, isPast, differenceInDays } from 'date-fns';

interface DocumentTemplateCardProps {
  template: DocumentTemplate;
  onGenerate: (template: DocumentTemplate) => void;
  onDelete: (id: string) => void;
}

export function DocumentTemplateCard({
  template,
  onGenerate,
  onDelete,
}: DocumentTemplateCardProps) {
  const isExpired = template.expiryDate && isPast(new Date(template.expiryDate));
  const daysUntilExpiry = template.expiryDate
    ? differenceInDays(new Date(template.expiryDate), new Date())
    : null;
  const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry > 0;

  return (
    <Card className={isExpired ? 'opacity-60 border-destructive/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <FileText className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{template.name}</CardTitle>
              <CardDescription className="text-xs mt-1">
                {template.fileName}
              </CardDescription>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(template.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Fields */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">
            {template.fields.length} field(s)
          </p>
          <div className="flex flex-wrap gap-1">
            {template.fields.slice(0, 4).map((field, index) => (
              <Badge key={index} variant="outline" className="text-xs">
                {field.name}
              </Badge>
            ))}
            {template.fields.length > 4 && (
              <Badge variant="outline" className="text-xs">
                +{template.fields.length - 4} more
              </Badge>
            )}
          </div>
        </div>

        {/* Expiry Status */}
        {template.expiryDate && (
          <div
            className={`flex items-center gap-2 text-xs ${
              isExpired
                ? 'text-destructive'
                : isExpiringSoon
                ? 'text-yellow-600'
                : 'text-muted-foreground'
            }`}
          >
            {isExpired ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {isExpired
              ? `Expired on ${format(new Date(template.expiryDate), 'MMM d, yyyy')}`
              : `Expires ${format(new Date(template.expiryDate), 'MMM d, yyyy')}`}
          </div>
        )}

        {/* Created date */}
        <p className="text-xs text-muted-foreground">
          Created {format(new Date(template.createdAt), 'MMM d, yyyy')}
        </p>

        {/* Generate button */}
        <Button
          className="w-full"
          size="sm"
          onClick={() => onGenerate(template)}
          disabled={isExpired}
        >
          <Sparkles className="h-4 w-4 mr-2" />
          Generate for Client
        </Button>
      </CardContent>
    </Card>
  );
}
