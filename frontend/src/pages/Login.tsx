import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/lib/authStore';
import { useStore } from '@/lib/store';
import { fetchSubCompanies, fetchPublicBranding, type PublicCompanyBranding } from '@/lib/api';

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const { setCurrentUser, setCurrentSubCompany, setSubCompanies } = useStore();

  const [branding, setBranding] = useState<PublicCompanyBranding | null>(null);
  const [brandingLoaded, setBrandingLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBrandingLoaded(false);
    fetchPublicBranding()
      .then((b) => {
        if (!cancelled) setBranding(b);
      })
      .catch(() => {
        if (!cancelled) setBranding(null);
      })
      .finally(() => {
        if (!cancelled) setBrandingLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showLogo = Boolean(branding?.logoUrl);
  const showTitle = Boolean(branding?.projectName?.trim());

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(email, password);
      const user = useAuthStore.getState().user;
      if (user) {
        setCurrentUser(user);
        const list = await fetchSubCompanies().catch(() => []);
        setSubCompanies(
          list.map((s) => ({
            id: s.id,
            name: s.name,
            mainOrgId: s.mainOrgId,
            appProjectName: s.appProjectName ?? null,
            logoUrl: s.logoUrl ?? null,
            agencyLogoUrl: s.agencyLogoUrl ?? null,
            agencyEmail: s.agencyEmail ?? null,
            agencyPhone: s.agencyPhone ?? null,
            emailFooterText: s.emailFooterText ?? null,
            emailTagline: s.emailTagline ?? null,
            emailSendAsDomain: s.emailSendAsDomain ?? null,
          })),
        );
        if (data.user.subCompany) {
          const sc = data.user.subCompany;
          setCurrentSubCompany({
            id: sc.id,
            name: sc.name,
            mainOrgId: sc.mainOrgId,
            appProjectName: sc.appProjectName ?? null,
            logoUrl: sc.logoUrl ?? null,
            agencyLogoUrl: sc.agencyLogoUrl ?? null,
            agencyEmail: sc.agencyEmail ?? null,
            agencyPhone: sc.agencyPhone ?? null,
            emailFooterText: sc.emailFooterText ?? null,
            emailTagline: sc.emailTagline ?? null,
            emailSendAsDomain: sc.emailSendAsDomain ?? null,
          });
        } else {
          const sub = list.find((s) => s.id === user.subCompanyId);
          if (sub)
            setCurrentSubCompany({
              id: sub.id,
              name: sub.name,
              mainOrgId: sub.mainOrgId,
              appProjectName: sub.appProjectName ?? null,
              logoUrl: sub.logoUrl ?? null,
              agencyLogoUrl: sub.agencyLogoUrl ?? null,
              agencyEmail: sub.agencyEmail ?? null,
              agencyPhone: sub.agencyPhone ?? null,
              emailFooterText: sub.emailFooterText ?? null,
              emailTagline: sub.emailTagline ?? null,
              emailSendAsDomain: sub.emailSendAsDomain ?? null,
            });
          else if (list.length > 0)
            setCurrentSubCompany({
              id: list[0].id,
              name: list[0].name,
              mainOrgId: list[0].mainOrgId,
              appProjectName: list[0].appProjectName ?? null,
              logoUrl: list[0].logoUrl ?? null,
              agencyLogoUrl: list[0].agencyLogoUrl ?? null,
              agencyEmail: list[0].agencyEmail ?? null,
              agencyPhone: list[0].agencyPhone ?? null,
              emailFooterText: list[0].emailFooterText ?? null,
              emailTagline: list[0].emailTagline ?? null,
              emailSendAsDomain: list[0].emailSendAsDomain ?? null,
            });
        }
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center sm:text-left">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 min-h-[2.5rem]">
            {showLogo && branding?.logoUrl ? (
              <img
                src={branding.logoUrl}
                alt=""
                className="h-12 w-auto max-w-[200px] object-contain mx-auto sm:mx-0"
              />
            ) : null}
            <div className="flex-1 min-w-0">
              {brandingLoaded && showTitle && branding?.projectName ? (
                <CardTitle className="text-xl sm:text-2xl leading-tight">{branding.projectName}</CardTitle>
              ) : brandingLoaded ? (
                <div className="text-xl sm:text-2xl font-semibold text-transparent select-none" aria-hidden>
                  &nbsp;
                </div>
              ) : (
                <div className="h-8 rounded-md bg-muted/50 animate-pulse" aria-hidden />
              )}
              <CardDescription className="mt-1.5">Sign in with your email and password.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  state={{ email }}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
