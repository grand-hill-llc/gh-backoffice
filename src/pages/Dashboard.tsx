import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { ACTIVE_STATUSES, totalsOf, type Movement, type Project, type ProjectSub } from "../lib/projects";
import { formatMoney, formatPct, OPEN_STATUSES, PRE_SUBMIT, urgencyOf, type Bid } from "../lib/sales";
import { complianceOf, formatDate, REQUIRED_DOCS, todayISO, type ComplianceLevel, type DocType } from "../lib/subcontractors";
import { PageHeader, Tag, type TagTone } from "../components/ui";
import { Panel } from "../components/Panel";
import { AlertCircleIcon } from "./Icons";
import { DueNote } from "./bids/bidTags";
import { CollectedBar } from "./projects/projectTags";
import { FOLLOW_UP_SOON_DAYS, OPEN_LEAD_STATUSES, addDays, ownerName, type Lead, type Owner } from "../lib/leads";
import { FollowUpNote } from "./leads/leadShared";
import { useT } from "../i18n";

const LIST_LIMIT = 6;
const isMissingTable = (msg: string) => /schema cache|does not exist|relation/i.test(msg);

type BidRow = Pick<Bid, "id" | "title" | "status" | "due_date" | "our_price"> & { client: { name: string } | null };
type DocIssue = { subId: string; company: string; docType: DocType; level: Exclude<ComplianceLevel, "ok">; date: string | null };
type Pipeline = { openBids: BidRow[]; docIssues: DocIssue[]; subsWithIssues: number };

type ProjectRow = Pick<Project, "id" | "name" | "status" | "contract_amount" | "budgeted_cost"> & { client: { name: string } | null };
type ActiveProject = ProjectRow & { received: number; toCollect: number | null; collectedShare: number | null };
type Work = { active: ActiveProject[]; openProjects: number; toCollect: number; owedToSubs: number };

/** Open bids, and the required-document problems of the subs Grand Hill works with (active or prequalified).
 *  Uses the same rule as the subcontractors list: a renewed document supersedes the old one. */
async function loadPipeline(): Promise<Pipeline> {
  const [bids, subs, docs] = await Promise.all([
    supabase.from("bids").select("id, title, status, due_date, our_price, client:clients(name)").in("status", OPEN_STATUSES),
    supabase.from("subcontractors").select("id, company_name, status").in("status", ["active", "prequalified"]),
    supabase.from("v_sub_documents_status").select("subcontractor_id, doc_type, expires_on"),
  ]);
  const err = bids.error ?? subs.error ?? docs.error;
  if (err) throw err;

  const allDocs = (docs.data ?? []) as { subcontractor_id: string; doc_type: DocType; expires_on: string | null }[];
  const docIssues: DocIssue[] = [];
  const affected = new Set<string>();
  for (const s of (subs.data ?? []) as { id: string; company_name: string }[]) {
    const own = allDocs.filter((d) => d.subcontractor_id === s.id);
    const c = complianceOf(own);
    for (const type of REQUIRED_DOCS) {
      const level = c.byType[type];
      if (level === "ok") continue;
      const dates = own.filter((d) => d.doc_type === type && d.expires_on).map((d) => d.expires_on as string).sort();
      docIssues.push({ subId: s.id, company: s.company_name, docType: type, level, date: dates[dates.length - 1] ?? null });
      affected.add(s.id);
    }
  }
  // Most urgent first: expired, then missing, then expiring (soonest first).
  const rank: Record<DocIssue["level"], number> = { expired: 0, missing: 1, expiring: 2 };
  docIssues.sort((a, b) => rank[a.level] - rank[b.level] || (a.date ?? "").localeCompare(b.date ?? "") || a.company.localeCompare(b.company));

  return { openBids: (bids.data ?? []) as unknown as BidRow[], docIssues, subsWithIssues: affected.size };
}

type FollowUpRow = Pick<Lead, "id" | "name" | "company" | "status" | "next_follow_up" | "owner_id">;
type FollowUps = { rows: FollowUpRow[]; owners: Owner[] };

