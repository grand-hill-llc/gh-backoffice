import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  STATUSES,
  TRADE_KEYS,
  SUB_COLUMNS,
  type SubStatus,
  type Subcontractor,
} from "../../lib/subcontractors";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { normalizeTrade, tradeLabel, useT } from "../../i18n";

type Values = {
  company_name: string;
  legal_name: string;
  trades: string[];
  contact_name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  status: SubStatus;
  notes: string;
};

const EMPTY: Values = {
  company_name: "",
  legal_name: "",
  trades: [],
  contact_name: "",
  email: "",
  phone: "",
  city: "",
  state: "FL",
  status: "prospect",
  notes: "",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create (/subcontratistas/nuevo) and edit (/subcontratistas/:id/editar). */
export default function SubcontractorForm() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const t = useT();

  const [values, setValues] = useState<Values>(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [tradeDraft, setTradeDraft] = useState("");

  useEffect(() => {
    if (!id) return;
    let active = true;
    supabase
      .from("subcontractors")
      .select(SUB_COLUMNS)
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error || !data) {
          setLoadFailed(true);
          return;
        }
        const s = data as Subcontractor;
        setValues({
          company_name: s.company_name,
          legal_name: s.legal_name ?? "",
          // Legacy rows may hold Spanish labels ("Pintura"); store keys from now on.
          trades: Array.from(new Set((s.trades ?? []).map(normalizeTrade))),
          contact_name: s.contact_name ?? "",
          email: s.email ?? "",
          phone: s.phone ?? "",
          city: s.city ?? "",
          state: s.state ?? "FL",
          status: s.status,
          notes: s.notes ?? "",
        });
      });
    return () => {
      active = false;
    };
  }, [id]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const nameError = touched && !values.company_name.trim() ? t.subs.companyRequired : null;
  const emailError = touched && values.email.trim() && !EMAIL_RE.test(values.email.trim()) ? t.subs.emailInvalid : null;

  const toggleTrade = (trade: string) =>
    set("trades", values.trades.includes(trade) ? values.trades.filter((t) => t !== trade) : [...values.trades, trade]);

  const addDraftTrade = () => {
    const draft = tradeDraft.trim();
    const value = draft ? normalizeTrade(draft) : "";
    if (value && !values.trades.some((x) => x.toLowerCase() === value.toLowerCase())) set("trades", [...values.trades, value]);
    setTradeDraft("");
  };

  const onTradeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addDraftTrade();
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!values.company_name.trim() || (values.email.trim() && !EMAIL_RE.test(values.email.trim()))) return;

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload = {
      company_name: values.company_name.trim(),
      legal_name: blank(values.legal_name),
      trades: values.trades,
      contact_name: blank(values.contact_name),
      email: blank(values.email)?.toLowerCase() ?? null,
      phone: blank(values.phone),
      city: blank(values.city),
      state: values.state.trim().toUpperCase() || "FL",
      status: values.status,
      notes: blank(values.notes),
    };

    setBusy(true);
    const result = editing
      ? await supabase.from("subcontractors").update(payload).eq("id", id!).select("id").single()
      : await supabase.from("subcontractors").insert(payload).select("id").single();
    setBusy(false);

    if (result.error || !result.data) {
      setError(t.subs.saveFailed);
      return;
    }
    navigate(`/subcontratistas/${result.data.id}`, { replace: editing });
  };

  const backTo = editing ? `/subcontratistas/${id}` : "/subcontratistas";
  const extraTrades = values.trades.filter((tr) => !(TRADE_KEYS as readonly string[]).includes(tr));

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {t.subs.notFound} <Link to="/subcontratistas">{t.subs.backToList}</Link>
        </p>
      </div>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {editing ? values.company_name || t.subs.one : t.subs.title}</Link>
      <PageHeader title={editing ? t.subs.editTitle : t.subs.newTitle} />

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.subs.sectionCompany}</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${nameError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="company_name">{t.subs.companyName}</label>
              <input
                id="company_name"
                className="gh-input"
                required
                autoFocus={!editing}
                value={values.company_name}
                onChange={(e) => set("company_name", e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "company_name-error" : undefined}
              />
              {nameError && <p className="gh-error" id="company_name-error">{nameError}</p>}
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="legal_name">{t.subs.legalName}</label>
              <input id="legal_name" className="gh-input" value={values.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
              <p className="gh-help">{t.subs.legalNameHelp}</p>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="status">{t.subs.status}</label>
              <select id="status" className="gh-input gh-select" value={values.status} onChange={(e) => set("status", e.target.value as SubStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t.subs.statuses[s]}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.subs.sectionTrades}</legend>
          <div className="chip-group" role="group" aria-label={t.subs.commonTrades}>
            {TRADE_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="chip"
                aria-pressed={values.trades.includes(key)}
                onClick={() => toggleTrade(key)}
              >
                {t.subs.trades[key]}
              </button>
            ))}
            {extraTrades.map((tr) => (
              <button key={tr} type="button" className="chip" aria-pressed onClick={() => toggleTrade(tr)} aria-label={t.subs.removeTrade(tradeLabel(tr, t))}>
                {tradeLabel(tr, t)} ×
              </button>
            ))}
          </div>
          <div className="gh-field trade-add">
            <label className="gh-field-label" htmlFor="trade-draft">{t.subs.otherTrade}</label>
            <div className="input-row">
              <input
                id="trade-draft"
                className="gh-input"
                placeholder={t.subs.otherTradePlaceholder}
                value={tradeDraft}
                onChange={(e) => setTradeDraft(e.target.value)}
                onKeyDown={onTradeKey}
              />
              <button className="gh-btn gh-btn-secondary" type="button" onClick={addDraftTrade} disabled={!tradeDraft.trim()}>
                {t.subs.add}
              </button>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.subs.sectionContact}</legend>
          <div className="form-grid">
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="contact_name">{t.subs.contactName}</label>
              <input id="contact_name" className="gh-input" autoComplete="off" value={values.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
            <div className={`gh-field${emailError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="email">{t.subs.email}</label>
              <input
                id="email"
                className="gh-input"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={values.email}
                onChange={(e) => set("email", e.target.value)}
                aria-invalid={!!emailError}
                aria-describedby={emailError ? "email-error" : undefined}
              />
              {emailError && <p className="gh-error" id="email-error">{emailError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="phone">{t.subs.phone}</label>
              <input id="phone" className="gh-input" type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="city">{t.subs.city}</label>
              <input id="city" className="gh-input" value={values.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="state">{t.subs.state}</label>
              <input id="state" className="gh-input" maxLength={2} value={values.state} onChange={(e) => set("state", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.subs.notes}</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">{t.subs.notes}</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">{t.subs.notesHelp}</p>
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
            {busy ? t.common.saving : editing ? t.subs.saveChanges : t.subs.create}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}
