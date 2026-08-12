/**
 * Shown on new (unsaved) employee forms — agreement/training send is confirmed before save.
 */
import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function AgreementSaveHintCard({ email }: { email?: string }) {
  const recipient = email?.trim();
  return (
    <Card className="shadow-sm border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Onboarding Agreement
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        <p className="text-xs text-muted-foreground">
          Saving the application asks you to confirm the recipient email and training links
          {recipient ? (
            <>
              {' '}
              (defaults to <span className="font-medium text-foreground">{recipient}</span>)
            </>
          ) : (
            ' (add an email first)'
          )}
          , then sends the PandaDoc agreement and default training links and moves the employee to
          Pending. Agreement and trainings show as Incomplete until finished — then a Recruitment
          Manager can approve to Master.
        </p>
      </CardContent>
    </Card>
  );
}
