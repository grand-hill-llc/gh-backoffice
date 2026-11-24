export type Role = "super_admin" | "admin" | "subcontractor";

export const STAFF: Role[] = ["super_admin", "admin"];

export type NavKey = "dashboard" | "leads" | "bids" | "clients" | "subcontractors" | "projects" | "team" | "settings" | "portal";
export type NavItem = { to: string; key: NavKey; roles: Role[] };

/** Sidebar entries (labels in i18n nav.*). Visibility here is convenience only: the database (RLS) is what enforces access. */
export const NAV: NavItem[] = [
  { to: "/dashboard", key: "dashboard", roles: STAFF },
  { to: "/leads", key: "leads", roles: STAFF },
  { to: "/bids", key: "bids", roles: STAFF },
  { to: "/clientes", key: "clients", roles: STAFF },
  { to: "/subcontratistas", key: "subcontractors", roles: STAFF },
  { to: "/proyectos", key: "projects", roles: STAFF },
  { to: "/equipo", key: "team", roles: ["super_admin"] },
  { to: "/configuracion", key: "settings", roles: ["super_admin"] },
  { to: "/portal", key: "portal", roles: ["subcontractor"] },
];

export function homeFor(role: Role): string {
  return role === "subcontractor" ? "/portal" : "/dashboard";
}
