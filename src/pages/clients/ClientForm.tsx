import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { CLIENT_COLUMNS, CLIENT_TYPES, type Client, type ClientType } from "../../lib/sales";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

type Values = { name: string; type: ClientType; contact_name: string; email: string; phone: string; notes: string };
const EMPTY: Values = { name: "", type: "general_contractor", contact_name: "", email: "", phone: "", notes: "" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create (/clientes/nuevo) and edit (/clientes/:id/editar). */
export default function ClientForm() {
  const { id } = useParams();
  const editing = !!id;
  const t = useT();
  const navigate = useNavigate();
  const [values, setValues] = useState<Values>(EMPTY);
  const [loading, setLoading] = useState(editing);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    supabase
      .from("clients")
      .select(CLIENT_COLUMNS)
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error || !data) return setLoadFailed(true);
        const c = data as Client;
        setValues({
          name: c.name,
          type: c.type,
          contact_name: c.contact_name ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
          notes: c.notes ?? "",
        });
      });
    return () => {
      active = false;
    };
  }, [id]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const nameError = touched && !values.name.trim() ? t.sales.clientNameRequired : null;
  const emailError = touched && values.email.trim() && !EMAIL_RE.test(values.email.trim()) ? t.sales.emailInvalid : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!values.name.trim() || (values.email.trim() && !EMAIL_RE.test(values.email.trim()))) return;

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload = {
      name: values.name.trim(),
      type: values.type,
      contact_name: blank(values.contact_name),
      email: blank(values.email)?.toLowerCase() ?? null,
      phone: blank(values.phone),
      notes: blank(values.notes),
    };
    setBusy(true);
    const result = editing
      ? await supabase.from("clients").update(payload).eq("id", id!).select("id").single()
      : await supabase.from("clients").insert(payload).select("id").single();
    setBusy(false);
    if (result.error || !result.data) return setError(t.sales.saveFailed);
    navigate(`/clientes/${result.data.id}`, { replace: editing });
  };

  const backTo = editing ? `/clientes/${id}` : "/clientes";

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {t.sales.clientNotFound} <Link to="/clientes">{t.sales.clientsTitle}</Link>
        </p>
      </div>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {editing ? values.name || t.sales.clientOne : t.sales.clientsTitle}</Link>
      <PageHeader title={editing ? t.sales.editClientTitle : t.sales.newClientTitle} />

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.clientOne}</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${nameError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="name">{t.sales.clientName}</label>
              <input
                id="name"
                className="gh-input"
                autoFocus={!editing}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "name-error" : undefined}
              />
              {nameError && <p className="gh-error" id="name-error">{nameError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="type">{t.sales.type}</label>
              <select id="type" className="gh-input gh-select" value={values.type} onChange={(e) => set("type", e.target.value as ClientType)}>
                {CLIENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{t.sales.clientTypes[ct]}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.contact}</legend>
          <div className="form-grid">
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="contact_name">{t.sales.contactName}</label>
              <input id="contact_name" className="gh-input" autoComplete="off" value={values.contact_name} onChange={(e) => set("contact_name", e.target.value)} />
            </div>
            <div className={`gh-field${emailError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="email">{t.sales.email}</label>
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
              <label className="gh-field-label" htmlFor="phone">{t.sales.phone}</label>
              <input id="phone" className="gh-input" type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.notes}</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">{t.sales.notes}</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">{t.sales.notesHelp}</p>
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
            {busy ? t.common.saving : editing ? t.sales.saveChanges : t.sales.createClient}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}
