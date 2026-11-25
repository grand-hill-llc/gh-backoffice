import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { PROJECT_COLUMNS, PROJECT_STATUSES, type Project, type ProjectStatus } from "../../lib/projects";
import { BID_COLUMNS, formatMoney, parseMoney, type Bid } from "../../lib/sales";
import { assignmentsFromEstimate, type ProposedAssignment } from "../../lib/estimates";
import { PageHeader } from "../../components/ui";
import MoneyField from "../../components/MoneyField";
import { AlertCircleIcon } from "../Icons";
import { tradeLabel, useT } from "../../i18n";

type Values = {
  name: string;
  client_id: string;
  status: ProjectStatus;
  location: string;
  start_date: string;
  end_date: string;
  contract_amount: string;
  budgeted_cost: string;
  notes: string;
};

const EMPTY: Values = {
  name: "",
  client_id: "",
  status: "scheduled",
  location: "",
  start_date: "",
  end_date: "",
  contract_amount: "",
  budgeted_cost: "",
  notes: "",
};

const moneyText = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/** Create (/proyectos/nuevo, optionally ?bid=<id> to copy a won bid) and edit (/proyectos/:id/editar). */
export default function ProjectForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const bidId = editing ? null : params.get("bid");
  const t = useT();
  const navigate = useNavigate();

  const [values, setValues] = useState<Values>(EMPTY);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [sourceBid, setSourceBid] = useState<Bid | null>(null);
  const [proposed, setProposed] = useState<(ProposedAssignment & { name: string; inactive: boolean })[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [existingProjectId, setExistingProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const none = Promise.resolve({ data: null, error: null });
      const [c, p, b, existing, lines, quotes] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        id ? supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle() : none,
        bidId ? supabase.from("bids").select(BID_COLUMNS).eq("id", bidId).maybeSingle() : none,
        bidId ? supabase.from("projects").select("id").eq("bid_id", bidId).maybeSingle() : none,
        bidId ? supabase.from("estimate_lines").select("position, trade, sub_quote_id, cost_amount").eq("bid_id", bidId) : none,
        bidId
          ? supabase.from("sub_quotes").select("id, subcontractor_id, trade, reference, sub:subcontractors(company_name, status)").eq("bid_id", bidId)
          : none,
      ]);
      if (!active) return;
      setLoading(false);
      if (c.error || p.error || b.error || existing.error || lines.error || quotes.error || (id && !p.data)) return setLoadFailed(true);
      setClients((c.data ?? []) as { id: string; name: string }[]);

      if (p.data) {
        const pr = p.data as Project;
        setValues({
          name: pr.name,
          client_id: pr.client_id ?? "",
          status: pr.status,
          location: pr.location ?? "",
          start_date: pr.start_date ?? "",
          end_date: pr.end_date ?? "",
          contract_amount: moneyText(pr.contract_amount),
          budgeted_cost: moneyText(pr.budgeted_cost),
          notes: pr.notes ?? "",
        });
      } else if (b.data) {
        // Copy what the bid already knows: price becomes the contract, estimated cost the budget.
        const bid = b.data as Bid;
        setSourceBid(bid);
        setExistingProjectId((existing.data as { id: string } | null)?.id ?? null);
        type QuoteRow = { id: string; subcontractor_id: string; trade: string | null; reference: string | null; sub: { company_name: string; status: string } | null };
        const qs = (quotes.data ?? []) as unknown as QuoteRow[];
        const subOf = new Map(qs.map((q) => [q.subcontractor_id, q.sub]));
        setProposed(
          assignmentsFromEstimate((lines.data ?? []) as never, qs).map((a) => ({
            ...a,
            name: subOf.get(a.subcontractor_id)?.company_name ?? "—",
            inactive: subOf.get(a.subcontractor_id)?.status === "inactive",
          })),
        );
        setValues({
          ...EMPTY,
          name: bid.title,
          client_id: bid.client_id ?? "",
          location: bid.location ?? "",
          contract_amount: moneyText(bid.our_price),
          budgeted_cost: moneyText(bid.estimated_value),
          notes: bid.scope ?? "",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [id, bidId]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const contract = parseMoney(values.contract_amount);
  const budget = parseMoney(values.budgeted_cost);
  const nameError = touched && !values.name.trim() ? t.projects.nameRequired : null;
  const datesError = values.start_date && values.end_date && values.end_date < values.start_date ? t.projects.datesInvalid : null;
  const contractError = touched && Number.isNaN(contract) ? t.projects.moneyInvalid : null;
  const budgetError = touched && Number.isNaN(budget) ? t.projects.moneyInvalid : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!values.name.trim() || datesError || Number.isNaN(contract) || Number.isNaN(budget)) return;

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload = {
      name: values.name.trim(),
      client_id: values.client_id || null,
      status: values.status,
      location: blank(values.location),
      start_date: values.start_date || null,
      end_date: values.end_date || null,
      contract_amount: contract,
      budgeted_cost: budget,
      notes: blank(values.notes),
      ...(editing ? {} : { bid_id: sourceBid?.id ?? null }),
    };
    setBusy(true);
    const result = editing
      ? await supabase.from("projects").update(payload).eq("id", id!).select("id").single()
      : await supabase.from("projects").insert(payload).select("id").single();
    if (result.error || !result.data) {
      setBusy(false);
      // unique(bid_id): someone created the project from this bid in the meantime
      return setError(/bid_id|duplicate/i.test(result.error?.message ?? "") ? t.projects.bidAlreadyHasProject : t.projects.saveFailed);
    }
    const assign = editing ? [] : proposed.filter((a) => !skipped.has(a.key));
    if (assign.length) {
      const subs = await supabase.from("project_subs").insert(
        assign.map((a) => ({
          project_id: result.data.id,
          subcontractor_id: a.subcontractor_id,
          trade: a.trade ? tradeLabel(a.trade, t) : null,
          agreed_amount: a.agreed_amount,
          notes: a.references.length ? t.projects.quoteRef(a.references.join(", ")) : null,
        })),
      );
      if (subs.error) {
        // All or nothing: without its assignments the new project would look complete but isn't.
        await supabase.from("projects").delete().eq("id", result.data.id);
        setBusy(false);
        return setError(t.projects.subsAssignFailed);
      }
    }
    setBusy(false);
    navigate(`/proyectos/${result.data.id}`, { replace: editing });
  };

  const backTo = editing ? `/proyectos/${id}` : sourceBid ? `/bids/${sourceBid.id}` : "/proyectos";
  const backLabel = editing ? values.name || t.projects.one : sourceBid ? sourceBid.title : t.projects.title;

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {t.projects.notFound} <Link to="/proyectos">{t.projects.title}</Link>
        </p>
      </div>
    );
  if (existingProjectId)
    return (
      <>
        <Link className="back-link" to={backTo}>← {backLabel}</Link>
        <div className="gh-notice" role="status">
          <AlertCircleIcon />
          <p>
            {t.projects.bidAlreadyHasProject} <Link to={`/proyectos/${existingProjectId}`}>{t.projects.viewProject}</Link>
          </p>
        </div>
      </>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {backLabel}</Link>
      <PageHeader title={editing ? t.projects.editTitle : t.projects.newTitle} />
      {sourceBid && <p className="form-intro gh-muted">{t.projects.fromBidNote(sourceBid.title)}</p>}

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.projects.sectionProject}</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${nameError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="name">{t.projects.name}</label>
              <input
                id="name"
                className="gh-input"
                autoFocus={!editing && !sourceBid}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "name-error" : undefined}
              />
              {nameError && <p className="gh-error" id="name-error">{nameError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="status">{t.projects.status}</label>
              <select id="status" className="gh-input gh-select" value={values.status} onChange={(e) => set("status", e.target.value as ProjectStatus)}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>{t.projects.statuses[s]}</option>
                ))}
              </select>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="client_id">{t.projects.client}</label>
              <select id="client_id" className="gh-input gh-select" value={values.client_id} onChange={(e) => set("client_id", e.target.value)}>
                <option value="">{t.projects.chooseClient}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="location">{t.projects.location}</label>
              <input id="location" className="gh-input" value={values.location} onChange={(e) => set("location", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.projects.sectionDates}</legend>
          <div className="form-grid">
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="start_date">{t.projects.startDate}</label>
              <input id="start_date" className="gh-input" type="date" value={values.start_date} onChange={(e) => set("start_date", e.target.value)} />
            </div>
            <div className={`gh-field${datesError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="end_date">{t.projects.endDate}</label>
              <input
                id="end_date"
                className="gh-input"
                type="date"
                min={values.start_date || undefined}
                value={values.end_date}
                onChange={(e) => set("end_date", e.target.value)}
                aria-invalid={!!datesError}
                aria-describedby={datesError ? "dates-error" : undefined}
              />
              {datesError && <p className="gh-error" id="dates-error">{datesError}</p>}
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.projects.sectionMoney}</legend>
          <div className="form-grid">
            <MoneyField
              id="contract_amount"
              label={t.projects.contract}
              help={t.projects.contractHelp}
              value={values.contract_amount}
              error={contractError}
              onChange={(v) => set("contract_amount", v)}
            />
            <MoneyField
              id="budgeted_cost"
              label={t.projects.budget}
              help={t.projects.budgetHelp}
              value={values.budgeted_cost}
              error={budgetError}
              onChange={(v) => set("budgeted_cost", v)}
            />
          </div>
        </fieldset>

        {proposed.length > 0 && (
          <fieldset className="form-section">
            <legend className="gh-label">{t.projects.sectionSubs}</legend>
            <ul className="proposed-subs">
              {proposed.map((a) => (
                <li key={a.key}>
                  <label className="gh-check">
                    <input
                      type="checkbox"
                      checked={!skipped.has(a.key)}
                      onChange={(e) =>
                        setSkipped((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.delete(a.key);
                          else next.add(a.key);
                          return next;
                        })
                      }
                    />
                    <span className="proposed-sub-name">
                      {a.name}
                      {(a.trade || a.inactive) && (
                        <span className="gh-small gh-muted">
                          {[a.trade ? tradeLabel(a.trade, t) : null, a.inactive ? t.subs.statuses.inactive : null].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                  </label>
                  <span className="proposed-sub-amount">{formatMoney(a.agreed_amount, t.locale)}</span>
                </li>
              ))}
            </ul>
            <p className="gh-help">{t.projects.subsFromEstimateHelp}</p>
          </fieldset>
        )}

        <fieldset className="form-section">
          <legend className="gh-label">{t.projects.notes}</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">{t.projects.notes}</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">{t.projects.notesHelp}</p>
          </div>
        </fieldset>

        {error && (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{error}</p>
          </div>
        )}

        <div className="form-actions">
          <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>
            {busy ? t.common.saving : editing ? t.projects.saveChanges : t.projects.create}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}
