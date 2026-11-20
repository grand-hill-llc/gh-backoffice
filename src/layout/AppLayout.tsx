import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { NAV, ROLE_LABEL } from "../lib/roles";

export default function AppLayout() {
  const { profile, session, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  if (!profile) return null;

  const items = NAV.filter((i) => i.roles.includes(profile.role));
  const who = profile.full_name || session?.user.email || "";

  return (
    <div className="app gh">
      <div className="app-topbar gh-inverse">
        <span className="gh-wordmark">Grand Hill</span>
        <button
          className="gh-btn gh-btn-secondary gh-btn-sm"
          type="button"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cerrar" : "Menú"}
        </button>
      </div>

      <aside id="sidebar" className={`sidebar gh-inverse${open ? " is-open" : ""}`}>
        <div className="sidebar-top">
          <span className="gh-wordmark sidebar-mark">Grand Hill</span>
          <p className="gh-label sidebar-label">Back Office</p>
          <nav aria-label="Principal">
            <ul className="nav-list">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className="nav-link" onClick={() => setOpen(false)}>
                    <span className="gh-square nav-dot" aria-hidden="true" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="sidebar-user">
          <p className="sidebar-user-name">{who}</p>
          <p className="gh-label">{ROLE_LABEL[profile.role]}</p>
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={signOut}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="app-main">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
