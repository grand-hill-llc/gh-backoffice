import { useAuth } from "../auth/AuthProvider";

export default function Dashboard() {
  const { session, signOut } = useAuth();

  return (
    <div className="shell gh">
      <header className="gh-header">
        <div className="gh-container">
          <div className="gh-header-bar">
            <span className="gh-wordmark">Grand Hill</span>
            <div className="gh-header-actions">
              <span className="gh-small gh-muted">{session?.user.email}</span>
              <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={signOut}>
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="shell-main">
        <div className="gh-container">
          <p className="gh-eyebrow">Back Office</p>
          <h1 className="gh-h1">Panel</h1>
          <p className="gh-body-lg gh-muted">
            Aquí vivirán los proyectos, los subcontratistas y las cotizaciones.
          </p>
        </div>
      </main>
    </div>
  );
}
