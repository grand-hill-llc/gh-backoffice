import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { PROJECT_COLUMNS, PROJECT_STATUSES, type Project, type ProjectStatus } from "../../lib/projects";
import { BID_COLUMNS, parseMoney, type Bid } from "../../lib/sales";
import { PageHeader } from "../../components/ui";
import MoneyField from "../../components/MoneyField";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

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
      const [c, p, b, existing] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        id ? supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle() : none,
        bidId ? supabase.from("bids").select(BID_COLUMNS).eq("id", bidId).maybeSingle() : none,
        bidId ? supabase.from("projects").select("id").eq("bid_id", bidId).maybeSingle() : none,
      ]);
      if (!active) return;
      setLoading(false);
      if (c.error || p.error || b.error || existing.error || (id && !p.data)) return setLoadFailed(true);
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
    setBusy(false);
    if (result.error || !result.data) {
      // unique(bid_id): someone created the project from this bid in the meantime
      return setError(/bid_id|duplicate/i.test(result.error?.message ?? "") ? t.projects.bidAlreadyHasProject : t.projects.saveFailed);
    }
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
