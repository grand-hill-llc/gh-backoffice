import { useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Splash } from "../auth/RequireAuth";
import { supabase } from "../lib/supabase";
import { AlertCircleIcon, CheckCircleIcon } from "./Icons";

type Mode = "signin" | "forgot";

export default function Login() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (loading) return <Splash />;
  if (session) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from !== "/login" ? from : "/"} replace />;
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(false);
  };

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) {
      // Same message for a wrong email or a wrong password: never reveal which accounts exist.
      setError(
        err.status === 400 || err.status === 401 || /invalid/i.test(err.message)
          ? "Correo o contraseña incorrectos."
          : "No pudimos conectar. Revisa tu conexión e inténtalo de nuevo."
      );
    }
    // On success the AuthProvider receives the session and this page redirects.
  };

  const onForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/restablecer`,
    });
    setBusy(false);
    if (err && err.status !== 400 && err.status !== 422) {
      setError("No pudimos enviar el correo. Inténtalo de nuevo en unos minutos.");
      return;
    }
    // Same confirmation whether or not the email has an account.
    setSent(true);
  };

  return (
    <main className="login gh">
      <section className="login-brand gh-inverse" aria-hidden="true">
        <span className="gh-wordmark">Grand Hill</span>
        <div className="login-brand-copy">
          <p className="gh-eyebrow">Back Office</p>
          <h2 className="gh-h2">Proyectos, subcontratistas y cotizaciones en un solo lugar</h2>
          <p>Acceso interno del equipo.</p>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <header>
            <span className="gh-wordmark login-mobile-mark">Grand Hill</span>
            <p className="gh-eyebrow">Back Office</p>
            <h1 className="gh-h3">{mode === "signin" ? "Iniciar sesión" : "Recuperar contraseña"}</h1>
            <p className="gh-small gh-muted">
              {mode === "signin"
                ? "Ingresa con tu correo y contraseña."
                : "Te enviaremos un enlace para crear una contraseña nueva."}
            </p>
          </header>

          {mode === "signin" ? (
            <form className="gh-form" onSubmit={onSignIn} noValidate>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="email">Correo</label>
                <input
                  className="gh-input"
                  id="email"
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="password">Contraseña</label>
                <input
                  className="gh-input"
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                  aria-describedby={error ? "form-error" : undefined}
                />
              </div>

              {error && (
                <div className="gh-notice is-error" role="alert" id="form-error">
                  <AlertCircleIcon />
                  <p>{error}</p>
                </div>
              )}

              <div className="login-actions">
                <button className="gh-btn gh-btn-primary gh-btn-block" type="submit" disabled={busy || !email || !password}>
                  {busy ? "Ingresando…" : "Ingresar"}
                </button>
                <div className="login-alt">
                  <button className="gh-link" type="button" onClick={() => switchMode("forgot")}>
                    Olvidé mi contraseña
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <form className="gh-form" onSubmit={onForgot} noValidate>
              {sent ? (
                <div className="gh-notice is-success" role="status">
                  <CheckCircleIcon />
                  <p>Si el correo tiene una cuenta, recibirás un enlace para restablecer la contraseña. Revisa también la carpeta de spam.</p>
                </div>
              ) : (
                <>
                  <div className="gh-field">
                    <label className="gh-field-label" htmlFor="email-forgot">Correo</label>
                    <input
                      className="gh-input"
                      id="email-forgot"
                      type="email"
                      autoComplete="username"
                      inputMode="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  {error && (
                    <div className="gh-notice is-error" role="alert">
                      <AlertCircleIcon />
                      <p>{error}</p>
                    </div>
                  )}
                  <div className="login-actions">
                    <button className="gh-btn gh-btn-primary gh-btn-block" type="submit" disabled={busy || !email}>
                      {busy ? "Enviando…" : "Enviar enlace"}
                    </button>
                  </div>
                </>
              )}
              <div className="login-alt">
                <button className="gh-link" type="button" onClick={() => switchMode("signin")}>
                  Volver a iniciar sesión
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
