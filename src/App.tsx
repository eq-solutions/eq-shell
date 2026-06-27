import { useCallback, useEffect, useRef, useState, lazy, Suspense, Component, type ReactNode, type CSSProperties } from 'react';
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
import ProfileSettings from './pages/ProfileSettings';
import AdminHub from './pages/AdminHub';
import AdminInviteUser from './pages/AdminInviteUser';
import AdminBulkInvite from './pages/AdminBulkInvite';
import AdminInviteMigratedStaff from './pages/AdminInviteMigratedStaff';
import AdminUserList from './pages/AdminUserList';
import AdminEditUser from './pages/AdminEditUser';
import AdminAuditPage from './pages/AdminAuditPage';
import AccessControlPage from './pages/AccessControlPage';
import AdminTenantSettings from './pages/AdminTenantSettings';
import AdminWorkerInvites from './pages/AdminWorkerInvites';
import AdminWorkerInviteForm from './pages/AdminWorkerInviteForm';
import AdminConnectWorker from './pages/AdminConnectWorker';
import AdminWorkerQR from './pages/AdminWorkerQR';
import AdminTenantsPage from './pages/AdminTenantsPage';
import AdminWorkersPage from './pages/AdminWorkersPage';
import AdminMigrationPage from './pages/AdminMigrationPage';
import AdminSecurityGroups from './pages/AdminSecurityGroups';
import AdminDataActivationPage from './pages/AdminDataActivationPage';
import EntityBrowserPage from './pages/EntityBrowserPage';
import FieldRosterPage from './pages/FieldRosterPage';
import { CustomersPage } from './pages/CustomersPage';
import { StaffPage } from './pages/StaffPage';
import ServiceIframe from './pages/ServiceIframe';
const EqOpsPage = lazy(() => import('./pages/EqOps'));
import StorageBrowser from './pages/StorageBrowser';
import LicenceOcrPage from './pages/ocr/LicenceOcrPage';
import NotFound from './pages/NotFound';
import QuotePortal from './portal/QuotePortal';
import { RouteProgressBar } from './components/RouteProgressBar';
import { Skeleton } from './components/Skeleton';
import { Spinner } from '@eq-solutions/ui';
import './App.css';

function PageLoadingFallback() {
  return (
    <div className="eq-page-loading" aria-label="Loading…">
      <Skeleton variant="row" width="60%" />
    </div>
  );
}

// Catches "Failed to fetch dynamically imported module" errors that occur when
// a user has a cached HTML shell pointing at chunk hashes that no longer exist
// after a new deploy. A full reload fetches the current HTML + new chunks.
class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('dynamically imported module') || msg.includes('Failed to fetch')) {
      window.location.reload();
    }
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return <PageLoadingFallback />;
    return this.props.children;
  }
}

