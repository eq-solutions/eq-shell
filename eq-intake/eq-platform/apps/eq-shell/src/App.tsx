/**
 * Shell App — auth gate + nav + lazy-loaded module routes.
 *
 * Routing shape:
 *   /                     redirects to the first enabled module
 *   /<module-path>        the module's UI (lazy-loaded)
 *   /signin               sign-in screen (only when auth is enabled +
 *                         no session)
 */

import { Suspense } from "react";
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext.js";
import { SignInScreen } from "./auth/SignInScreen.js";
import { readTenantConfig, type TenantConfig } from "./tenant-config.js";
import { enabledModules } from "./modules/registry.js";

export function App({ tenant }: { tenant: TenantConfig }): JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthGate tenant={tenant}>
          <ShellChrome tenant={tenant} />
        </AuthGate>
      </BrowserRouter>
    </AuthProvider>
  );
}

function AuthGate({
  tenant,
  children,
}: {
  tenant: TenantConfig;
  children: React.ReactNode;
}): JSX.Element {
  const { loading, session, authEnabled } = useAuth();
  if (!authEnabled) return <>{children}</>;
  if (loading) {
    return (
      <div className="eq-shell-loading">
        <span>Loading…</span>
      </div>
    );
  }
  if (!session) return <SignInScreen tenantName={tenant.name} />;
  return <>{children}</>;
}

function ShellChrome({ tenant }: { tenant: TenantConfig }): JSX.Element {
  const modules = enabledModules(tenant.enabledModules);
  const firstModulePath = modules[0]?.path ?? "/";

  return (
    <div className="eq-shell">
      <header className="eq-shell__header">
        <div className="eq-shell__brand">
          <h1>EQ</h1>
          <p>{tenant.name}</p>
        </div>
        <nav className="eq-shell__nav" aria-label="Modules">
          {modules.map((m) => (
            <NavLink
              key={m.id}
              to={m.path}
              className={({ isActive }) =>
                "eq-shell__nav-link" + (isActive ? " eq-shell__nav-link--active" : "")
              }
            >
              {m.label}
            </NavLink>
          ))}
        </nav>
        <UserBadge />
      </header>

      <main className="eq-shell__main">
        <Suspense fallback={<div className="eq-shell-loading">Loading module…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to={firstModulePath} replace />} />
            {modules.map((m) => {
              const Mod = m.component;
              return <Route key={m.id} path={m.path} element={<Mod />} />;
            })}
            <Route
              path="*"
              element={
                <div className="eq-module-stub">
                  <h2>Not found</h2>
                  <p>
                    That module isn't enabled for this tenant.{" "}
                    <a href={firstModulePath}>Back to {modules[0]?.label ?? "home"}</a>.
                  </p>
                </div>
              }
            />
          </Routes>
        </Suspense>
      </main>

      <footer className="eq-shell__footer">
        EQ · {tenant.name}
      </footer>
    </div>
  );
}

function UserBadge(): JSX.Element | null {
  const { session, signOut, authEnabled } = useAuth();
  if (!authEnabled || !session) return null;
  return (
    <div className="eq-shell__user">
      <span className="eq-shell__user-email">{session.user.email}</span>
      <button type="button" onClick={() => void signOut()} className="eq-shell__signout">
        Sign out
      </button>
    </div>
  );
}
