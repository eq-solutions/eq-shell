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
import CardsIframe from './pages/CardsIframe';
import AcceptInvite from './pages/AcceptInvite';
import AdminInviteUser from './pages/AdminInviteUser';
import AdminUserList from './pages/AdminUserList';
import AdminEditUser from './pages/AdminEditUser';
import './App.css';

// Q5 lock: each module is its own lazy chunk so disabled tenants
// never pay the bandwidth cost. Cards is the exception — it's an
// iframe to the standalone Cards Flutter web app (not a lazy React
// chunk), so CardsIframe is imported eagerly above with the other
// page components. The lazy CardsModule is dropped.
//
// Phase 1.F restructured src/modules/intake.tsx → src/modules/intake/
// (per IDENTITY-MODEL.md §4.3, so the per-module permissions.ts can
// sit beside index.tsx). Explicit '/index' path avoids ambiguity
// with the old intake.tsx file, which is left orphaned for cleanup
// in a follow-up PR (CLAUDE.md hard rule: no deletes without
// explicit permission).
const IntakeModule = lazy(() => import('./modules/intake/index'));
// Unit 7 — per-domain landing pages.
const IntakeCoreLanding = lazy(() =>
  import('./modules/intake/DomainLanding').then((m) => ({ default: m.CoreIntakeLanding })),
);
const IntakeFieldLanding = lazy(() =>
  import('./modules/intake/DomainLanding').then((m) => ({ default: m.FieldIntakeLanding })),
);
const IntakeQuotesLanding = lazy(() =>
  import('./modules/intake/DomainLanding').then((m) => ({ default: m.QuotesIntakeLanding })),
);
const IntakeCardsLanding = lazy(() =>
  import('./modules/intake/DomainLanding').then((m) => ({ default: m.CardsIntakeLanding })),
);
const IntakeServiceLanding = lazy(() =>
  import('./modules/intake/DomainLanding').then((m) => ({ default: m.ServiceIntakeLanding })),
);
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
              <CardsIframe />
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
        {/* Unit 7: per-domain intake landing pages, driven by
            eq_list_module_entities. Each lists every canonical entity
            registered for that module; the generic ParserDropZone
            wiring per entity is the next step. */}
        <Route
          path="intake/core"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeCoreLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/field"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeFieldLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/quotes"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeQuotesLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/cards"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeCardsLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/service"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-loading">Loading…</div>}>
                <IntakeServiceLanding />
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
        {/* Phase 1.F: admin user-management routes. Permission checks
            live in the page components via <Gate perm="..."> — the
            route is reachable to any signed-in tenant user, but the
            UI shows "Not allowed" when the role doesn't grant it.
            Order matters: 'invite' (static) before ':userId' (param). */}
        <Route path="admin/users" element={<AdminUserList />} />
        <Route path="admin/users/invite" element={<AdminInviteUser />} />
        <Route path="admin/users/:userId" element={<AdminEditUser />} />
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
          {/* Phase 1.F: public invite-accept landing. Lives OUTSIDE
              the RequireSession wrap — the user clicking the invite
              link doesn't have a session yet; the function sets one
              on success. */}
          <Route path="/accept-invite" element={<AcceptInvite />} />
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
