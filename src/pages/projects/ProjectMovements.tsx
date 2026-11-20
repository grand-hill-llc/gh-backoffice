import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { MOVEMENT_COLUMNS, MOVEMENT_KINDS, type Movement, type MovementKind } from "../../lib/projects";
import { formatMoney, parseMoney } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Panel } from "../../components/Panel";
import MoneyField from "../../components/MoneyField";
import { AlertCircleIcon } from "../Icons";
import { MovementKindTag } from "./projectTags";
import type { AssignmentRow, WorkUpdate } from "./ProjectSubs";
import { useT } from "../../i18n";

type Props = { projectId: string; movements: Movement[]; assignments: AssignmentRow[]; onChange: (update?: WorkUpdate) => Promise<void> };

/** Every receipt from the client and every payment out (to subs or other expenses), newest first. */
export default function ProjectMovements({ projectId, movements, assignments, onChange }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const subName = (assignmentId: string | null) => {
    const a = assignments.find((x) => x.id === assignmentId);
    return a ? [a.sub?.company_name, a.trade].filter(Boolean).join(" · ") : null;
  };

  const remove = async (m: Movement) => {
    setRowError(null);
    const { error } = await supabase.from("project_movements").delete().eq("id", m.id);
    setPendingDelete(null);
    if (error) return setRowError(t.projects.deleteMovementFailed);
    await onChange((w) => ({ ...w, movements: w.movements.filter((x) => x.id !== m.id) }));
  };

  const sorted = [...movements].sort((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at));

  return (
    <Panel
      title={t.projects.movementsTitle}
      action={
        !adding && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            {t.projects.addMovement}
          </button>
        )
      }
    >
      {adding && (
        <MovementForm
          projectId={projectId}
          assignments={assignments}
          onCancel={() => setAdding(false)}
          onDone={async (row) => {
            setAdding(false);
            await onChange((w) => ({ ...w, movements: [...w.movements, row] }));
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
        !adding && <p className="panel-empty">{t.projects.noMovements}</p>
      ) : (
        <div className="table-wrap is-flush">
          <table className="gh-table movements-table">
            <thead>
              <tr>
                <th scope="col">{t.projects.date}</th>
                <th scope="col">{t.projects.kind}</th>
                <th scope="col">{t.projects.reference}</th>
                <th scope="col" className="num">{t.projects.amount}</th>
                <th scope="col"><span className="visually-hidden">{t.common.delete}</span></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m) => {
                const label = formatMoney(m.amount, t.locale);
                const detail = [subName(m.project_sub_id), m.reference].filter(Boolean).join(" · ");
                return (
                  <tr key={m.id}>
                    <td className="nowrap">{formatDate(m.occurred_on, t.locale)}</td>
                    <td><MovementKindTag kind={m.kind} /></td>
                    <td>
                      {detail || <span className="gh-muted">—</span>}
                      {m.notes && <span className="cell-sub">{m.notes}</span>}
                    </td>
                    <td className={`num ${m.kind === "receipt" ? "is-in" : "is-out"}`}>
                      {m.kind === "receipt" ? "+" : "−"}
                      {label}
                    </td>
                    <td className="nowrap row-actions">
                      {pendingDelete === m.id ? (
                        <>
                          <button className="text-btn is-danger" type="button" onClick={() => remove(m)}>{t.common.confirm}</button>
                          <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                        </>
                      ) : (
                        <button
                          className="text-btn"
                          type="button"
                          onClick={() => setPendingDelete(m.id)}
                          aria-label={t.projects.deleteMovementLabel(t.projects.kinds[m.kind], label)}
                        >
                          {t.common.delete}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function MovementForm({
  projectId,
  assignments,
  onCancel,
  onDone,
}: {
  projectId: string;
  assignments: AssignmentRow[];
  onCancel: () => void;
  onDone: (row: Movement) => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<MovementKind>("receipt");
  const [assignmentId, setAssignmentId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseMoney(amount);
  const amountError = touched && (parsed === null || Number.isNaN(parsed) || parsed <= 0) ? t.projects.amountRequired : null;
  const assignmentError = touched && kind === "sub_payment" && !assignmentId ? t.projects.pickAssignment : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (parsed === null || Number.isNaN(parsed) || parsed <= 0 || (kind === "sub_payment" && !assignmentId) || !date) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("project_movements")
      .insert({
      project_id: projectId,
      kind,
      project_sub_id: kind === "sub_payment" ? assignmentId : null,
      amount: parsed,
      occurred_on: date,
      reference: reference.trim() || null,
        notes: notes.trim() || null,
      })
      .select(MOVEMENT_COLUMNS)
      .single();
    setBusy(false);
    if (error || !data) return setError(t.projects.movementFailed);
    onDone(data as Movement);
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="segmented kind-segmented" role="group" aria-label={t.projects.kind}>
        {MOVEMENT_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t.projects.kinds[k]}
          </button>
        ))}
      </div>
      <div className="form-grid">
        {kind === "sub_payment" && (
          <div className={`gh-field span-2${assignmentError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="mv-assignment">{t.projects.whichSub}</label>
            {assignments.length === 0 ? (
              <p className="gh-help">{t.projects.needsAssignment}</p>
            ) : (
              <select
                id="mv-assignment"
                className="gh-input gh-select"
                value={assignmentId}
                onChange={(e) => setAssignmentId(e.target.value)}
                aria-invalid={!!assignmentError}
                aria-describedby={assignmentError ? "mv-assignment-error" : undefined}
              >
                <option value="">{t.projects.chooseSub}</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>{[a.sub?.company_name, a.trade].filter(Boolean).join(" · ")}</option>
                ))}
              </select>
            )}
            {assignmentError && <p className="gh-error" id="mv-assignment-error">{assignmentError}</p>}
          </div>
        )}
        <MoneyField id="mv-amount" label={t.projects.amount} help="" value={amount} error={amountError} onChange={setAmount} />
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="mv-date">{t.projects.date}</label>
          <input id="mv-date" className="gh-input" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="mv-reference">{t.projects.reference}</label>
          <input id="mv-reference" className="gh-input" placeholder={t.projects.referencePlaceholder} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="mv-notes">{t.projects.notes}</label>
          <input id="mv-notes" className="gh-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy || (kind === "sub_payment" && assignments.length === 0)}>
          {busy ? t.common.saving : t.projects.saveMovement}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