/** Open leads whose next follow-up is overdue or within the next few days. */
async function loadFollowUps(): Promise<FollowUps> {
  const [l, o] = await Promise.all([
    supabase
      .from("leads")
      .select("id, name, company, status, next_follow_up, owner_id")
      .in("status", OPEN_LEAD_STATUSES)
      .lte("next_follow_up", addDays(todayISO(), FOLLOW_UP_SOON_DAYS))
      .order("next_follow_up"),
    supabase.from("profiles").select("id, full_name, email").in("role", ["super_admin", "admin"]),
  ]);
  const err = l.error ?? o.error;
  if (err) throw err;
  return { rows: (l.data ?? []) as FollowUpRow[], owners: (o.data ?? []) as Owner[] };
}

/** Projects that aren't closed: what is left to collect from clients and to pay to subs. */
async function loadWork(): Promise<Work> {
  const [p, a, m] = await Promise.all([
    supabase.from("projects").select("id, name, status, contract_amount, budgeted_cost, client:clients(name)").neq("status", "closed"),
    supabase.from("project_subs").select("id, project_id, agreed_amount"),
    supabase.from("project_movements").select("project_id, kind, amount, project_sub_id"),
  ]);
  const err = p.error ?? a.error ?? m.error;
  if (err) throw err;

  const projects = (p.data ?? []) as unknown as ProjectRow[];
  const assignments = (a.data ?? []) as Pick<ProjectSub, "id" | "project_id" | "agreed_amount">[];
  const movements = (m.data ?? []) as Pick<Movement, "project_id" | "kind" | "amount" | "project_sub_id">[];

  let toCollect = 0;
  let owedToSubs = 0;
  const active: ActiveProject[] = [];
  for (const pr of projects) {
    const totals = totalsOf(
      pr,
      assignments.filter((x) => x.project_id === pr.id),
      movements.filter((x) => x.project_id === pr.id)
    );
    toCollect += Math.max(0, totals.toCollect ?? 0);
    owedToSubs += totals.owedToSubs;
    if (ACTIVE_STATUSES.includes(pr.status)) {
      active.push({ ...pr, received: totals.received, toCollect: totals.toCollect, collectedShare: totals.collectedShare });
    }
  }
  // Biggest balance first: that's where attention pays off.
  active.sort((x, y) => (y.toCollect ?? -1) - (x.toCollect ?? -1));
  return { active, openProjects: projects.length, toCollect, owedToSubs };
}

type LoadState = "loading" | "ready" | "missing" | "failed";

