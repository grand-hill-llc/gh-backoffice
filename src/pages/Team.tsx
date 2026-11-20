import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { ROLE_LABEL, type Role } from "../lib/roles";
import { EmptyState, PageHeader } from "../components/ui";

type Row = { id: string; full_name: string | null; email: string | null; role: Role };

/** Read-only list of who has access. Roles are changed in Supabase until an editor is built. */
export default function Team() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("profiles")
      .select("id, full_name, email, role")
      .order("role")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setFailed(true);
        else setRows((data as Row[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHeader eyebrow="Administración" title="Equipo" description="Quién tiene acceso al sistema y con qué rol." />
      {failed ? (
        <EmptyState title="No pudimos cargar el equipo">Inténtalo de nuevo en unos minutos.</EmptyState>
      ) : !rows ? (
        <p className="gh-muted" role="status">Cargando…</p>
      ) : (
        <div className="table-wrap">
          <table className="gh-table">
            <thead>
              <tr>
                <th scope="col">Nombre</th>
                <th scope="col">Correo</th>
                <th scope="col">Rol</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.full_name ?? "—"}</td>
                  <td>{r.email ?? "—"}</td>
                  <td>{ROLE_LABEL[r.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="gh-small gh-muted" style={{ marginTop: "var(--space-3)" }}>
        Para agregar a alguien, crea su usuario en Supabase (Authentication &gt; Users) y asígnale el rol con SQL. Un editor de roles llegará después.
      </p>
    </>
  );
}
