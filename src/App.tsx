import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ReactNode, type CSSProperties } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useParams,
} from 'react-router-dom';
import { SessionContext, useSession, type ShellSession, moduleEnabled, DEFAULT_TENANT_CONFIG } from './session';
import { seedSupabaseJwtCache } from './lib/supabaseJwt';
import { BrandProvider } from './brand';
import { identifyUser, resetUser } from './observability';
import LoginPage from './pages/LoginPage';
import AuthCallbackPage from './pages/AuthCallbackPage';
import TenantHome from './pages/TenantHome';
import FieldIframe from './pages/FieldIframe';
import CardsIframe from './pages/CardsIframe';
import AcceptInvite from './pages/AcceptInvite';
import ResetPin from './pages/ResetPin';
import TenantPicker from './pages/TenantPicker';
import TotpChallenge from './pages/TotpChallenge';
import EnrollTotp from './pages/EnrollTotp';
import AdminInviteUser from './pages/AdminInviteUser';
import AdminBulkInvite from './pages/AdminBulkInvite';
import AdminInviteMigratedStaff from './pages/AdminInviteMigratedStaff';
import AdminUserList from './pages/AdminUserList';
import AdminEditUser from './pages/AdminEditUser';
import AdminAuditPage from './pages/AdminAuditPage';
import AdminMigrationPage from './pages/AdminMigrationPage';
import SecurityGroupsPage from './pages/SecurityGroupsPage';
import AccessControlPage from './pages/AccessControlPage';
import AdminTenantSettings from './pages/AdminTenantSettings';
import AdminCardsFeed from './pages/AdminCardsFeed';
import AdminTenantsPage from './pages/AdminTenantsPage';
import EntityBrowserPage from './pages/EntityBrowserPage';
import CustomersHubPage from './pages/CustomersHubPage';
import ServiceIframe from './pages/ServiceIframe';
import QuotesIframe from './pages/QuotesIframe';
import StorageBrowser from './pages/StorageBrowser';
import LicenceOcrPage from './pages/ocr/LicenceOcrPage';
import NotFound from './pages/NotFound';
import { RouteProgressBar } from './components/RouteProgressBar';
import { Skeleton } from './components/Skeleton';
import './App.css';

function PageLoadingFallback() {
  return (
    <div className="eq-page-loading" aria-label="Loading…">
      <Skeleton variant="row" width="60%" />
    </div>
  );
}

// Q5 lock: each module is its own lazy chunk so disabled tenants
// never pay the bandwidth cost. Cards is the exception — it's an
// iframe to the standalone Cards Flutter web app (not a lazy React
// chunk), so CardsIframe is imported eagerly above with the other
// page components. The lazy CardsModule is dropped.
const IntakeModule = lazy(() => import('./modules/intake/index'));
const GmReportsModule = lazy(() => import('./modules/gm-reports/index'));
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
// Plant & Equipment — internal calibration register. Permission-gated inside
// the component (useCan), not an entitlement module, so no ModuleGate.
const EquipmentModule = lazy(() => import('./modules/equipment/index'));
// QuotesModule (link-out stub) replaced by QuotesIframe — persistent keeper below.

// Inactive iframe keepers stay mounted but hidden. We must NOT use
// `display: none`: an iframe laid out under display:none collapses to 0×0,
// so height-measuring apps inside (EQ Field's virtual tables / dashboard,
// Flutter canvas, etc.) render into zero height and never recompute when
// later revealed — the frame shows blank. `visibility: hidden` at full
// viewport size keeps real dimensions so the content renders correctly
// while pre-warmed in the background; `pointer-events: none` stops the
// invisible layer from swallowing clicks meant for the active frame.
// (Same approach ServiceIframe uses internally for its own loading state.)
const HIDDEN_IFRAME_KEEPER_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
};

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
        const { user, tenant, entitlements, supabase_jwt, memberships, config, requires_totp_enrollment } = body;
        const s = { user, tenant, entitlements, supabase_jwt, memberships: memberships ?? [{ tenant_id: tenant.id, role: user.role }], config: config ?? DEFAULT_TENANT_CONFIG, requires_totp_enrollment };
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
        <Skeleton variant="text" width={120} />
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
        <Skeleton variant="text" width={120} />
      </div>
    );
  }
  return <LoginPage />;
}

// Gate for the platform-operator console (/_platform/*). Mirrors RequireSession
// but has no tenant slug to match — instead it requires is_platform_admin.
// Non-operators bounce to their own tenant home.
function RequirePlatformSession({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const location = useLocation();
  if (loading && !session) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100svh' }}>
        <Skeleton variant="text" width={120} />
      </div>
    );
  }
  if (!session) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  if (!session.user.is_platform_admin) {
    return <Navigate to={`/${session.tenant.slug}`} replace />;
  }
  return <>{children}</>;
}

