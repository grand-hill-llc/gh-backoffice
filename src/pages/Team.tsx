import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { type Role } from "../lib/roles";
import { useT } from "../i18n";
import { EmptyState, PageHeader } from "../components/ui";

type Row = { id: string; full_name: string | null; email: string | null; role: Role };

/** Read-only list of who has access. Roles are changed in Supabase until an editor is built. */
export default function Team() {
  const t = useT();
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
      <PageHeader eyebrow={t.team.eyebrow} title={t.nav.team} description={t.team.description} />
      {failed ? (
        <EmptyState title={t.team.loadFailedTitle}>{t.team.loadFailedBody}</EmptyState>
      ) : !rows ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : (
        <div className="table-wrap">
          <table className="gh-table">
            <thead>
              <tr>
                <th scope="col">{t.team.name}</th>
                <th scope="col">{t.team.email}</th>
                <th scope="col">{t.team.role}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.full_name ?? "—"}</td>
                  <td>{r.email ?? "—"}</td>
                  <td>{t.roles[r.role]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="gh-small gh-muted" style={{ marginTop: "var(--space-3)" }}>
        {t.team.howToAdd}
      </p>
    </>
  );
}
