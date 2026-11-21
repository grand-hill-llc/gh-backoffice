import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { ACTIVITY_COLUMNS, ACTIVITY_KINDS, ownerName, relativeTime, type ActivityKind, type LeadActivity, type Owner } from "../../lib/leads";
import { Panel } from "../../components/Panel";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

type Props = {
  leadId: string;
  activities: LeadActivity[];
  owners: Owner[];
  /** Called after a save with the new row and the follow-up date chosen in the same form (if any). */
  onAdded: (row: LeadActivity, nextFollowUp: string | null) => Promise<void>;
  onRemoved: (id: string) => void;
};

/** "2026-11-20T14:05" for a datetime-local input, in local time. */
function localNow(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Calls, messages, visits and notes about a lead, newest first. */
export default function LeadActivityPanel({ leadId, activities, owners, onAdded, onRemoved }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(activities.length === 0);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const remove = async (a: LeadActivity) => {
    setRowError(null);
    const { error } = await supabase.from("lead_activities").delete().eq("id", a.id);
    setPendingDelete(null);
    if (error) return setRowError(t.leads.deleteActivityFailed);
    onRemoved(a.id);
  };

  const sorted = [...activities].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(t.locale, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Panel
      title={t.leads.activity}
      action={
        !adding && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            {t.leads.logActivity}
          </button>
        )
      }
    >
      {adding && (
        <ActivityForm
          leadId={leadId}
          onCancel={activities.length ? () => setAdding(false) : undefined}
          onDone={async (row, next) => {
            setAdding(false);
            await onAdded(row, next);
          }}
        />
      )}

      {rowError && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{rowError}</p>
        </div>
      )}

      {sorted.length === 0 ? (
        !adding && <p className="panel-empty">{t.leads.noActivities}</p>
      ) : (
        <ol className="timeline">
          {sorted.map((a) => (
            <li key={a.id} className={`timeline-item is-${a.kind}`}>
              <div className="timeline-head">
                <span className="timeline-kind">{t.leads.kinds[a.kind]}</span>
                <time dateTime={a.occurred_at} title={dateTime(a.occurred_at)}>
                  {relativeTime(a.occurred_at, t.locale)}
                </time>
                {a.created_by && <span className="gh-muted">{t.leads.by(ownerName(owners.find((o) => o.id === a.created_by)))}</span>}
              </div>
              <p className="timeline-text">{a.summary}</p>
              <div className="timeline-actions">
                {pendingDelete === a.id ? (
                  <>
                    <button className="text-btn is-danger" type="button" onClick={() => remove(a)}>{t.common.confirm}</button>
                    <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                  </>
                ) : (
                  <button className="text-btn" type="button" onClick={() => setPendingDelete(a.id)} aria-label={t.leads.deleteActivityLabel(t.leads.kinds[a.kind])}>
                    {t.common.delete}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ActivityForm({
  leadId,
  onCancel,
  onDone,
}: {
  leadId: string;
  onCancel?: () => void;
  onDone: (row: LeadActivity, nextFollowUp: string | null) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<ActivityKind>("call");
  const [when, setWhen] = useState(localNow());
  const [summary, setSummary] = useState("");
  const [next, setNext] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const summaryError = touched && !summary.trim() ? t.leads.summaryRequired : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!summary.trim()) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("lead_activities")
      .insert({ lead_id: leadId, kind, occurred_at: new Date(when || Date.now()).toISOString(), summary: summary.trim() })
      .select(ACTIVITY_COLUMNS)
      .single();
    setBusy(false);
    if (error || !data) return setError(t.leads.activityFailed);
    onDone(data as LeadActivity, next || null);
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="segmented kind-segmented activity-kinds" role="group" aria-label={t.leads.kind}>
        {ACTIVITY_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t.leads.kinds[k]}
          </button>
        ))}
      </div>
      <div className={`gh-field${summaryError ? " is-error" : ""}`}>
        <label className="gh-field-label" htmlFor="act-summary">{t.leads.summary}</label>
        <textarea
          id="act-summary"
          className="gh-input gh-textarea"
          rows={3}
          autoFocus
          placeholder={t.leads.summaryPlaceholder}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          aria-invalid={!!summaryError}
          aria-describedby={summaryError ? "act-summary-error" : undefined}
        />
        {summaryError && <p className="gh-error" id="act-summary-error">{summaryError}</p>}
      </div>
      <div className="form-grid">
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="act-when">{t.leads.when}</label>
          <input id="act-when" className="gh-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="act-next">{t.leads.alsoFollowUp}</label>
          <input id="act-next" className="gh-input" type="date" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.leads.saveActivity}
        </button>
        {onCancel && (
          <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
        )}
      </div>
    </form>
  );
}
