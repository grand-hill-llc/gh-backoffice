export type Role = "super_admin" | "admin" | "subcontractor";

export const STAFF: Role[] = ["super_admin", "admin"];

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  subcontractor: "Subcontratista",
};

export type NavItem = { to: string; label: string; roles: Role[] };

/** Sidebar entries. Visibility here is convenience only: the database (RLS) is what enforces access. */
export const NAV: NavItem[] = [
  { to: "/dashboard", label: "Resumen", roles: STAFF },
  { to: "/bids", label: "Bids", roles: STAFF },
  { to: "/clientes", label: "Clientes", roles: STAFF },
  { to: "/subcontratistas", label: "Subcontratistas", roles: STAFF },
  { to: "/proyectos", label: "Proyectos", roles: STAFF },
  { to: "/equipo", label: "Equipo", roles: ["super_admin"] },
  { to: "/portal", label: "Mi empresa", roles: ["subcontractor"] },
];

export function homeFor(role: Role): string {
  return role === "subcontractor" ? "/portal" : "/dashboard";
}
