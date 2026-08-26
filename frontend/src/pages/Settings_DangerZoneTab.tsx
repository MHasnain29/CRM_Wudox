/**
 * Settings → Danger Zone (temporary wipe tools).
 * Visible only to super_admin. HANDOVER: delete before client delivery.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { apiFetch } from '@/lib/api';
import { useAuthStore } from '@/lib/authStore';

type WipePreview = {
  keepEmail: string;
  keepUserFound: boolean;
  users: number;
  clients: number;
  leads: number;
  pendingImports: number;
  otherUsers: number;
  wipeTableCount: number;
};

type StatusResponse = {
  enabled: boolean;
  confirmPhrase: string;
  keepEmail: string;
  preview: WipePreview;
};

function isStatusResponse(value: unknown): value is StatusResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<StatusResponse>;
  return (
    v.enabled === true &&
    typeof v.confirmPhrase === 'string' &&
    typeof v.keepEmail === 'string' &&
    !!v.preview &&
    typeof v.preview === 'object' &&
    typeof v.preview.users === 'number'
  );
}

export function SettingsDangerZoneTab({ isActive }: { isActive: boolean }) {
  const { toast } = useToast();
  const user = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [phrase, setPhrase] = useState('');
  const [emailConfirm, setEmailConfirm] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(null);
    setStatus(null);
    try {
      const res = await apiFetch<StatusResponse>('/dangerous-admin/status');
      if (!res.ok) {
        if (res.status === 403) {
          setUnavailable(res.error || 'Only the designated keep user may open Danger Zone.');
        } else if (res.status === 0 || res.status >= 500) {
          setUnavailable('Backend is not reachable. Start/restart the backend.');
        } else {
          setUnavailable(res.error || 'Could not load Danger Zone status.');
        }
        return;
      }
      if (!isStatusResponse(res.data)) {
        setUnavailable('Danger Zone API did not return a valid status.');
        return;
      }
      setStatus(res.data);
    } catch {
      setUnavailable('Backend is not reachable. Start/restart the backend.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive) return;
    void load();
  }, [isActive, load]);

  const preview = status?.preview;
  const canSubmit =
    !!status &&
    !!preview &&
    phrase.trim() === status.confirmPhrase &&
    emailConfirm.trim().toLowerCase() === status.keepEmail.toLowerCase() &&
    !wiping;

  const runWipe = async () => {
    if (!status || !preview || !canSubmit) return;
    const ok = window.confirm(
      `This will permanently delete almost all CRM data and every user except ${status.keepEmail}. Continue?`,
    );
    if (!ok) return;

    setWiping(true);
    const res = await apiFetch<{
      deletedUsers: number;
      truncatedTables: number;
      clientsAfter: number;
      usersAfter: number;
    }>('/dangerous-admin/wipe-crm', {
      method: 'POST',
      body: JSON.stringify({
        confirmPhrase: phrase.trim(),
        confirmEmail: emailConfirm.trim(),
      }),
    });
    setWiping(false);

    if (!res.ok) {
      toast({
        title: 'Wipe failed',
        description: res.error || 'Server rejected the wipe.',
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: 'CRM wiped',
      description: `Kept ${status.keepEmail}. Deleted ${res.data.deletedUsers} user(s). Clients now: ${res.data.clientsAfter}.`,
    });
    setPhrase('');
    setEmailConfirm('');
    void load();
  };

  if (user?.role !== 'super_admin') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
          <CardDescription>Super admin only.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Temporary ops tools. Remove this tab before client handover. Wipe keeps only the designated
            user and system scaffolding (agencies, RBAC, settings).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          )}

          {unavailable && (
            <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/40">{unavailable}</p>
          )}

          {status && preview && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground">Users</div>
                  <div className="text-lg font-semibold">{preview.users}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground">Other users deleted</div>
                  <div className="text-lg font-semibold">{preview.otherUsers}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground">Clients</div>
                  <div className="text-lg font-semibold">{preview.clients}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-muted-foreground">Pending imports</div>
                  <div className="text-lg font-semibold">{preview.pendingImports}</div>
                </div>
              </div>

              <p className="text-sm">
                Keep user: <span className="font-medium">{status.keepEmail}</span>
                {!preview.keepUserFound && (
                  <span className="text-destructive"> — not found in DB (wipe blocked)</span>
                )}
              </p>

              <div className="space-y-2">
                <Label htmlFor="dz-phrase">
                  Type <code className="text-xs">{status.confirmPhrase}</code>
                </Label>
                <Input
                  id="dz-phrase"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dz-email">
                  Type keep email <code className="text-xs">{status.keepEmail}</code>
                </Label>
                <Input
                  id="dz-email"
                  value={emailConfirm}
                  onChange={(e) => setEmailConfirm(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <Button
                variant="destructive"
                disabled={!canSubmit || !preview.keepUserFound}
                onClick={() => void runWipe()}
              >
                {wiping ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Wipe CRM (keep {status.keepEmail})
              </Button>
            </>
          )}

          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh counts
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