// Q5 lock: each module is its own lazy chunk so disabled tenants
// never pay the bandwidth cost. Cards is the exception — it's an
// iframe to the standalone Cards Flutter web app (not a lazy React
// chunk), so CardsIframe is imported eagerly above with the other
// page components. The lazy CardsModule is dropped.
const IntakeModule = lazy(() => import('./modules/intake/index'));
const GmReportsModule = lazy(() => import('./modules/gm-reports/index'));
const CommsModule = lazy(() => import('./modules/comms/index'));
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
// Review queue — reviewer side of the intake staging flow (intake-stage parks
// flagged rows; this approves/rejects them). Gated by intake.commit inside.
const IntakeReviewQueue = lazy(() =>
  import('./modules/intake/ReviewQueue').then((m) => ({ default: m.IntakeReviewQueue })),
);
// Plant & Equipment — internal calibration register. Permission-gated inside
// the component (useCan), not an entitlement module, so no ModuleGate.
const EquipmentModule = lazy(() => import('./modules/equipment/index'));

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
    const init = async () => {
      // Post-provision handoff: Cards opens Shell with #sh=<goTrueToken>
      // appended to the URL. Exchange it for a shell session cookie before
      // running the normal session verify, so the admin lands already logged
      // in — no second OTP required.
      const hash = window.location.hash; // e.g. "#sh=eyJhb..."
      if (hash.startsWith('#sh=')) {
        const token = new URLSearchParams(hash.slice(1)).get('sh') ?? '';
        // Strip the fragment immediately — don't leave JWTs in browser history.
        history.replaceState(null, '', window.location.pathname + window.location.search);
        if (token) {
          try {
            await fetch('/.netlify/functions/shell-handoff-provision', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ access_token: token }),
            });
          } catch {
            // Non-fatal — fall through to normal session check. If the
            // exchange fails the admin sees the login page and can sign in
            // with their phone number as before.
          }
        }
      }
      void refresh();
    };
    void init();
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
        <Spinner size="lg" label="Loading…" />
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
  const { session, loading } = useSession();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  if (!session) return null;
  // Hold until verify-shell-session resolves. The stale sessionStorage session
  // may have incomplete entitlements (e.g. after a hard refresh mid-flight).
  // Redirecting before verify completes would bounce the user back to the tenant
  // home even though the module is actually entitled.
  if (loading) return null;
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
        <Spinner size="lg" label="Loading…" />
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
        <Spinner size="lg" label="Loading…" />
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
      <Route path="workers" element={<AdminWorkersPage />} />
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
    // Only the top-level /field route renders the legacy iframe keeper.
    // Sub-routes like /field/roster are native React pages — don't overlay the iframe.
    if (rest === 'field') return 'field' as const;
    if (rest === 'cards' || rest.startsWith('cards/')) return 'cards' as const;
    if (rest === 'service' || rest.startsWith('service/')) return 'service' as const;
    return null;
  })();

  // Tracks iframes that have ever been activated. Ref (not state) so the
  // mutation doesn't trigger extra renders. Mutated during render — safe
  // because Set.add is idempotent and refs are not tracked by React.
  const evermounted = useRef(new Set<'field' | 'cards' | 'service'>());
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
          <FieldIframe active={activeIframe === 'field'} />
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
      <Routes>
        <Route index element={<TenantHome />} />
        <Route
          path="field"
          element={<ModuleGate module="field">{null}</ModuleGate>}
        />
        <Route
          path="field/roster"
          element={<ModuleGate module="field"><FieldRosterPage /></ModuleGate>}
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
          path="intake/review"
          element={
            <ModuleGate module="intake">
              <Suspense fallback={<PageLoadingFallback />}>
                <IntakeReviewQueue />
              </Suspense>
            </ModuleGate>
          }
        />
        <Route
          path="service/*"
          element={<ModuleGate module="service">{null}</ModuleGate>}
        />
        {/* Legacy /quotes and /eq-quotes redirect to /ops (muscle-memory + saved links). */}
        <Route path="quotes" element={<Navigate to="ops" replace />} />
        <Route path="eq-quotes" element={<Navigate to="ops" replace />} />
        {/* EQ Ops — quoting and job-number tracking. */}
        <Route
          path="ops"
          element={
            <Suspense fallback={<PageLoadingFallback />}>
              <EqOpsPage />
            </Suspense>
          }
        />
        {/* Admin — hub landing + sub-pages. Permission checks live in each page
            via <Gate perm="...">. Order matters: static paths before :userId. */}
        <Route path="admin" element={<AdminHub />} />
        {/* Platform-operator console moved to /_platform/tenants. Redirect old links. */}
        <Route path="admin/tenants" element={<Navigate to="/_platform/tenants" replace />} />
        <Route path="admin/users" element={<AdminUserList />} />
        <Route path="admin/users/invite" element={<AdminInviteUser />} />
        <Route path="admin/users/invite-bulk" element={<AdminBulkInvite />} />
        <Route path="admin/users/migrate" element={<AdminInviteMigratedStaff />} />
        <Route path="admin/users/:userId" element={<AdminEditUser />} />
        <Route path="admin/audit" element={<AdminAuditPage />} />
        <Route path="admin/workers" element={<AdminWorkerInvites />} />
        <Route path="admin/workers/invite" element={<AdminWorkerInviteForm />} />
        <Route path="admin/workers/connect" element={<AdminConnectWorker />} />
        <Route path="admin/workers/qr" element={<AdminWorkerQR />} />
        <Route path="admin/settings" element={<AdminTenantSettings />} />
        <Route path="admin/access-control" element={<AccessControlPage />} />
        <Route path="admin/security-groups" element={<AdminSecurityGroups />} />
        <Route path="admin/migration" element={<AdminMigrationPage />} />
        <Route path="admin/data-activation" element={<AdminDataActivationPage />} />
        {/* Self-serve profile edit (any logged-in user) */}
        <Route path="settings/profile" element={<ProfileSettings />} />
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
        <Route
          path="comms/*"
          element={
            <ModuleGate module="comms">
              <Suspense fallback={<PageLoadingFallback />}>
                <CommsModule />
              </Suspense>
            </ModuleGate>
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
        {/* Customers — tabbed Customers / Sites / Contacts view. */}
        <Route path="customers" element={<CustomersPage />} />
        {/* Legacy CRM tree — redirect to the new Customers page */}
        <Route path="crm" element={<Navigate to="../customers" replace />} />
        {/* Staff — list + training matrix view with licence summary. */}
        <Route path="staff" element={<StaffPage />} />
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
    <ChunkErrorBoundary>
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
          {/* Public client portal — registered before /:tenantSlug/* so 'portal'
              is never parsed as a tenant slug. No session required. */}
          <Route path="/portal/quote/:tenantSlug/:token" element={<QuotePortal />} />
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
    </ChunkErrorBoundary>
  );
}

export default App;