// Platform-operator console — cross-tenant surfaces that don't belong in any one
// tenant's URL space (tenant provisioning today; room for more operator tools).
function PlatformTree() {
  return (
    <Routes>
      <Route index element={<Navigate to="tenants" replace />} />
      <Route path="tenants" element={<AdminTenantsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
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

  // Forced second-step gate: a manager/supervisor/platform-admin past
  // their grace runway is held on /settings/2fa until they enrol. Placed
  // after all hooks above so this early return can't violate rules-of-hooks.
  const onEnrolPage = !!tenantSlug && location.pathname.startsWith(`/${tenantSlug}/settings/2fa`);
  if (session?.requires_totp_enrollment && !onEnrolPage) {
    return <Navigate to={`/${tenantSlug}/settings/2fa`} replace />;
  }

  return (
    <BrandProvider tenant={session?.tenant ?? null}>
      {/* Persistent iframe keepers — mounted on first visit OR after the 2.5s
          eager pre-warm fires, then toggled display:none so the iframe process
          keeps running between navigations. Pre-warming means Service/Field are
          already auth'd and rendered by the time the user clicks the nav item. */}
      {fieldEnabled && (evermounted.current.has('field') || eagerTriggered) && (
        <div style={activeIframe === 'field' ? undefined : HIDDEN_IFRAME_KEEPER_STYLE}>
          <FieldIframe />
        </div>
      )}
      {cardsEnabled && (evermounted.current.has('cards') || eagerTriggered) && (
        <div style={activeIframe === 'cards' ? undefined : HIDDEN_IFRAME_KEEPER_STYLE}>
          <CardsIframe />
        </div>
      )}
      {serviceEnabled && (evermounted.current.has('service') || eagerTriggered) && (
        <div style={activeIframe === 'service' ? undefined : HIDDEN_IFRAME_KEEPER_STYLE}>
          <ServiceIframe />
        </div>
      )}
      {quotesEnabled && (evermounted.current.has('quotes') || eagerTriggered) && (
        <div style={activeIframe === 'quotes' ? undefined : HIDDEN_IFRAME_KEEPER_STYLE}>
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
              <Suspense fallback={<PageLoadingFallback />}>
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
              <Suspense fallback={<PageLoadingFallback />}>
                <IntakeCoreLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/field"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<PageLoadingFallback />}>
                <IntakeFieldLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/quotes"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<PageLoadingFallback />}>
                <IntakeQuotesLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/cards"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<PageLoadingFallback />}>
                <IntakeCardsLanding />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="intake/service"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<PageLoadingFallback />}>
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
        {/* Platform-operator console moved to /_platform/tenants. Redirect old
            in-tenant links/bookmarks so nothing breaks. */}
        <Route path="admin/tenants" element={<Navigate to="/_platform/tenants" replace />} />
        <Route path="admin/users" element={<AdminUserList />} />
        <Route path="admin/users/invite" element={<AdminInviteUser />} />
        <Route path="admin/users/invite-bulk" element={<AdminBulkInvite />} />
        <Route path="admin/users/migrate" element={<AdminInviteMigratedStaff />} />
        <Route path="admin/users/:userId" element={<AdminEditUser />} />
        {/* S3 — audit log viewer + entity browser */}
        <Route path="admin/audit" element={<AdminAuditPage />} />
        {/* Migration reconciliation — expected vs landed counts per entity */}
        <Route path="admin/migration" element={<AdminMigrationPage />} />
        {/* Cards → Field review queue */}
        <Route path="admin/cards-feed" element={<AdminCardsFeed />} />
        {/* Polish 2026-05-21 — tenant settings */}
        <Route path="admin/settings" element={<AdminTenantSettings />} />
        <Route path="admin/security-groups" element={<SecurityGroupsPage />} />
        <Route path="admin/access-control" element={<AccessControlPage />} />
        {/* Phase 1.G — TOTP 2FA enrollment (any logged-in user) */}
        <Route path="settings/2fa" element={<EnrollTotp />} />
        <Route
          path="reports/*"
          element={
            <Suspense fallback={<PageLoadingFallback />}>
              <GmReportsModule />
            </Suspense>
          }
        />
        <Route path="storage" element={<StorageBrowser />} />
        {/* Plant & Equipment — calibration register. Gated by useCan inside
            the component, like the admin/data routes (reachable to any
            signed-in user; shows "Not allowed" without equipment.view). */}
        <Route
          path="equipment"
          element={
            <Suspense fallback={<PageLoadingFallback />}>
              <EquipmentModule />
            </Suspense>
          }
        />
        {/* Customers CRM hub — the primary way into customer→sites→contacts.
            The flat /data/site + /data/contact routes stay for power users. */}
        <Route path="customers" element={<CustomersHubPage />} />
        <Route path="data/:entity" element={<EntityBrowserPage />} />
        {/* D3.3d — Shell-hosted licence OCR onboarding (browser fallback for Cards OCR) */}
        <Route path="onboarding/licence" element={<LicenceOcrPage />} />
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
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/reset-pin" element={<ResetPin />} />
          <Route path="/select-tenant" element={<TenantPicker />} />
          {/* Phase 1.G: TOTP challenge shown after PIN login when 2FA is enrolled */}
          <Route path="/totp-challenge" element={<TotpChallenge />} />
          {/* Platform-operator console — top-level, tenant-less, operator-gated.
              Registered before /:tenantSlug/* so '_platform' is never parsed as
              a tenant slug. */}
          <Route
            path="/_platform/*"
            element={
              <RequirePlatformSession>
                <PlatformTree />
              </RequirePlatformSession>
            }
          />
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
