import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { LEAD_COLUMNS, LEAD_SOURCES, ownerName, type Lead, type LeadSource } from "../../lib/leads";
import { useAuth } from "../../auth/AuthProvider";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useOwners } from "./leadShared";
import { useT } from "../../i18n";

type Values = {
  name: string;
  company: string;
  email: string;
  phone: string;
  source: LeadSource;
  owner_id: string;
  interest: string;
  location: string;
  next_follow_up: string;
  notes: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Create (/leads/nuevo) and edit (/leads/:id/editar). A new lead is owned by whoever creates it. */
export default function LeadForm() {
  const { id } = useParams();
  const editing = !!id;
  const t = useT();
  const navigate = useNavigate();
  const { session } = useAuth();
  const owners = useOwners();

  const [values, setValues] = useState<Values>({
    name: "",
    company: "",
    email: "",
    phone: "",
    source: "website",
    owner_id: session?.user.id ?? "",
    interest: "",
    location: "",
    next_follow_up: "",
    notes: "",
  });
  const [loading, setLoading] = useState(editing);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        setLoading(false);
        if (error || !data) return setLoadFailed(true);
        const l = data as Lead;
        setValues({
          name: l.name,
          company: l.company ?? "",
          email: l.email ?? "",
          phone: l.phone ?? "",
          source: l.source,
          owner_id: l.owner_id ?? "",
          interest: l.interest ?? "",
          location: l.location ?? "",
          next_follow_up: l.next_follow_up ?? "",
          notes: l.notes ?? "",
        });
      });
    return () => {
      active = false;
    };
  }, [id]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const nameError = touched && !values.name.trim() ? t.leads.nameRequired : null;
  const emailError = touched && values.email.trim() && !EMAIL_RE.test(values.email.trim()) ? t.leads.emailInvalid : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!values.name.trim() || (values.email.trim() && !EMAIL_RE.test(values.email.trim()))) return;

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload = {
      name: values.name.trim(),
      company: blank(values.company),
      email: blank(values.email)?.toLowerCase() ?? null,
      phone: blank(values.phone),
      source: values.source,
      owner_id: values.owner_id || null,
      interest: blank(values.interest),
      location: blank(values.location),
      next_follow_up: values.next_follow_up || null,
      notes: blank(values.notes),
    };
    setBusy(true);
    const result = editing
      ? await supabase.from("leads").update(payload).eq("id", id!).select("id").single()
      : await supabase.from("leads").insert(payload).select("id").single();
    setBusy(false);
    if (result.error || !result.data) return setError(t.leads.saveFailed);
    navigate(`/leads/${result.data.id}`, { replace: editing });
  };

  const backTo = editing ? `/leads/${id}` : "/leads";

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {t.leads.notFound} <Link to="/leads">{t.leads.title}</Link>
        </p>
      </div>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {editing ? values.name || t.leads.one : t.leads.title}</Link>
      <PageHeader title={editing ? t.leads.editTitle : t.leads.newTitle} />

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.sectionContact}</legend>
          <div className="form-grid">
            <div className={`gh-field${nameError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="name">{t.leads.name}</label>
              <input
                id="name"
                className="gh-input"
                autoFocus={!editing}
                autoComplete="off"
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? "name-error" : undefined}
              />
              {nameError && <p className="gh-error" id="name-error">{nameError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="company">{t.leads.company}</label>
              <input id="company" className="gh-input" autoComplete="off" value={values.company} onChange={(e) => set("company", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="phone">{t.leads.phone}</label>
              <input id="phone" className="gh-input" type="tel" inputMode="tel" autoComplete="off" value={values.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className={`gh-field${emailError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="email">{t.leads.email}</label>
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
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.sectionOpportunity}</legend>
          <div className="form-grid">
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="source">{t.leads.source}</label>
              <select id="source" className="gh-input gh-select" value={values.source} onChange={(e) => set("source", e.target.value as LeadSource)}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>{t.leads.sources[s]}</option>
                ))}
              </select>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="location">{t.leads.location}</label>
              <input id="location" className="gh-input" value={values.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="interest">{t.leads.interest}</label>
              <textarea
                id="interest"
                className="gh-input gh-textarea"
                rows={3}
                placeholder={t.leads.interestPlaceholder}
                value={values.interest}
                onChange={(e) => set("interest", e.target.value)}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.sectionFollowUp}</legend>
          <div className="form-grid">
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="owner_id">{t.leads.owner}</label>
              <select id="owner_id" className="gh-input gh-select" value={values.owner_id} onChange={(e) => set("owner_id", e.target.value)}>
                <option value="">{t.leads.unassigned}</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>{ownerName(o)}</option>
                ))}
              </select>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="next_follow_up">{t.leads.nextFollowUp}</label>
              <input id="next_follow_up" className="gh-input" type="date" value={values.next_follow_up} onChange={(e) => set("next_follow_up", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.notes}</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">{t.leads.notes}</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">{t.leads.notesHelp}</p>
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
            {busy ? t.common.saving : editing ? t.leads.saveChanges : t.leads.create}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}
