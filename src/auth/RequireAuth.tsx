import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";

/** Wraps protected routes: no session sends the user to /login. */
export function RequireAuth() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Splash />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function Splash() {
  return (
    <div className="splash gh" role="status" aria-live="polite">
      <span className="gh-label">Cargando…</span>
    </div>
  );
}
