import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { homeFor, type Role } from "../lib/roles";
import { AlertCircleIcon } from "../pages/Icons";
import { useT } from "../i18n";

/** Protected area: needs a session AND an assigned role. Signing in alone grants nothing. */
export function RequireAuth() {
  const { session, profile, profileError, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profileError) return <AccessProblem kind="error" detail={profileError} />;
  if (!profile) return <AccessProblem kind="no-role" />;
  return <Outlet />;
}

/** Limits a group of routes to some roles. Anyone else goes to their own home. */
export function RequireRole({ allow }: { allow: Role[] }) {
  const { profile } = useAuth();
  if (!profile) return null;
  if (!allow.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
  return <Outlet />;
}

export function Splash() {
  const t = useT();
  return (
    <div className="splash gh" role="status" aria-live="polite">
      <span className="gh-label">{t.common.loading}</span>
    </div>
  );
}

function AccessProblem({ kind, detail }: { kind: "no-role" | "error"; detail?: string }) {
  const { session, signOut } = useAuth();
  const t = useT();
  const missingMigration = !!detail && /schema cache|does not exist|relation/i.test(detail);

  return (
    <main className="splash gh">
      <div className="login-card" style={{ padding: "0 20px" }}>
        <header>
          <p className="gh-eyebrow">{t.common.backOffice}</p>
          <h1 className="gh-h3">{kind === "no-role" ? t.auth.noRoleTitle : t.auth.profileErrorTitle}</h1>
        </header>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>
            {kind === "no-role"
              ? t.auth.noRoleBody(session?.user.email ?? null)
              : missingMigration
                ? t.auth.missingMigration
                : t.auth.profileErrorBody}
          </p>
        </div>
        <div className="login-actions">
          <button className="gh-btn gh-btn-secondary" type="button" onClick={signOut}>
            {t.common.signOut}
          </button>
        </div>
      </div>
    </main>
  );
}
