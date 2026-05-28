import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import { SessionContext, useSession, type ShellSession, moduleEnabled } from './session';
import { seedSupabaseJwtCache } from './lib/supabaseJwt';
import { BrandProvider } from './brand';
import { identifyUser, resetUser } from './observability';
import LoginPage from './pages/LoginPage';
import TenantHome from './pages/TenantHome';
import FieldIframe from './pages/FieldIframe';
import CardsIframe from './pages/CardsIframe';
import AcceptInvite from './pages/AcceptInvite';
import ResetPin from './pages/ResetPin';
import TenantPicker from './pages/TenantPicker';
import TotpChallenge from './pages/TotpChallenge';
import EnrollTotp from './pages/EnrollTotp';
import AdminInviteUser from './pages/AdminInviteUser';
import AdminUserList from './pages/AdminUserList';
import AdminEditUser from './pages/AdminEditUser';
import AdminAuditPage from './pages/AdminAuditPage';
import AdminTenantSettings from './pages/AdminTenantSettings';
import AdminCardsFeed from './pages/AdminCardsFeed';
import EntityBrowserPage from './pages/EntityBrowserPage';
import ServiceIframe from './pages/ServiceIframe';
import QuotesIframe from './pages/QuotesIframe';
import StorageBrowser from './pages/StorageBrowser';
import NotFound from './pages/NotFound';
import { RouteProgressBar } from './components/RouteProgressBar';
import './App.css';

// Q5 lock: each module is its own lazy chunk so disabled tenants
// never pay the bandwidth cost. Cards is the exception — it's an
// iframe to the standalone Cards Flutter web app (not a lazy React
// chunk), so CardsIframe is imported eagerly above with the other
// page components. The lazy CardsModule is dropped.
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
// QuotesModule (link-out stub) replaced by QuotesIframe — persistent keeper below.

// Session cache — stores last good session in sessionStorage so returning
// users see content immediately while verify-shell-session runs in background.
const SESSION_STORE_KEY = 'eq_s';

function readStoredSession(): ShellSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORE_KEY);
    return raw ? (JSON.parse(raw) as ShellSession) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(s: ShellSession | null): void {
  try {
    if (s) {
      sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify(s));
    } else {
      sessionStorage.removeItem(SESSION_STORE_KEY);
    }
  } catch {
    // sessionStorage unavailable (private browsing, quota) — ignore.
  }
}

// SessionProvider — hydrates session via verify-shell-session on mount,
// re-exposes the result to the rest of the tree.
function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<ShellSession | null>(() => {
    const s = readStoredSession();
    if (s) seedSupabaseJwtCache(s.supabase_jwt);
    return s;
  });
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/.netlify/functions/verify-shell-session', {
        credentials: 'include',
      });
      if (res.ok) {
        const body = (await res.json()) as ShellSession & { valid: true };
        const { user, tenant, entitlements, supabase_jwt, memberships } = body;
        const s = { user, tenant, entitlements, supabase_jwt, memberships: memberships ?? [{ tenant_id: tenant.id, role: user.role }] };
        setSession(s);
        writeStoredSession(s);
        seedSupabaseJwtCache(supabase_jwt);
        identifyUser(user.id, {
          tenant: tenant.slug,
          role: user.role,
          email: user.email,
        });
      } else {
        setSession(null);
        writeStoredSession(null);
        resetUser();
      }
    } catch {
      setSession(null);
      writeStoredSession(null);
      resetUser();
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // The eq_shell_session cookie is HttpOnly so JS can't drop it
    // directly. We POST /shell-logout which sends back a Set-Cookie
    // with Max-Age=0 + Expires in the past. Mirrored cookie attrs so
    // the browser actually accepts the clear directive. Without this,
    // verify-shell-session re-hydrates on the next request and the
    // user is silently signed back in.
    try {
      await fetch('/.netlify/functions/shell-logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Logout is best-effort — even if the network drops, we still
      // clear local state below so the UI reflects signed-out.
    }
    setSession(null);
    writeStoredSession(null);
    resetUser();
    window.location.assign('/');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Background poll every 5 min so deactivated users / role changes
  // take effect without requiring a page navigation. verify-shell-session
  // checks active=true in the DB and returns 401 if the user is inactive,
  // which setSession(null) + resetUser() handles above.
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 5 * 60 * 1000);
    return () => clearInterval(id);
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

  // Only block on the loading spinner when there is no session at all.
  // If a cached session exists, render optimistically — verify-shell-session
  // runs in the background and clears the session if it finds the user
  // deactivated or their token expired.
  if (loading && !session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh' }}>
        <span className="eq-skeleton eq-skeleton--text" style={{ width: 120 }} aria-label="Loading…" />
      </div>
    );
  }
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
  if (session) return <Navigate to={`/${session.tenant.slug}`} replace />;
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh' }}>
        <span className="eq-skeleton eq-skeleton--text" style={{ width: 120 }} aria-label="Loading…" />
      </div>
    );
  }
  return <LoginPage />;
}