export default function Dashboard() {
  const t = useT();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [pipelineState, setPipelineState] = useState<LoadState>("loading");
  const [work, setWork] = useState<Work | null>(null);
  const [workState, setWorkState] = useState<LoadState>("loading");
  const [followUps, setFollowUps] = useState<FollowUps | null>(null);
  const [followUpsState, setFollowUpsState] = useState<LoadState>("loading");

  useEffect(() => {
    let active = true;
    const fail = (set: (s: LoadState) => void) => (e: { message?: string }) => {
      if (active) set(isMissingTable(e?.message ?? "") ? "missing" : "failed");
    };
    // Loaded separately: a missing projects migration shouldn't hide bids and documents.
    loadPipeline()
      .then((p) => {
        if (!active) return;
        setPipeline(p);
        setPipelineState("ready");
      })
      .catch(fail(setPipelineState));
    loadWork()
      .then((w) => {
        if (!active) return;
        setWork(w);
        setWorkState("ready");
      })
      .catch(fail(setWorkState));
    loadFollowUps()
      .then((f) => {
        if (!active) return;
        setFollowUps(f);
        setFollowUpsState("ready");
      })
      .catch(fail(setFollowUpsState));
    return () => {
      active = false;
    };
  }, []);

  const today = todayISO();
  const money = (v: number) => formatMoney(v, t.locale);

  const quoted = pipeline?.openBids.reduce((s, b) => s + Number(b.our_price ?? 0), 0) ?? 0;
  // Bids Grand Hill still has to send: dated ones by due date, undated last.
  const toDeliver = (pipeline?.openBids ?? [])
    .filter((b) => PRE_SUBMIT.includes(b.status))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));

  return (
    <>
      <PageHeader eyebrow={t.common.backOffice} title={t.dashboard.title} description={t.dashboard.description} />

      {pipelineState === "missing" || pipelineState === "failed" ? (
        <Notice tone="error">{pipelineState === "missing" ? t.dashboard.missingMigration : t.dashboard.loadFailed}</Notice>
      ) : null}

      <div className="kpi-grid">
        <Kpi
          to="/proyectos"
          label={t.dashboard.toCollect}
          value={work ? money(work.toCollect) : null}
          note={work ? t.dashboard.toCollectNote(work.openProjects) : null}
          money
        />
        <Kpi to="/proyectos" label={t.dashboard.owedToSubs} value={work ? money(work.owedToSubs) : null} note={t.dashboard.owedToSubsNote} money />
        <Kpi
          to="/bids"
          label={t.dashboard.openBids}
          value={pipeline ? String(pipeline.openBids.length) : null}
          note={pipeline ? (quoted > 0 ? t.dashboard.openBidsNote(money(quoted)) : t.dashboard.openBidsNoteEmpty) : null}
        />
        <Kpi
          to="/subcontratistas"
          label={t.dashboard.docsAttention}
          value={pipeline ? String(pipeline.docIssues.length) : null}
          note={pipeline ? (pipeline.docIssues.length ? t.dashboard.docsAttentionNote(pipeline.subsWithIssues) : t.dashboard.docsAttentionNoteEmpty) : null}
          alert={!!pipeline && pipeline.docIssues.some((d) => d.level === "expired" || d.level === "missing")}
        />
      </div>

      <div className="detail-grid dashboard-grid">
        <Panel title={t.dashboard.followUps} action={<SeeAll to="/leads" />}>
          {followUpsState === "missing" ? (
            <p className="panel-empty">{t.dashboard.followUpsMissing}</p>
          ) : !followUps ? (
            <Loading state={followUpsState} />
          ) : followUps.rows.length === 0 ? (
            <p className="panel-empty">{t.dashboard.followUpsEmpty}</p>
          ) : (
            <ul className="dash-list">
              {followUps.rows.slice(0, LIST_LIMIT).map((l) => (
                <li key={l.id} className="dash-item">
                  <div className="dash-main">
                    <Link className="row-link" to={`/leads/${l.id}`}>{l.name}</Link>
                    <span className="cell-sub">
                      {[l.company, l.owner_id ? ownerName(followUps.owners.find((o) => o.id === l.owner_id)) : t.leads.unassigned]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <div className="dash-side">
                    <span className="dash-date">{l.next_follow_up ? formatDate(l.next_follow_up, t.locale) : ""}</span>
                    <FollowUpNote lead={l} today={today} />
                  </div>
                </li>
              ))}
              <More count={followUps.rows.length - LIST_LIMIT} />
            </ul>
          )}
        </Panel>

        <Panel title={t.dashboard.bidsDue} action={<SeeAll to="/bids" />}>
          {!pipeline ? (
            <Loading state={pipelineState} />
          ) : toDeliver.length === 0 ? (
            <p className="panel-empty">{t.dashboard.bidsDueEmpty}</p>
          ) : (
            <ul className="dash-list">
              {toDeliver.slice(0, LIST_LIMIT).map((b) => {
                const { urgency } = urgencyOf(b, today);
                return (
                  <li key={b.id} className={`dash-item${urgency === "overdue" || urgency === "today" ? " is-urgent" : ""}`}>
                    <div className="dash-main">
                      <Link className="row-link" to={`/bids/${b.id}`}>{b.title}</Link>
                      <span className="cell-sub">{b.client?.name ?? t.sales.noClient}</span>
                    </div>
                    <div className="dash-side">
                      <span className="dash-date">{b.due_date ? formatDate(b.due_date, t.locale) : t.dashboard.noDueDate}</span>
                      <DueNote bid={b} today={today} />
                    </div>
                  </li>
                );
              })}
              <More count={toDeliver.length - LIST_LIMIT} />
            </ul>
          )}
        </Panel>

        <Panel title={t.dashboard.docsList} action={<SeeAll to="/subcontratistas" />}>
          {!pipeline ? (
            <Loading state={pipelineState} />
          ) : pipeline.docIssues.length === 0 ? (
            <p className="panel-empty">{t.dashboard.docsListEmpty}</p>
          ) : (
            <ul className="dash-list">
              {pipeline.docIssues.slice(0, LIST_LIMIT).map((d) => (
                <li key={`${d.subId}-${d.docType}`} className="dash-item">
                  <div className="dash-main">
                    <Link className="row-link" to={`/subcontratistas/${d.subId}`}>{d.company}</Link>
                    <span className="cell-sub">
                      {t.subs.docTypes[d.docType]}
                      {d.date && ` · ${d.level === "expired" ? t.dashboard.expiredOn(formatDate(d.date, t.locale)) : t.dashboard.expiresOn(formatDate(d.date, t.locale))}`}
                    </span>
                  </div>
                  <div className="dash-side">
                    <Tag tone={DOC_TONE[d.level]}>{t.subs.docState[d.level]}</Tag>
                  </div>
                </li>
              ))}
              <More count={pipeline.docIssues.length - LIST_LIMIT} />
            </ul>
          )}
        </Panel>

        <Panel title={t.dashboard.activeProjects} action={<SeeAll to="/proyectos" />}>
          {workState === "missing" ? (
            <p className="panel-empty">{t.dashboard.projectsMissing}</p>
          ) : !work ? (
            <Loading state={workState} />
          ) : work.active.length === 0 ? (
            <p className="panel-empty">{t.dashboard.activeProjectsEmpty}</p>
          ) : (
            <div className="table-wrap is-flush">
              <table className="gh-table movements-table">
                <thead>
                  <tr>
                    <th scope="col">{t.dashboard.colProject}</th>
                    <th scope="col" className="num">{t.dashboard.colToCollect}</th>
                  </tr>
                </thead>
                <tbody>
                  {work.active.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link className="row-link" to={`/proyectos/${p.id}`}>{p.name}</Link>
                        <span className="cell-sub">{p.client?.name ?? t.projects.noClient}</span>
                        {p.collectedShare !== null && (
                          <span className="collected-cell">
                            <CollectedBar share={p.collectedShare} />
                            <span className="gh-small gh-muted">{t.projects.collected(formatPct(p.collectedShare, t.locale))}</span>
                          </span>
                        )}
                      </td>
                      <td className="num">{p.toCollect !== null ? money(Math.max(0, p.toCollect)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

const DOC_TONE: Record<DocIssue["level"], TagTone> = { expired: "danger", missing: "danger", expiring: "warning" };

function Kpi({
  to,
  label,
  value,
  note,
  money,
  alert,
}: {
  to: string;
  label: string;
  value: string | null;
  note: string | null;
  money?: boolean;
  alert?: boolean;
}) {
  return (
    <Link to={to} className={`kpi${alert ? " is-alert" : ""}`}>
      <p className="gh-label">{label}</p>
      <p className={`kpi-value${money ? " is-money" : ""}`} aria-live="polite">{value ?? "—"}</p>
      <p className="gh-small gh-muted">{note ?? " "}</p>
    </Link>
  );
}

function SeeAll({ to }: { to: string }) {
  const t = useT();
  return <Link className="panel-link" to={to}>{t.dashboard.seeAll}</Link>;
}

function More({ count }: { count: number }) {
  const t = useT();
  return count > 0 ? <li className="dash-more gh-small gh-muted">{t.dashboard.more(count)}</li> : null;
}

function Loading({ state }: { state: LoadState }) {
  const t = useT();
  if (state === "failed") return <p className="panel-empty">{t.dashboard.loadFailed}</p>;
  return <p className="panel-empty" role="status">{t.common.loading}</p>;
}

function Notice({ tone, children }: { tone: "error"; children: ReactNode }) {
  return (
    <div className={`gh-notice is-${tone}`} role="alert" style={{ marginBottom: "var(--space-4)" }}>
      <AlertCircleIcon />
      <p>{children}</p>
    </div>
  );
}
