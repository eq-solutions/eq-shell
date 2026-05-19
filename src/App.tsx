import { useCallback, useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import { SessionContext, useSession, type ShellSession, moduleEnabled } from './session';
import { BrandProvider } from './brand';
import { identifyUser, resetUser } from './observability';
import LoginPage from './pages/LoginPage';
import TenantHome from './pages/TenantHome';
import FieldIframe from './pages/FieldIframe';
import './App.css';

// Q5 lock: each module is its own lazy chunk so disabled tenants
// never pay the bandwidth cost.
const CardsModule = lazy(() => import('./modules/cards'));
const IntakeModule = lazy(() => import('./modules/intake'));
const QuotesModule = lazy(() => import('./modules/quotes'));
const ServiceModule = lazy(() => import('./modules/service'));
const TenderPipelineModule = lazy(() => import('./modules/tender-pipeline'));

// SessionProvider — hydrates session via verify-shell-session on mount,
// re-exposes the result to the rest of the tree.
function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ShellSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/.netlify/functions/verify-shell-session', {
        credentials: 'include',
      });
      if (res.ok) {
        const body = (await res.json()) as ShellSession & { valid: true };
        const { user, tenant, entitlements, supabase_jwt } = body;
        setSession({ user, tenant, entitlements, supabase_jwt });
        identifyUser(user.id, {
          tenant: tenant.slug,
          role: user.role,
          email: user.email,
        });
      } else {
        setSession(null);
        resetUser();
      }
    } catch {
      setSession(null);
      resetUser();
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    // Cookie is HttpOnly so the browser can't clear it via JS — the
    // server would need to send Set-Cookie: ...; Max-Age=0. Phase
    // 1.B compromise: drop local session state + navigate to root.
    // Follow-up: add /.netlify/functions/shell-logout that clears
    // the cookie server-side.
    setSession(null);
    resetUser();
    window.location.assign('/');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SessionContext.Provider value={{ session, loading, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

// RequireSession — guards a subtree behind a valid session AND a
// tenant-slug match. If the cookie is for a different tenant, force
// re-login (prevents URL-guessing into another tenant's shell).
function RequireSession({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const location = useLocation();

  if (loading) return <div className="eq-loading">Loading…</div>;
  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  if (tenantSlug && session.tenant.slug !== tenantSlug) {
    return <Navigate to={`/${session.tenant.slug}`} replace />;
  }
  return <>{children}</>;
}

function ModuleGate({ module, children }: { module: string; children: ReactNode }) {
  const { session } = useSession();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  if (!session) return null;
  if (!moduleEnabled(session, module)) {
    return <Navigate to={`/${tenantSlug}`} replace />;
  }
  return <>{children}</>;
}

function RootRoute() {
  const { session, loading } = useSession();
  if (loading) return <div className="eq-loading">Loading…</div>;
  if (session) return <Navigate to={`/${session.tenant.slug}`} replace />;
  return <LoginPage />;
}

function TenantTree() {
  const { session } = useSession();
  return (
    <BrandProvider tenant={session?.tenant ?? null}>
      <Routes>
        <Route index element={<TenantHome />} />
        <Route
          path="field"
          element={
            <ModuleGate module="field">
              <FieldIframe />
            </ModuleGate>
          }
        />
        <Route
          path="cards"
          element={
            <ModuleGate module="cards">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <CardsModule />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeModule />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="quotes"
          element={
            <ModuleGate module="quotes">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <QuotesModule />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="service"
          element={
            <ModuleGate module="service">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <ServiceModule />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="tender-pipeline/*"
          element={
            <ModuleGate module="tender_pipeline">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <TenderPipelineModule />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route path="*" element={<Navigate to="." replace />} />
      </Routes>
    </BrandProvider>
  );
}

function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<RootRoute />} />
          <Route
            path="/:tenantSlug/*"
            element={
              <RequireSession>
                <TenantTree />
              </RequireSession>
            }
          />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  );
}

export default App;
