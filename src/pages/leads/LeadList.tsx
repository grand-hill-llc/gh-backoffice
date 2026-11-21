import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { LEAD_COLUMNS, OPEN_LEAD_STATUSES, ownerName, relativeTime, type Lead, type LeadStatus } from "../../lib/leads";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { useAuth } from "../../auth/AuthProvider";
import { EmptyState, PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { FollowUpNote, LeadStatusTag, SourceLabel, useOwners } from "./leadShared";
import { useT } from "../../i18n";

type View = "open" | "converted" | "lost" | "all";
const VIEWS: View[] = ["open", "converted", "lost", "all"];
const IN_VIEW: Record<View, (s: LeadStatus) => boolean> = {
  open: (s) => OPEN_LEAD_STATUSES.includes(s),
  converted: (s) => s === "converted",
  lost: (s) => s === "lost",
  all: () => true,
};

/** Open leads by next follow-up (overdue first, undated last); the rest newest first. */
function sortFor(view: View) {
  return (a: Lead, b: Lead) => {
    if (view === "open") return (a.next_follow_up ?? "9999").localeCompare(b.next_follow_up ?? "9999") || b.created_at.localeCompare(a.created_at);
    return b.updated_at.localeCompare(a.updated_at);
  };
}

export default function LeadList() {
  const t = useT();
  const navigate = useNavigate();
  const { session } = useAuth();
  const owners = useOwners();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [lastActivity, setLastActivity] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<"none" | "missing" | "failed">("none");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("open");
  const [owner, setOwner] = useState<string>("all");

  useEffect(() => {
    let active = true;
    (async () => {
      const [l, a] = await Promise.all([
        supabase.from("leads").select(LEAD_COLUMNS),
        supabase.from("lead_activities").select("lead_id, occurred_at"),
      ]);
      if (!active) return;
      const err = l.error ?? a.error;
      if (err) return setError(/schema cache|does not exist|relation/i.test(err.message) ? "missing" : "failed");
      const last = new Map<string, string>();
      for (const x of (a.data ?? []) as { lead_id: string; occurred_at: string }[]) {
        if ((last.get(x.lead_id) ?? "") < x.occurred_at) last.set(x.lead_id, x.occurred_at);
      }
      setLastActivity(last);
      setLeads((l.data ?? []) as Lead[]);
    })();
    return () => {
      active = false;
    };
  }, []);

  const myId = session?.user.id ?? null;
  const ownerMatch = (l: Lead) => owner === "all" || (owner === "mine" ? l.owner_id === myId : l.owner_id === owner);

  const counts = useMemo(() => {
    const c: Record<View, number> = { open: 0, converted: 0, lost: 0, all: 0 };
    for (const l of leads ?? []) if (ownerMatch(l)) for (const v of VIEWS) if (IN_VIEW[v](l.status)) c[v] += 1;
    return c;
  }, [leads, owner, myId]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = query.trim().toLowerCase();
    return leads
      .filter((l) => IN_VIEW[view](l.status) && ownerMatch(l))
      .filter((l) => !q || [l.name, l.company, l.email, l.phone].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q)))
      .sort(sortFor(view));
  }, [leads, query, view, owner, myId]);

  const today = todayISO();

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.leads.eyebrow} title={t.leads.title} description={t.leads.description} />
        <Link className="gh-btn gh-btn-primary" to="/leads/nuevo">
          {t.leads.newLead}
        </Link>
      </div>

      {error !== "none" ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error === "missing" ? t.leads.missingTable : t.leads.loadFailed}</p>
        </div>
      ) : !leads ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : leads.length === 0 ? (
        <EmptyState title={t.leads.emptyTitle}>{t.leads.emptyBody}</EmptyState>
      ) : (
        <>
          <div className="view-tabs" role="tablist" aria-label={t.leads.title}>
            {VIEWS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className="view-tab" onClick={() => setView(v)}>
                {t.leads.views[v]} <span className="view-count">{counts[v]}</span>
              </button>
            ))}
          </div>

          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="lead-search">{t.leads.search}</label>
              <input
                id="lead-search"
                className="gh-input"
                type="search"
                placeholder={t.leads.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="lead-owner">{t.leads.owner}</label>
              <select id="lead-owner" className="gh-input gh-select" value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="all">{t.leads.allOwners}</option>
                <option value="mine">{t.leads.mine}</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{ownerName(o)}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">{t.leads.count(filtered.length)}</p>

          {filtered.length === 0 ? (
            <EmptyState title={t.leads.noMatchTitle}>{t.leads.noMatchBody}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">{t.leads.colContact}</th>
                    <th scope="col">{t.leads.colStatus}</th>
                    <th scope="col">{t.leads.colOwner}</th>
                    <th scope="col">{t.leads.colFollowUp}</th>
                    <th scope="col">{t.leads.colLastActivity}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const last = lastActivity.get(l.id);
                    return (
                      <tr key={l.id} onClick={() => navigate(`/leads/${l.id}`)}>
                        <td className="col-company">
                          <Link className="row-link" to={`/leads/${l.id}`} onClick={(e) => e.stopPropagation()}>
                            {l.name}
                          </Link>
                          <span className="cell-sub">
                            {l.company && `${l.company} · `}
                            <SourceLabel source={l.source} />
                          </span>
                        </td>
                        <td><LeadStatusTag status={l.status} /></td>
                        <td className={l.owner_id ? "" : "cell-muted"}>
                          {l.owner_id ? ownerName(owners.find((o) => o.id === l.owner_id)) : t.leads.unassigned}
                        </td>
                        <td className="nowrap">
                          {l.next_follow_up ? formatDate(l.next_follow_up, t.locale) : <span className="gh-muted">—</span>}
                          <FollowUpNote lead={l} today={today} />
                        </td>
                        <td className="cell-muted nowrap">{last ? relativeTime(last, t.locale) : t.leads.noActivity}</td>
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
