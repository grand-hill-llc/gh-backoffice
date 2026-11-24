import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { ACTIVE_STATUSES, PROJECT_COLUMNS, totalsOf, withChangeOrders, type ChangeOrder, type Movement, type Project, type ProjectStatus } from "../../lib/projects";
import { formatMoney, formatPct } from "../../lib/sales";
import { EmptyState, PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { CollectedBar, ProjectStatusTag } from "./projectTags";
import { useT } from "../../i18n";

type View = "active" | "completed" | "closed" | "all";
const VIEWS: View[] = ["active", "completed", "closed", "all"];
const IN_VIEW: Record<View, (s: ProjectStatus) => boolean> = {
  active: (s) => ACTIVE_STATUSES.includes(s),
  completed: (s) => s === "completed",
  closed: (s) => s === "closed",
  all: () => true,
};

type Row = Project & { client: { name: string } | null };

export default function ProjectList() {
  const t = useT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [received, setReceived] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<"none" | "missing" | "failed">("none");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("active");

  useEffect(() => {
    let active = true;
    (async () => {
      const [p, m, c] = await Promise.all([
        supabase.from("projects").select(`${PROJECT_COLUMNS}, client:clients(name)`).order("created_at", { ascending: false }),
        supabase.from("project_movements").select("project_id, kind, amount").eq("kind", "receipt"),
        supabase.from("change_orders").select("project_id, status, contract_delta, cost_delta, project_sub_id, sub_delta").eq("status", "approved"),
      ]);
      if (!active) return;
      const err = p.error ?? m.error ?? c.error;
      if (err) {
        setError(/schema cache|does not exist|relation/i.test(err.message) ? "missing" : "failed");
        return;
      }
      const byProject = new Map<string, number>();
      for (const mv of (m.data ?? []) as Pick<Movement, "project_id" | "amount">[]) {
        byProject.set(mv.project_id, (byProject.get(mv.project_id) ?? 0) + Number(mv.amount));
      }
      setReceived(byProject);
      // Contract and margin as they stand today: originals plus approved change orders.
      const orders = (c.data ?? []) as Pick<ChangeOrder, "project_id" | "status" | "contract_delta" | "cost_delta" | "project_sub_id" | "sub_delta">[];
      setRows(((p.data ?? []) as unknown as Row[]).map((r) => withChangeOrders(r, orders)));
    })();
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<View, number> = { active: 0, completed: 0, closed: 0, all: 0 };
    for (const r of rows ?? []) for (const v of VIEWS) if (IN_VIEW[v](r.status)) c[v] += 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => IN_VIEW[view](r.status))
      .filter((r) => !q || [r.name, r.client?.name, r.location].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q)));
  }, [rows, query, view]);

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.projects.eyebrow} title={t.projects.title} description={t.projects.description} />
        <Link className="gh-btn gh-btn-primary" to="/proyectos/nuevo">
          {t.projects.newProject}
        </Link>
      </div>

      {error !== "none" ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error === "missing" ? t.projects.missingTable : t.projects.loadFailed}</p>
        </div>
      ) : !rows ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={t.projects.emptyTitle}>{t.projects.emptyBody}</EmptyState>
      ) : (
        <>
          <div className="view-tabs" role="tablist" aria-label={t.projects.title}>
            {VIEWS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className="view-tab" onClick={() => setView(v)}>
                {t.projects.views[v]} <span className="view-count">{counts[v]}</span>
              </button>
            ))}
          </div>

          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="project-search">{t.projects.search}</label>
              <input
                id="project-search"
                className="gh-input"
                type="search"
                placeholder={t.projects.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">{t.projects.count(filtered.length)}</p>

          {filtered.length === 0 ? (
            <EmptyState title={t.projects.noMatchTitle}>{t.projects.noMatchBody}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">{t.projects.colName}</th>
                    <th scope="col">{t.projects.colClient}</th>
                    <th scope="col">{t.projects.colStatus}</th>
                    <th scope="col" className="num">{t.projects.colContract}</th>
                    <th scope="col" className="num">{t.projects.colCollected}</th>
                    <th scope="col" className="num">{t.projects.colMargin}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => {
                    const totals = totalsOf(p, [], [{ kind: "receipt", amount: received.get(p.id) ?? 0, project_sub_id: null }]);
                    return (
                      <tr key={p.id} onClick={() => navigate(`/proyectos/${p.id}`)}>
                        <td className="col-company">
                          <Link className="row-link" to={`/proyectos/${p.id}`} onClick={(e) => e.stopPropagation()}>
                            {p.name}
                          </Link>
                          {p.location && <span className="cell-sub">{p.location}</span>}
                        </td>
                        <td className={p.client ? "" : "cell-muted"}>{p.client?.name ?? t.projects.noClient}</td>
                        <td><ProjectStatusTag status={p.status} /></td>
                        <td className="num">{formatMoney(p.contract_amount, t.locale)}</td>
                        <td className="num">
                          {formatMoney(totals.received, t.locale)}
                          {totals.collectedShare !== null && (
                            <span className="cell-sub">
                              <CollectedBar share={totals.collectedShare} /> {formatPct(totals.collectedShare, t.locale)}
                            </span>
                          )}
                        </td>
                        <td className={`num${totals.plannedMargin && totals.plannedMargin.amount < 0 ? " is-negative" : ""}`}>
                          {totals.plannedMargin ? formatPct(totals.plannedMargin.pct, t.locale) : "—"}
                          {totals.plannedMargin && <span className="cell-sub">{formatMoney(totals.plannedMargin.amount, t.locale)}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