function TenantTree() {
  const { session } = useSession();
  const location = useLocation();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  // Derive which iframe route is currently active (field / cards / service).
  const activeIframe = (() => {
    if (!tenantSlug) return null;
    const base = `/${tenantSlug}/`;
    const rest = location.pathname.startsWith(base)
      ? location.pathname.slice(base.length)
      : '';
    if (rest === 'field' || rest.startsWith('field/')) return 'field' as const;
    if (rest === 'cards' || rest.startsWith('cards/')) return 'cards' as const;
    if (rest === 'service' || rest.startsWith('service/')) return 'service' as const;
    if (rest === 'quotes' || rest.startsWith('quotes/')) return 'quotes' as const;
    return null;
  })();

  // Tracks iframes that have ever been activated. Ref (not state) so the
  // mutation doesn't trigger extra renders. Mutated during render — safe
  // because Set.add is idempotent and refs are not tracked by React.
  const evermounted = useRef(new Set<'field' | 'cards' | 'service' | 'quotes'>());
  if (activeIframe) evermounted.current.add(activeIframe);

  // Eager pre-warm: mount all enabled iframe apps in the background 2.5s
  // after the session is confirmed. By the time the user clicks into any
  // app, the auth handshake is already complete and the iframe is live.
  // Only triggers once per session (boolean state, not the session object).
  const [eagerTriggered, setEagerTriggered] = useState(false);
  const sessionExists = !!session;
  useEffect(() => {
    if (!sessionExists) return;
    const t = setTimeout(() => setEagerTriggered(true), 2500);
    return () => clearTimeout(t);
  }, [sessionExists]);

  const fieldEnabled = moduleEnabled(session, 'field');
  const cardsEnabled = moduleEnabled(session, 'cards');
  const serviceEnabled = moduleEnabled(session, 'service');
  const quotesEnabled = moduleEnabled(session, 'quotes');

  return (
    <BrandProvider tenant={session?.tenant ?? null}>
      {/* Persistent iframe keepers — mounted on first visit OR after the 2.5s
          eager pre-warm fires, then toggled display:none so the iframe process
          keeps running between navigations. Pre-warming means Service/Field are
          already auth'd and rendered by the time the user clicks the nav item. */}
      {fieldEnabled && (evermounted.current.has('field') || eagerTriggered) && (
        <div style={activeIframe === 'field' ? undefined : { display: 'none' }}>
          <FieldIframe />
        </div>
      )}
      {cardsEnabled && (evermounted.current.has('cards') || eagerTriggered) && (
        <div style={activeIframe === 'cards' ? undefined : { display: 'none' }}>
          <CardsIframe />
        </div>
      )}
      {serviceEnabled && (evermounted.current.has('service') || eagerTriggered) && (
        <div style={activeIframe === 'service' ? undefined : { display: 'none' }}>
          <ServiceIframe />
        </div>
      )}
      {quotesEnabled && (evermounted.current.has('quotes') || eagerTriggered) && (
        <div style={activeIframe === 'quotes' ? undefined : { display: 'none' }}>
          <QuotesIframe />
        </div>
      )}
      <Routes>
        <Route index element={<TenantHome />} />
        <Route
          path="field"
          element={<ModuleGate module="field">{null}</ModuleGate>}
        />
        <Route
          path="cards"
          element={<ModuleGate module="cards">{null}</ModuleGate>}
        />
        <Route
          path="intake"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
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
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
                <IntakeCoreLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/field"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
                <IntakeFieldLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/quotes"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
                <IntakeQuotesLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/cards"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
                <IntakeCardsLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/service"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<div className="eq-page-loading" aria-label="Loading…"><span className="eq-skeleton eq-skeleton--row" style={{ width: '60%', margin: '48px auto', display: 'block' }} /></div>}>
                <IntakeServiceLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="service"
          element={<ModuleGate module="service">{null}</ModuleGate>}
        />
        {/* Quotes is a persistent iframe keeper (see above) — the route just
            needs to exist so the active-iframe detection fires and the keeper
            div becomes visible. No children required. */}
        <Route
          path="quotes"
          element={<ModuleGate module="quotes">{null}</ModuleGate>}
        />
        {/* Phase 1.F: admin user-management routes. Permission checks
            live in the page components via <Gate perm="..."> — the
            route is reachable to any signed-in tenant user, but the
            UI shows "Not allowed" when the role doesn't grant it.
            Order matters: 'invite' (static) before ':userId' (param). */}
        <Route path="admin/users" element={<AdminUserList />} />
        <Route path="admin/users/invite" element={<AdminInviteUser />} />
        <Route path="admin/users/:userId" element={<AdminEditUser />} />
        {/* S3 — audit log viewer + entity browser */}
        <Route path="admin/audit" element={<AdminAuditPage />} />
        {/* Cards → Field review queue */}
        <Route path="admin/cards-feed" element={<AdminCardsFeed />} />
        {/* Polish 2026-05-21 — tenant settings */}
        <Route path="admin/settings" element={<AdminTenantSettings />} />
        {/* Phase 1.G — TOTP 2FA enrollment (any logged-in user) */}
        <Route path="settings/2fa" element={<EnrollTotp />} />
        <Route path="storage" element={<StorageBrowser />} />
        <Route path="data/:entity" element={<EntityBrowserPage />} />
        {/* Real 404 instead of silent redirect to home (caught users in a
            loop where stale links just bounced them home with no signal). */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrandProvider>
  );
}

function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <RouteProgressBar />
        <Routes>
          <Route path="/" element={<RootRoute />} />
          {/* Phase 1.F: public invite-accept landing. Lives OUTSIDE
              the RequireSession wrap — the user clicking the invite
              link doesn't have a session yet; the function sets one
              on success. */}
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/reset-pin" element={<ResetPin />} />
          <Route path="/select-tenant" element={<TenantPicker />} />
          {/* Phase 1.G: TOTP challenge shown after PIN login when 2FA is enrolled */}
          <Route path="/totp-challenge" element={<TotpChallenge />} />
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
