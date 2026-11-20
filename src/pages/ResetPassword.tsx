import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Splash } from "../auth/RequireAuth";
import { supabase } from "../lib/supabase";
import { AlertCircleIcon } from "./Icons";
import { Logo } from "../components/ui";
import { useT } from "../i18n";
import { LangSwitch } from "../components/PrefsControls";

const MIN_LENGTH = 10;

/** Landing page for the password-recovery email link. Supabase signs the user in from the link;
 *  here they choose a new password. */
export default function ResetPassword() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <Splash />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LENGTH) {
      setError(t.auth.tooShort(MIN_LENGTH));
      return;
    }
    if (password !== confirm) {
      setError(t.auth.mismatch);
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) {
      setError(t.auth.savePasswordFailed);
      return;
    }
    navigate("/dashboard", { replace: true });
  };

  return (
    <main className="login gh">
      <section className="login-brand gh-inverse" aria-hidden="true">
        <Logo surface="inverse" height={40} />
        <div className="login-brand-copy">
          <p className="gh-eyebrow">{t.common.backOffice}</p>
          <h2 className="gh-h2">{t.auth.brandHeadline}</h2>
        </div>
      </section>

      <section className="login-panel">
        <LangSwitch className="login-lang" />
        <div className="login-card">
          <header>
            <Logo height={36} className="login-mobile-mark" />
            <p className="gh-eyebrow">{t.common.backOffice}</p>
            <h1 className="gh-h3">{t.auth.newPasswordTitle}</h1>
          </header>

          {!session ? (
            <div className="gh-form">
              <div className="gh-notice is-error" role="alert">
                <AlertCircleIcon />
                <p>{t.auth.linkInvalid}</p>
              </div>
              <div className="login-alt">
                <Link className="gh-link" to="/login">{t.auth.goToSignIn}</Link>
              </div>
            </div>
          ) : (
            <form className="gh-form" onSubmit={onSubmit} noValidate>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="new-password">{t.auth.newPassword}</label>
                <input
                  className="gh-input"
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <p className="gh-help">{t.auth.minLength(MIN_LENGTH)}</p>
              </div>
              <div className={`gh-field${error ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="confirm-password">{t.auth.confirmPassword}</label>
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
                  {busy ? t.common.saving : t.auth.savePassword}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
