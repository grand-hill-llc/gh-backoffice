import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { paidToAssignment, PROJECT_SUB_COLUMNS, type ChangeOrder, type Movement, type ProjectSub } from "../../lib/projects";
import { formatMoney, parseMoney } from "../../lib/sales";
import { Panel } from "../../components/Panel";
import MoneyField from "../../components/MoneyField";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

/** agreed_amount is the current amount (with approved change orders); base_agreed the original, when known. */
export type AssignmentRow = ProjectSub & { sub: { id: string; company_name: string } | null; base_agreed?: number | null };
export type SubOption = { id: string; company_name: string; status: string };
export type Work = { assignments: AssignmentRow[]; movements: Movement[]; orders: ChangeOrder[] };
/** Local change to apply before the server re-read. */
export type WorkUpdate = (w: Work) => Work;

type Props = {
  projectId: string;
  assignments: AssignmentRow[];
  movements: Movement[];
  directory: SubOption[];
  onChange: (update?: WorkUpdate) => Promise<void>;
};

/** Subcontractors assigned to the project: who, which trade, agreed amount and what has been paid. */
export default function ProjectSubs({ projectId, assignments, movements, directory, onChange }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const remove = async (a: AssignmentRow) => {
    setRowError(null);
    const { error } = await supabase.from("project_subs").delete().eq("id", a.id);
    if (error) {
      setRowError(
        /change_orders/i.test(error.message)
          ? t.projects.co.assignmentHasOrders
          : /project_movements|foreign key|violates/i.test(error.message)
            ? t.projects.assignmentHasPayments
            : t.projects.removeAssignmentFailed
      );
      setPendingRemove(null);
      return;
    }
    setPendingRemove(null);
    await onChange((w) => ({ ...w, assignments: w.assignments.filter((x) => x.id !== a.id) }));
  };

  return (
    <Panel
      title={t.projects.subsTitle}
      action={
        !adding && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            {t.projects.assignSub}
          </button>
        )
      }
    >
      {adding && (
        <AssignForm
          projectId={projectId}
          directory={directory}
          onCancel={() => setAdding(false)}
          onDone={async (row) => {
            setAdding(false);
            await onChange((w) => ({ ...w, assignments: [...w.assignments, row] }));
          }}
        />
      )}

      {rowError && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{rowError}</p>
        </div>
      )}

      {assignments.length === 0 ? (
        !adding && <p className="panel-empty">{t.projects.noAssignments}</p>
      ) : (
        <ul className="doc-list">
          {assignments.map((a) => {
            const paid = paidToAssignment(a.id, movements);
            const name = a.sub?.company_name ?? "—";
            return (
              <li key={a.id} className="doc-item">
                <div className="doc-main">
                  {a.sub ? <Link className="row-link" to={`/subcontratistas/${a.sub.id}`}>{name}</Link> : <p className="doc-type">{name}</p>}
                  {a.trade && <p className="gh-small gh-muted">{a.trade}</p>}
                  <p className="gh-small">
                    {a.agreed_amount !== null
                      ? t.projects.paidOf(formatMoney(paid, t.locale), formatMoney(a.agreed_amount, t.locale))
                      : t.projects.paidOnly(formatMoney(paid, t.locale))}
                  </p>
                  {a.base_agreed !== undefined && a.base_agreed !== a.agreed_amount && (
                    <p className="gh-small gh-muted">{t.projects.co.includesChanges(formatMoney(a.base_agreed, t.locale))}</p>
                  )}
                  {a.notes && <p className="gh-small gh-muted assignment-note">{a.notes}</p>}
                </div>
                <div className="doc-side">
                  <div className="doc-actions">
                    {pendingRemove === a.id ? (
                      <>
                        <button className="text-btn is-danger" type="button" onClick={() => remove(a)}>{t.common.confirm}</button>
                        <button className="text-btn" type="button" onClick={() => setPendingRemove(null)}>{t.common.no}</button>
                      </>
                    ) : (
                      <button className="text-btn" type="button" onClick={() => setPendingRemove(a.id)} aria-label={t.projects.removeAssignmentLabel(name)}>
                        {t.projects.removeAssignment}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function AssignForm({
  projectId,
  directory,
  onCancel,
  onDone,
}: {
  projectId: string;
  directory: SubOption[];
  onCancel: () => void;
  onDone: (row: AssignmentRow) => void;
}) {
  const t = useT();
  const [subId, setSubId] = useState("");
  const [trade, setTrade] = useState("");
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseMoney(amount);
  const subError = touched && !subId ? t.projects.pickSub : null;
  const amountError = touched && Number.isNaN(parsed) ? t.projects.moneyInvalid : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!subId || Number.isNaN(parsed)) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("project_subs")
      .insert({ project_id: projectId, subcontractor_id: subId, trade: trade.trim() || null, agreed_amount: parsed })
      .select(`${PROJECT_SUB_COLUMNS}, sub:subcontractors(id, company_name)`)
      .single();
    setBusy(false);
    if (error || !data) return setError(t.projects.assignFailed);
    onDone(data as unknown as AssignmentRow);
  };

  if (directory.length === 0)
    return (
      <div className="upload-form">
        <p className="gh-muted" style={{ margin: 0 }}>
          {t.projects.noSubsInDirectory} <Link to="/subcontratistas/nuevo">{t.subs.newButton}</Link>
        </p>
        <div className="form-actions">
          <button className="gh-link" type="button" onClick={onCancel}>{t.common.cancel}</button>
        </div>
      </div>
    );

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className={`gh-field span-2${subError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="assign-sub">{t.projects.subcontractor}</label>
          <select
            id="assign-sub"
            className="gh-input gh-select"
            value={subId}
            onChange={(e) => setSubId(e.target.value)}
            aria-invalid={!!subError}
            aria-describedby={subError ? "assign-sub-error" : undefined}
          >
            <option value="">{t.projects.chooseSub}</option>
            {directory.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company_name}
                {s.status !== "active" ? ` · ${t.subs.statuses[s.status as keyof typeof t.subs.statuses] ?? s.status}` : ""}
              </option>
            ))}
          </select>
          {subError && <p className="gh-error" id="assign-sub-error">{subError}</p>}
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="assign-trade">{t.projects.trade}</label>
          <input id="assign-trade" className="gh-input" placeholder={t.projects.tradePlaceholder} value={trade} onChange={(e) => setTrade(e.target.value)} />
        </div>
        <MoneyField id="assign-amount" label={t.projects.agreedAmount} help="" value={amount} error={amountError} onChange={setAmount} />
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.projects.saveAssignment}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
