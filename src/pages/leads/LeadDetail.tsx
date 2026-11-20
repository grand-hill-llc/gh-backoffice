import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  ACTIVITY_COLUMNS,
  addDays,
  LEAD_COLUMNS,
  ownerName,
  PICKABLE_STATUSES,
  whatsappHref,
  type Lead,
  type LeadActivity,
  type LeadStatus,
} from "../../lib/leads";
import { formatDate, todayISO } from "../../lib/subcontractors";
import DeleteZone from "../../components/DeleteZone";
import { Facts, mailHref, NoteBlock, Panel, telHref } from "../../components/Panel";
import { AlertCircleIcon } from "../Icons";
import LeadActivityPanel from "./LeadActivityPanel";
import { FollowUpNote, LeadStatusTag, SourceLabel, useOwners } from "./leadShared";
import { useT } from "../../i18n";

type Msg = { ok: boolean; text: string } | null;

export default function LeadDetail() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const owners = useOwners();
  const [lead, setLead] = useState<Lead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [lostReason, setLostReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [l, a] = await Promise.all([
        supabase.from("leads").select(LEAD_COLUMNS).eq("id", id!).maybeSingle(),
        supabase.from("lead_activities").select(ACTIVITY_COLUMNS).eq("lead_id", id!),
      ]);
      if (!active) return;
      if (l.error || a.error) return setState("error");
      if (!l.data) return setState("missing");
      const ld = l.data as Lead;
      setLead(ld);
      setLostReason(ld.lost_reason ?? "");
      setActivities((a.data ?? []) as LeadActivity[]);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [id]);

  /** Saves part of the lead, showing it at once and rolling back if the database refuses. */
  const patch = async (change: Partial<Lead>, okText: string, failText: string) => {
    if (!lead) return false;
    const previous = lead;
    setLead({ ...lead, ...change });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("leads").update(change).eq("id", lead.id);
    setBusy(false);
    if (error) {
      setLead(previous);
      setMsg({ ok: false, text: failText });
      return false;
    }
    setMsg({ ok: true, text: okText });
    return true;
  };

  const setStatus = (status: LeadStatus) => {
    if (!lead || status === lead.status) return;
    // A lead that is no longer open doesn't need a follow-up date.
    const change: Partial<Lead> = status === "lost" ? { status, next_follow_up: null } : { status };
    patch(change, t.leads.stageSaved, t.leads.stageFailed);
  };

  const setFollowUp = (date: string | null) => patch({ next_follow_up: date }, t.leads.followUpSaved, t.leads.followUpFailed);

  const onActivityAdded = async (row: LeadActivity, next: string | null) => {
    setActivities((list) => [...list, row]);
    if (!lead) return;
    const change: Partial<Lead> = {};
    // Talking to a new lead means it has been contacted.
    if (lead.status === "new" && row.kind !== "note") change.status = "contacted";
    if (next) change.next_follow_up = next;
    if (Object.keys(change).length) {
      await patch(change, change.status ? t.leads.autoContacted : t.leads.followUpSaved, t.leads.followUpFailed);
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("leads").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      setDeleteError(t.leads.deleteFailed);
      return;
    }
    navigate("/leads", { replace: true });
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !lead)
    return (
      <>
        <Link className="back-link" to="/leads">← {t.leads.title}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.leads.notFound : t.leads.loadOneFailed}</p>
        </div>
      </>
    );

  const today = todayISO();
  const owner = owners.find((o) => o.id === lead.owner_id);
  const isOpen = lead.status !== "converted" && lead.status !== "lost";
  const wa = whatsappHref(lead.phone);

  return (
    <>
      <Link className="back-link" to="/leads">← {t.leads.title}</Link>

      <header className="page-header detail-header">
        <div className="detail-title-row">
          <h1 className="gh-h2">{lead.name}</h1>
          <div className="detail-actions">
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/leads/${lead.id}/editar`}>{t.common.edit}</Link>
          </div>
        </div>
        <div className="detail-meta">
          {lead.company && <span className="gh-small">{lead.company}</span>}
          <span className="gh-small gh-muted"><SourceLabel source={lead.source} /></span>
          <span className="gh-small gh-muted">
            {t.leads.owner}: {lead.owner_id ? ownerName(owner) : t.leads.unassigned}
          </span>
        </div>
      </header>

      {lead.status === "converted" ? (
        <section className="status-bar">
          <LeadStatusTag status="converted" />
          <span className="gh-small gh-muted">{t.leads.convertedNote}</span>
        </section>
      ) : (
        <section className="status-bar" aria-labelledby="lead-stage-label">
          <span className="gh-label" id="lead-stage-label">{t.leads.stage}</span>
          <div className="segmented status-segmented" role="group" aria-labelledby="lead-stage-label">
            {PICKABLE_STATUSES.map((s) => (
              <button key={s} type="button" aria-pressed={lead.status === s} disabled={busy} onClick={() => setStatus(s)}>
                {t.leads.statuses[s]}
              </button>
            ))}
          </div>
          {msg && (
            <p className={msg.ok ? "gh-ok" : "gh-error"} role="status">
              {msg.text}
            </p>
          )}
        </section>
      )}

      {lead.status === "lost" && (
        <form
          className="lost-reason"
          onSubmit={(e) => {
            e.preventDefault();
            patch({ lost_reason: lostReason.trim() || null }, t.leads.stageSaved, t.leads.stageFailed);
          }}
        >
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="lost-reason">{t.leads.lostReason}</label>
            <div className="input-row">
              <input
                id="lost-reason"
                className="gh-input"
                placeholder={t.leads.lostReasonPlaceholder}
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
              />
              <button className="gh-btn gh-btn-secondary" type="submit" disabled={busy || lostReason.trim() === (lead.lost_reason ?? "")}>
                {t.leads.saveReason}
              </button>
            </div>
          </div>
        </form>
      )}

      {isOpen && (
        <section className="follow-up-bar" aria-labelledby="follow-up-label">
          <div className="follow-up-main">
            <p className="gh-label" id="follow-up-label">{t.leads.nextFollowUp}</p>
            <p className="follow-up-date">{lead.next_follow_up ? formatDate(lead.next_follow_up, t.locale) : t.leads.noFollowUp}</p>
            <FollowUpNote lead={lead} today={today} />
          </div>
          <div className="follow-up-actions">
            <button className="text-btn" type="button" disabled={busy} onClick={() => setFollowUp(addDays(today, 1))}>{t.leads.quick.tomorrow}</button>
            <button className="text-btn" type="button" disabled={busy} onClick={() => setFollowUp(addDays(today, 3))}>{t.leads.quick.in3}</button>
            <button className="text-btn" type="button" disabled={busy} onClick={() => setFollowUp(addDays(today, 7))}>{t.leads.quick.nextWeek}</button>
            <label className="visually-hidden" htmlFor="follow-up-input">{t.leads.nextFollowUp}</label>
            <input
              id="follow-up-input"
              className="gh-input follow-up-input"
              type="date"
              value={lead.next_follow_up ?? ""}
              disabled={busy}
              onChange={(e) => setFollowUp(e.target.value || null)}
            />
            {lead.next_follow_up && (
              <button className="text-btn" type="button" disabled={busy} onClick={() => setFollowUp(null)}>{t.leads.quick.clear}</button>
            )}
          </div>
        </section>
      )}

      <div className="detail-grid">
        <Panel title={t.leads.details}>
          <Facts
            completeHref={`/leads/${lead.id}/editar`}
            items={[
              { label: t.leads.phone, value: lead.phone, href: telHref(lead.phone) },
              { label: t.leads.email, value: lead.email, href: mailHref(lead.email) },
              { label: t.leads.interest, value: lead.interest },
              { label: t.leads.location, value: lead.location },
              { label: t.leads.createdOn, value: formatDate(lead.created_at, t.locale) },
            ]}
          />
          {wa && (
            <a className="panel-link wa-link" href={wa} target="_blank" rel="noopener noreferrer">
              {t.leads.whatsapp}
            </a>
          )}
          {lead.notes && <NoteBlock title={t.leads.notes} text={lead.notes} />}
          {lead.status === "lost" && lead.lost_reason && <NoteBlock title={t.leads.lostReason} text={lead.lost_reason} />}
        </Panel>

        <LeadActivityPanel
          leadId={lead.id}
          activities={activities}
          owners={owners}
          onAdded={onActivityAdded}
          onRemoved={(aid) => setActivities((list) => list.filter((x) => x.id !== aid))}
        />
      </div>

      <DeleteZone
        label={t.leads.deleteLead}
        message={t.leads.deleteConfirm(lead.name)}
        confirmLabel={t.leads.deleteForever}
        busyLabel={t.leads.deleting}
        cancelLabel={t.common.cancel}
        error={deleteError}
        busy={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
