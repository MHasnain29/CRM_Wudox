import { useState } from 'react';
import { Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';

type SeedRow = { email: string; name: string; role: string; action: string };

type SeedResult = {
  agencyName: string;
  directorName: string;
  directorEmail: string;
  locationName: string;
  password: string;
  rows: SeedRow[];
};

export function DangerZoneSeedTeamCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<SeedResult | null>(null);

  const run = async () => {
    setRunning(true);
    const res = await apiFetch<SeedResult>('/dangerous-admin/seed-mississauga-team', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setRunning(false);

    if (!res.ok) {
      toast({
        title: 'Seed failed',
        description: res.error || 'Could not add the Mississauga team.',
        variant: 'destructive',
      });
      return;
    }

    setLast(res.data);
    const created = res.data.rows.filter((r) => r.action === 'created').length;
    toast({
      title: 'Mississauga team ready',
      description: `${created} created. Password: ${res.data.password}`,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlus className="h-5 w-5" />
          Seed Mississauga team
        </CardTitle>
        <CardDescription>
          Adds Company Director, Sales Manager, Marketing, Associate, and Executive under the org
          Director. Skips emails that already exist. No approval chain. Super admin only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Marketing login: <code className="text-xs">marketing@wudox.ca</code> /{' '}
          <code className="text-xs">Password@123</code>
        </p>
        <Button type="button" onClick={() => void run()} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <UserPlus className="h-4 w-4 mr-2" />
          )}
          {running ? 'Seeding…' : 'Add team now'}
        </Button>
        {last && (
          <div className="text-sm border rounded-md divide-y">
            <div className="px-3 py-2 text-muted-foreground">
              {last.agencyName} · reports to {last.directorName}
            </div>
            {last.rows.map((row) => (
              <div key={row.email} className="px-3 py-2 flex flex-col sm:flex-row sm:justify-between gap-1">
                <span>
                  {row.name}{' '}
                  <span className="text-muted-foreground">({row.role})</span>
                </span>
                <span className="text-muted-foreground text-xs">{row.action}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
