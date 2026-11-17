import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Splash } from "../auth/RequireAuth";
import { supabase } from "../lib/supabase";
import { AlertCircleIcon } from "./Icons";

const MIN_LENGTH = 10;

/** Landing page for the password-recovery email link. Supabase signs the user in from the link;
 *  here they choose a new password. */
export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Splash />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError("No pudimos guardar la contraseña. Solicita un enlace nuevo e inténtalo otra vez.");
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  return (
    <main className="login gh">
      <section className="login-brand gh-inverse" aria-hidden="true">
        <span className="gh-wordmark">Grand Hill</span>
        <div className="login-brand-copy">
          <p className="gh-eyebrow">Back Office</p>
          <h2 className="gh-h2">Proyectos, subcontratistas y cotizaciones en un solo lugar</h2>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <header>
            <span className="gh-wordmark login-mobile-mark">Grand Hill</span>
            <p className="gh-eyebrow">Back Office</p>
            <h1 className="gh-h3">Nueva contraseña</h1>
          </header>

          {!session ? (
            <div className="gh-form">
              <div className="gh-notice is-error" role="alert">
                <AlertCircleIcon />
                <p>El enlace no es válido o ya venció. Solicita uno nuevo desde la pantalla de inicio de sesión.</p>
              </div>
              <div className="login-alt">
                <Link className="gh-link" to="/login">Ir a iniciar sesión</Link>
              </div>
            </div>
          ) : (
            <form className="gh-form" onSubmit={onSubmit} noValidate>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="new-password">Contraseña nueva</label>
                <input
                  className="gh-input"
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="gh-help">Mínimo {MIN_LENGTH} caracteres.</p>
              </div>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="confirm-password">Confirmar contraseña</label>
                <input
                  className="gh-input"
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              {error && (
                <div className="gh-notice is-error" role="alert">
                  <AlertCircleIcon />
                  <p>{error}</p>
                </div>
              )}
              <div className="login-actions">
                <button className="gh-btn gh-btn-primary gh-btn-block" type="submit" disabled={busy || !password || !confirm}>
                  {busy ? "Guardando…" : "Guardar contraseña"}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
