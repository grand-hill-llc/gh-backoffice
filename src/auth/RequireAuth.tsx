import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { homeFor, type Role } from "../lib/roles";
import { AlertCircleIcon } from "../pages/Icons";

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
  return (
    <div className="splash gh" role="status" aria-live="polite">
      <span className="gh-label">Cargando…</span>
    </div>
  );
}

function AccessProblem({ kind, detail }: { kind: "no-role" | "error"; detail?: string }) {
  const { session, signOut } = useAuth();
  const missingMigration = !!detail && /schema cache|does not exist|relation/i.test(detail);

  return (
    <main className="splash gh">
      <div className="login-card" style={{ padding: "0 20px" }}>
        <header>
          <p className="gh-eyebrow">Back Office</p>
          <h1 className="gh-h3">{kind === "no-role" ? "Tu cuenta aún no tiene acceso" : "No pudimos cargar tu perfil"}</h1>
        </header>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>
            {kind === "no-role"
              ? `La sesión de ${session?.user.email ?? "esta cuenta"} es válida, pero no tiene un rol asignado. Pídele a un super admin que te lo asigne.`
              : missingMigration
                ? "Falta aplicar la migración 0001_foundations.sql en Supabase (SQL Editor)."
                : "Revisa tu conexión e inténtalo de nuevo. Si sigue igual, avisa al super admin."}
          </p>
        </div>
        <div className="login-actions">
          <button className="gh-btn gh-btn-secondary" type="button" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </div>
    </main>
  );
}
