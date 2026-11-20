import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  COMMON_TRADES,
  STATUS_LABEL,
  STATUSES,
  SUB_COLUMNS,
  type SubStatus,
  type Subcontractor,
} from "../../lib/subcontractors";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";

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
          trades: s.trades ?? [],
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

  const nameError = touched && !values.company_name.trim() ? "El nombre de la empresa es obligatorio." : null;
  const emailError = touched && values.email.trim() && !EMAIL_RE.test(values.email.trim()) ? "Revisa el formato del correo." : null;

  const toggleTrade = (trade: string) =>
    set("trades", values.trades.includes(trade) ? values.trades.filter((t) => t !== trade) : [...values.trades, trade]);

  const addDraftTrade = () => {
    const t = tradeDraft.trim();
    if (t && !values.trades.some((x) => x.toLowerCase() === t.toLowerCase())) set("trades", [...values.trades, t]);
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
      setError("No pudimos guardar los cambios. Inténtalo de nuevo.");
      return;
    }
    navigate(`/subcontratistas/${result.data.id}`, { replace: editing });
  };

  const backTo = editing ? `/subcontratistas/${id}` : "/subcontratistas";
  const extraTrades = values.trades.filter((t) => !COMMON_TRADES.includes(t));

  if (loading) return <p className="gh-muted" role="status">Cargando…</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          No encontramos este subcontratista. <Link to="/subcontratistas">Volver al directorio</Link>
        </p>
      </div>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {editing ? values.company_name || "Subcontratista" : "Subcontratistas"}</Link>
      <PageHeader eyebrow="Subcontratistas" title={editing ? "Editar subcontratista" : "Nuevo subcontratista"} />

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">Empresa</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${nameError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="company_name">Nombre comercial *</label>
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
              <label className="gh-field-label" htmlFor="legal_name">Razón social</label>
              <input id="legal_name" className="gh-input" value={values.legal_name} onChange={(e) => set("legal_name", e.target.value)} />
              <p className="gh-help">Como aparece en el W-9, si es distinta al nombre comercial.</p>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="status">Estado</label>
              <select id="status" className="gh-input gh-select" value={values.status} onChange={(e) => set("status", e.target.value as SubStatus)}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">Oficios</legend>
          <div className="chip-group" role="group" aria-label="Oficios frecuentes">
            {COMMON_TRADES.map((t) => (
              <button
                key={t}
                type="button"
                className="chip"
                aria-pressed={values.trades.includes(t)}
                onClick={() => toggleTrade(t)}
              >
                {t}
              </button>
            ))}
            {extraTrades.map((t) => (
              <button key={t} type="button" className="chip" aria-pressed onClick={() => toggleTrade(t)} aria-label={`Quitar ${t}`}>
                {t} ×
              </button>
            ))}
          </div>
          <div className="gh-field trade-add">
            <label className="gh-field-label" htmlFor="trade-draft">Otro oficio</label>
            <div className="input-row">
              <input
                id="trade-draft"
                className="gh-input"
                placeholder="Escribe y presiona Enter"
                value={tradeDraft}
                onChange={(e) => setTradeDraft(e.target.value)}
                onKeyDown={onTradeKey}
              />
              <button className="gh-btn gh-btn-secondary" type="button" onClick={addDraftTrade} disabled={!tradeDraft.trim()}>
                Agregar
              </button>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">Contacto</legend>
          <div className="form-grid">
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="contact_name">Persona de contacto</label>
              <input id="contact_name" className="gh-input" autoComplete="off" value={values.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
            <div className={`gh-field${emailError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="email">Correo</label>
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
              <label className="gh-field-label" htmlFor="phone">Teléfono</label>
              <input id="phone" className="gh-input" type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="city">Ciudad</label>
              <input id="city" className="gh-input" value={values.city} onChange={(e) => set("city", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="state">Estado (EE. UU.)</label>
              <input id="state" className="gh-input" maxLength={2} value={values.state} onChange={(e) => set("state", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">Notas</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">Notas</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">Visible solo para el equipo interno.</p>
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
            {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear subcontratista"}
          </button>
          <Link className="gh-link" to={backTo}>Cancelar</Link>
        </div>
      </form>
    </>
  );
}
