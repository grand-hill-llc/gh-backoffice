import { useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import { CHANGE_ORDER_COLUMNS, type ChangeOrder, type ChangeOrderStatus } from "../../lib/projects";
import { parseMoney, signedMoney } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Panel } from "../../components/Panel";
import MoneyField from "../../components/MoneyField";
import { Tag, type TagTone } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import type { AssignmentRow, WorkUpdate } from "./ProjectSubs";
import { useT } from "../../i18n";

type Props = {
  projectId: string;
  orders: ChangeOrder[];
  assignments: AssignmentRow[];
  onChange: (update?: WorkUpdate) => Promise<void>;
};

const TONE: Record<ChangeOrderStatus, TagTone> = { pending: "warning", approved: "success", rejected: "neutral" };

/** Extra work or credits agreed after the contract. Only approved ones change the project's amounts. */
export default function ProjectChangeOrders({ projectId, orders, assignments, onChange }: Props) {
  const t = useT();
  const c = t.projects.co;
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const subName = (assignmentId: string | null) => {
    const a = assignments.find((x) => x.id === assignmentId);
    return a ? [a.sub?.company_name, a.trade].filter(Boolean).join(" · ") : null;
  };

  const replace = (row: ChangeOrder) => (w: Parameters<WorkUpdate>[0]) => ({
    ...w,
    orders: w.orders.some((o) => o.id === row.id) ? w.orders.map((o) => (o.id === row.id ? row : o)) : [...w.orders, row],
  });

  const decide = async (o: ChangeOrder, status: ChangeOrderStatus) => {
    setBusyId(o.id);
    setRowError(null);
    const { data, error } = await supabase
      .from("change_orders")
      .update({ status, decided_on: status === "pending" ? null : todayISO() })
      .eq("id", o.id)
      .select(CHANGE_ORDER_COLUMNS)
      .single();
    setBusyId(null);
    if (error || !data) return setRowError(c.decideFailed);
    await onChange(replace(data as unknown as ChangeOrder));
  };

  const remove = async (o: ChangeOrder) => {
    setBusyId(o.id);
    setRowError(null);
    const { error } = await supabase.from("change_orders").delete().eq("id", o.id);
    setBusyId(null);
    setPendingDelete(null);
    if (error) return setRowError(c.deleteFailed);
    await onChange((w) => ({ ...w, orders: w.orders.filter((x) => x.id !== o.id) }));
  };

  const sorted = [...orders].sort((a, b) => b.number - a.number);

  return (
    <Panel
      title={c.title}
      action={
        editing === null && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setEditing("new")}>
            {c.add}
          </button>
        )
      }
    >
      {editing === "new" && (
        <ChangeOrderForm
          projectId={projectId}
          assignments={assignments}
          onCancel={() => setEditing(null)}
          onDone={async (row) => {
            setEditing(null);
            await onChange(replace(row));
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
        editing === null && <p className="panel-empty">{c.empty}</p>
      ) : (
        <ul className="doc-list">
          {sorted.map((o) =>
            editing === o.id ? (
              <li key={o.id} className="doc-item is-editing">
                <ChangeOrderForm
                  projectId={projectId}
                  assignments={assignments}
                  initial={o}
                  onCancel={() => setEditing(null)}
                  onDone={async (row) => {
                    setEditing(null);
                    await onChange(replace(row));
                  }}
                />
              </li>
            ) : (
              <li key={o.id} className={`doc-item co-item is-${o.status}`}>
                <div className="doc-main">
                  <p className="doc-type">
                    <span className="co-number">{c.number(o.number)}</span> {o.title}
                  </p>
                  <ul className="co-amounts">
                    {Number(o.contract_delta) !== 0 && (
                      <li>{c.toClient}: <strong>{signedMoney(Number(o.contract_delta), t.locale)}</strong></li>
                    )}
                    {Number(o.cost_delta) !== 0 && (
                      <li>{c.toCost}: <strong>{signedMoney(Number(o.cost_delta), t.locale)}</strong></li>
                    )}
                    {o.project_sub_id && o.sub_delta !== null && (
                      <li>{subName(o.project_sub_id) ?? c.sub}: <strong>{signedMoney(Number(o.sub_delta), t.locale)}</strong></li>
                    )}
                  </ul>
                  <p className="gh-small gh-muted">
                    {[
                      c.requestedOn(formatDate(o.requested_on, t.locale)),
                      o.decided_on
                        ? c.decidedOn[o.status as "approved" | "rejected"]?.(
                            formatDate(o.decided_on, t.locale),
                            o.decider?.full_name || o.decider?.email || null
                          )
                        : null,
                      o.reference,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {o.description && <p className="gh-small doc-notes">{o.description}</p>}
                </div>
                <div className="doc-side">
                  <Tag tone={TONE[o.status]}>{c.statuses[o.status]}</Tag>
                  <div className="doc-actions">
                    {pendingDelete === o.id ? (
                      <>
                        <button className="text-btn is-danger" type="button" disabled={busyId === o.id} onClick={() => remove(o)}>
                          {t.common.confirm}
                        </button>
                        <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                      </>
                    ) : o.status === "pending" ? (
                      <>
                        <button className="text-btn" type="button" disabled={busyId === o.id} onClick={() => decide(o, "approved")}>
                          {c.approve}
                        </button>
                        <button className="text-btn" type="button" disabled={busyId === o.id} onClick={() => decide(o, "rejected")}>
                          {c.reject}
                        </button>
                        <button className="text-btn" type="button" disabled={busyId === o.id} onClick={() => setEditing(o.id)}>
                          {t.common.edit}
                        </button>
                        <button
                          className="text-btn"
                          type="button"
                          disabled={busyId === o.id}
                          onClick={() => setPendingDelete(o.id)}
                          aria-label={c.deleteLabel(c.number(o.number))}
                        >
                          {t.common.delete}
                        </button>
                      </>
                    ) : (
                      <button className="text-btn" type="button" disabled={busyId === o.id} onClick={() => decide(o, "pending")}>
                        {c.reopen}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            )
          )}
        </ul>
      )}
    </Panel>
  );
}

type Direction = "add" | "credit";

function ChangeOrderForm({
  projectId,
  assignments,
  initial,
  onCancel,
  onDone,
}: {
  projectId: string;
  assignments: AssignmentRow[];
  initial?: ChangeOrder;
  onCancel: () => void;
  onDone: (row: ChangeOrder) => void;
}) {
  const t = useT();
  const c = t.projects.co;
  const abs = (v: number | null | undefined) => (v ? String(Math.abs(Number(v))) : "");
  const initialNegative =
    !!initial && [initial.contract_delta, initial.cost_delta, initial.sub_delta].some((v) => v !== null && Number(v) < 0);

  const [direction, setDirection] = useState<Direction>(initialNegative ? "credit" : "add");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [contract, setContract] = useState(abs(initial?.contract_delta));
  const [cost, setCost] = useState(abs(initial?.cost_delta));
  const [costTouched, setCostTouched] = useState(!!initial);
  const [assignmentId, setAssignmentId] = useState(initial?.project_sub_id ?? "");
  const [subAmount, setSubAmount] = useState(abs(initial?.sub_delta));
  const [requestedOn, setRequestedOn] = useState(initial?.requested_on ?? todayISO());
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parse = (v: string) => {
    const p = parseMoney(v);
    return p === null ? 0 : p;
  };
  const invalid = (v: string) => Number.isNaN(parseMoney(v));
  const contractN = parse(contract);
  const costN = parse(cost);
  const subN = assignmentId ? parse(subAmount) : 0;

  const titleError = touched && !title.trim() ? c.titleRequired : null;
  const moneyError = (v: string) => (touched && invalid(v) ? t.projects.moneyInvalid : null);
  const subError = touched && assignmentId && !invalid(subAmount) && subN === 0 ? c.subAmountRequired : null;
  const nothing = touched && !invalid(contract) && !invalid(cost) && contractN === 0 && costN === 0 && subN === 0;

  // The sub's amount is usually part of the cost: mirror it until the cost is typed by hand.
  const onSubAmount = (v: string) => {
    setSubAmount(v);
    if (!costTouched) setCost(v);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!title.trim() || invalid(contract) || invalid(cost) || (assignmentId && (invalid(subAmount) || subN === 0))) return;
    if (contractN === 0 && costN === 0 && subN === 0) return;
    const sign = direction === "credit" ? -1 : 1;
    const values = {
      title: title.trim(),
      description: description.trim() || null,
      contract_delta: sign * contractN,
      cost_delta: sign * costN,
      project_sub_id: assignmentId || null,
      sub_delta: assignmentId ? sign * subN : null,
      requested_on: requestedOn || todayISO(),
      reference: reference.trim() || null,
    };
    setBusy(true);
    const query = initial
      ? supabase.from("change_orders").update(values).eq("id", initial.id)
      : supabase.from("change_orders").insert({ ...values, project_id: projectId, number: 0 });
    const { data, error } = await query.select(CHANGE_ORDER_COLUMNS).single();
    setBusy(false);
    if (error || !data) return setError(c.saveFailed);
    onDone(data as unknown as ChangeOrder);
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="segmented kind-segmented" role="group" aria-label={c.direction}>
        {(["add", "credit"] as Direction[]).map((d) => (
          <button key={d} type="button" aria-pressed={direction === d} onClick={() => setDirection(d)}>
            {c.directions[d]}
          </button>
        ))}
      </div>
      <p className="gh-help">{c.directionHelp[direction]}</p>

      <div className="form-grid">
        <div className={`gh-field span-2${titleError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="co-title">{c.titleLabel}</label>
          <input
            id="co-title"
            className="gh-input"
            autoFocus
            placeholder={c.titlePlaceholder}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={!!titleError}
            aria-describedby={titleError ? "co-title-error" : undefined}
          />
          {titleError && <p className="gh-error" id="co-title-error">{titleError}</p>}
        </div>

        <MoneyField id="co-contract" label={c.toClient} help={c.toClientHelp} value={contract} error={moneyError(contract)} onChange={setContract} />
        <MoneyField
          id="co-cost"
          label={c.toCost}
          help={c.toCostHelp}
          value={cost}
          error={moneyError(cost)}
          onChange={(v) => {
            setCostTouched(true);
            setCost(v);
          }}
        />

        {assignments.length > 0 && (
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="co-sub">{c.sub}</label>
            <select id="co-sub" className="gh-input gh-select" value={assignmentId} onChange={(e) => setAssignmentId(e.target.value)}>
              <option value="">{c.noSub}</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>{[a.sub?.company_name, a.trade].filter(Boolean).join(" · ")}</option>
              ))}
            </select>
            <p className="gh-help">{c.subHelp}</p>
          </div>
        )}
        {assignmentId && (
          <MoneyField
            id="co-sub-amount"
            label={c.subAmount}
            help={c.subAmountHelp}
            value={subAmount}
            error={moneyError(subAmount) ?? subError}
            onChange={onSubAmount}
          />
        )}

        <div className="gh-field">
          <label className="gh-field-label" htmlFor="co-date">{c.requested}</label>
          <input id="co-date" className="gh-input" type="date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="co-reference">{t.projects.reference}</label>
          <input id="co-reference" className="gh-input" placeholder={c.referencePlaceholder} value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="co-description">{c.descriptionLabel}</label>
          <textarea id="co-description" className="gh-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      {nothing && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{c.amountRequired}</p>
        </div>
      )}
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : initial ? t.projects.saveChanges : c.save}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
