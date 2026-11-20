import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  MOVEMENT_COLUMNS,
  PROJECT_COLUMNS,
  PROJECT_STATUSES,
  PROJECT_SUB_COLUMNS,
  totalsOf,
  type Movement,
  type Project,
  type ProjectStatus,
} from "../../lib/projects";
import { formatMoney, formatPct } from "../../lib/sales";
import { formatDate } from "../../lib/subcontractors";
import DeleteZone from "../../components/DeleteZone";
import { Facts, NoteBlock, Panel } from "../../components/Panel";
import { AlertCircleIcon } from "../Icons";
import { CollectedBar } from "./projectTags";
import ProjectSubs, { type AssignmentRow, type SubOption } from "./ProjectSubs";
import ProjectMovements from "./ProjectMovements";
import { useT } from "../../i18n";

type Row = Project & { client: { id: string; name: string } | null; bid: { id: string; title: string } | null };

export default function ProjectDetail() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const [project, setProject] = useState<Row | null>(null);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [directory, setDirectory] = useState<SubOption[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Assignments and movements change together (a payment needs an assignment), so they reload as one. */
  const loadWork = useCallback(async () => {
    const [a, m] = await Promise.all([
      supabase.from("project_subs").select(`${PROJECT_SUB_COLUMNS}, sub:subcontractors(id, company_name)`).eq("project_id", id!).order("created_at"),
      supabase.from("project_movements").select(MOVEMENT_COLUMNS).eq("project_id", id!),
    ]);
    if (a.error || m.error) throw a.error ?? m.error;
    setAssignments((a.data ?? []) as unknown as AssignmentRow[]);
    setMovements((m.data ?? []) as Movement[]);
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, d] = await Promise.all([
          supabase.from("projects").select(`${PROJECT_COLUMNS}, client:clients(id, name), bid:bids(id, title)`).eq("id", id!).maybeSingle(),
          supabase.from("subcontractors").select("id, company_name, status").order("company_name"),
          loadWork(),
        ]);
        if (!active) return;
        if (p.error || d.error) return setState("error");
        if (!p.data) return setState("missing");
        setProject(p.data as unknown as Row);
        // Active subs first, the rest after: you can still assign a prospect if needed.
        const subs = (d.data ?? []) as SubOption[];
        setDirectory([...subs.filter((s) => s.status === "active"), ...subs.filter((s) => s.status !== "active")]);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [id, loadWork]);

  const reloadWork = async () => {
    try {
      await loadWork();
    } catch {
      /* keep what is on screen; the next action will surface the error */
    }
  };

  const changeStatus = async (status: ProjectStatus) => {
    if (!project || status === project.status) return;
    const previous = project.status;
    setProject({ ...project, status });
    setStatusBusy(true);
    setStatusMsg(null);
    const { error } = await supabase.from("projects").update({ status }).eq("id", project.id);
    setStatusBusy(false);
    if (error) {
      setProject((p) => (p ? { ...p, status: previous } : p));
      setStatusMsg({ ok: false, text: t.projects.statusSaveFailed });
    } else {
      setStatusMsg({ ok: true, text: t.projects.statusSaved });
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("projects").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      setDeleteError(t.projects.deleteFailed);
      return;
    }
    navigate("/proyectos", { replace: true });
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !project)
    return (
      <>
        <Link className="back-link" to="/proyectos">← {t.projects.title}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.projects.notFound : t.projects.loadOneFailed}</p>
        </div>
      </>
    );

  const totals = totalsOf(project, assignments, movements);
  const money = (v: number | null) => formatMoney(v, t.locale);
  const overBudget = totals.budget !== null && totals.spent > totals.budget;

  return (
    <>
      <Link className="back-link" to="/proyectos">← {t.projects.title}</Link>

      <header className="page-header detail-header">
        <div className="detail-title-row">
          <h1 className="gh-h2">{project.name}</h1>
          <div className="detail-actions">
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/proyectos/${project.id}/editar`}>{t.common.edit}</Link>
          </div>
        </div>
        <div className="detail-meta">
          {project.client ? (
            <Link className="meta-link" to={`/clientes/${project.client.id}`}>{project.client.name}</Link>
          ) : (
            <span className="gh-small gh-muted">{t.projects.noClient}</span>
          )}
          {project.bid && (
            <span className="gh-small gh-muted">
              {t.projects.fromBid}: <Link className="meta-link" to={`/bids/${project.bid.id}`}>{project.bid.title}</Link>
            </span>
          )}
        </div>
      </header>

      <section className="status-bar" aria-labelledby="project-status-label">
        <span className="gh-label" id="project-status-label">{t.projects.status}</span>
        <div className="segmented status-segmented" role="group" aria-labelledby="project-status-label">
          {PROJECT_STATUSES.map((s) => (
            <button key={s} type="button" aria-pressed={project.status === s} disabled={statusBusy} onClick={() => changeStatus(s)}>
              {t.projects.statuses[s]}
            </button>
          ))}
        </div>
        {statusMsg && (
          <p className={statusMsg.ok ? "gh-ok" : "gh-error"} role="status">
            {statusMsg.text}
          </p>
        )}
      </section>

      <div className="money-grid">
        <div className="money-card">
          <p className="gh-label">{t.projects.contract}</p>
          <p className="money-value">{money(totals.contract)}</p>
          <span className="money-sub">{t.projects.collected(money(totals.received))}</span>
          {totals.collectedShare !== null && <CollectedBar share={totals.collectedShare} />}
          {totals.toCollect !== null && totals.toCollect > 0 && <span className="money-sub">{t.projects.toCollect(money(totals.toCollect))}</span>}
          {totals.toCollect !== null && totals.toCollect < 0 && (
            <span className="due-note is-warning">{t.projects.overCollected(money(-totals.toCollect))}</span>
          )}
        </div>
        <div className="money-card">
          <p className="gh-label">{t.projects.budget}</p>
          <p className="money-value">{money(totals.budget)}</p>
          {totals.committed > 0 && <span className="money-sub">{t.projects.committed(money(totals.committed))}</span>}
        </div>
        <div className={`money-card${overBudget ? " is-negative" : ""}`}>
          <p className="gh-label">{t.projects.spent}</p>
          <p className="money-value">{money(totals.spent)}</p>
          {totals.owedToSubs > 0 && <span className="money-sub">{t.projects.owedToSubs(money(totals.owedToSubs))}</span>}
          {overBudget && <span className="due-note is-danger">{t.projects.overBudget}</span>}
        </div>
        <div className={`money-card${totals.plannedMargin && totals.plannedMargin.amount < 0 ? " is-negative" : ""}`}>
          <p className="gh-label">{t.projects.plannedMargin}</p>
          <p className="money-value">{totals.plannedMargin ? money(totals.plannedMargin.amount) : "—"}</p>
          {totals.plannedMargin && totals.plannedMargin.pct !== null && (
            <span className="money-sub">{formatPct(totals.plannedMargin.pct, t.locale)}</span>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <Panel title={t.projects.details}>
          <Facts
            completeHref={`/proyectos/${project.id}/editar`}
            items={[
              { label: t.projects.location, value: project.location },
              { label: t.projects.startDate, value: project.start_date ? formatDate(project.start_date, t.locale) : null },
              { label: t.projects.endDate, value: project.end_date ? formatDate(project.end_date, t.locale) : null },
              { label: t.projects.createdOn, value: formatDate(project.created_at, t.locale) },
            ]}
          />
          {project.notes && <NoteBlock title={t.projects.notes} text={project.notes} />}
        </Panel>

        <ProjectSubs projectId={project.id} assignments={assignments} movements={movements} directory={directory} onChange={reloadWork} />
      </div>

      <div className="detail-stack">
        <ProjectMovements projectId={project.id} movements={movements} assignments={assignments} onChange={reloadWork} />
      </div>

      <DeleteZone
        label={t.projects.deleteProject}
        message={t.projects.deleteConfirm(project.name, movements.length)}
        confirmLabel={t.projects.deleteForever}
        busyLabel={t.projects.deleting}
        cancelLabel={t.common.cancel}
        error={deleteError}
        busy={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
