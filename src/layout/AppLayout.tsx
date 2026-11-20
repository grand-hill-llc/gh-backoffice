import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { Logo } from "../components/ui";
import UserMenu from "./UserMenu";
import { useT } from "../i18n";
import { NAV } from "../lib/roles";

export default function AppLayout() {
  const { profile, session, signOut } = useAuth();
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!profile) return null;

  const items = NAV.filter((i) => i.roles.includes(profile.role));
  const who = profile.full_name || session?.user.email || "";

  return (
    <div className="app gh">
      <div className="app-topbar gh-inverse">
        <Logo surface="inverse" height={28} />
        <button
          className="gh-btn gh-btn-secondary gh-btn-sm"
          type="button"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t.nav.close : t.nav.menu}
        </button>
      </div>

      <aside id="sidebar" className={`sidebar gh-inverse${open ? " is-open" : ""}`}>
        <div className="sidebar-top">
          <Logo surface="inverse" height={34} className="sidebar-mark" />
          <p className="gh-label sidebar-label">{t.common.backOffice}</p>
          <nav aria-label={t.nav.main}>
            <ul className="nav-list">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink to={item.to} className="nav-link" onClick={() => setOpen(false)}>
                    <span className="gh-square nav-dot" aria-hidden="true" />
                    {t.nav[item.key]}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <UserMenu name={who} role={t.roles[profile.role]} onSignOut={signOut} />
      </aside>

      <main className="app-main">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
