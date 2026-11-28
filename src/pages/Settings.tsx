import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { useT } from "../i18n";
import { PageHeader } from "../components/ui";
import { Panel } from "../components/Panel";
import { AlertCircleIcon, CheckCircleIcon } from "./Icons";

/** Mirrors public.app_settings (supabase/migrations/0007_settings.sql). */
type Settings = {
  website_lead_owner: string | null;
  digest_enabled: boolean;
  digest_hour: number;
  digest_muted: string[];
  expiry_days: number[];
  subs_alerts_enabled: boolean;
  default_markup_pct: number;
  proposal_show_lines: boolean;
  proposal_validity_days: number;
  proposal_terms: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_license: string | null;
  staff_lang: "es" | "en";
  posts_require_approval: boolean;
  meta_autopublish: boolean;
};
type TextKey = "proposal_terms" | "company_address" | "company_phone" | "company_email" | "company_license";
type Staff = { id: string; full_name: string | null; email: string | null; role: "super_admin" | "admin" };

const COLUMNS =
  "website_lead_owner, digest_enabled, digest_hour, digest_muted, expiry_days, subs_alerts_enabled, default_markup_pct, " +
  "proposal_show_lines, proposal_validity_days, proposal_terms, company_address, company_phone, company_email, company_license, staff_lang, posts_require_approval, meta_autopublish";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
const HOURS = [6, 7, 8, 9, 10, 11];
const DAY_OPTIONS = [60, 45, 30, 15, 7, 3, 1];

const normalize = (s: Settings): Settings => ({
  ...s,
  default_markup_pct: Number(s.default_markup_pct),
  proposal_validity_days: Number(s.proposal_validity_days),
  proposal_terms: blank(s.proposal_terms),
  company_address: blank(s.company_address),
  company_phone: blank(s.company_phone),
  company_email: blank(s.company_email),
  company_license: blank(s.company_license),
  digest_muted: [...s.digest_muted].sort(),
  expiry_days: [...s.expiry_days].sort((a, b) => b - a),
});
const same = (a: Settings, b: Settings) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

export default function SettingsPage() {
  const t = useT();
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const [meta, setMeta] = useState<{ busy: boolean; ok?: boolean; text?: string }>({ busy: false });

  /** Asks the publishing function whether the Meta token reaches the Page and Instagram. */
  const testMeta = async () => {
    setMeta({ busy: true });
    const { data, error } = await supabase.functions.invoke("social-publish", { body: { action: "status" } });
    const r = data as { ok?: boolean; page?: string; instagram?: string | null; error?: string } | null;
    if (error || !r) return setMeta({ busy: false, ok: false, text: t.settings.connectionFailed(t.content.publishNowFailed) });
    if (!r.ok) {
      const known = r.error && r.error in t.content.deliveryErrors ? t.content.deliveryErrors[r.error as keyof typeof t.content.deliveryErrors] : r.error ?? "";
      return setMeta({ busy: false, ok: false, text: t.settings.connectionFailed(known) });
    }
    setMeta({ busy: false, ok: !!r.instagram, text: t.settings.connected(r.page ?? "", r.instagram ?? null) });
  };

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("app_settings").select(COLUMNS).maybeSingle(),
      supabase.from("profiles").select("id, full_name, email, role").in("role", ["super_admin", "admin"]),
    ]);
    if (s.error || p.error || !s.data) {
      setFailed(true);
      return;
    }
    const settings = normalize(s.data as unknown as Settings);
    setSaved(settings);
    setForm(settings);
    const name = (x: Staff) => (x.full_name || x.email || "").toLowerCase();
    setStaff(((p.data ?? []) as Staff[]).sort((a, b) => name(a).localeCompare(name(b))));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dayOptions = useMemo(
    () => [...new Set([...DAY_OPTIONS, ...(saved?.expiry_days ?? [])])].sort((a, b) => b - a),
    [saved],
  );

  if (failed) {
    return (
      <>
        <PageHeader eyebrow={t.settings.eyebrow} title={t.nav.settings} description={t.settings.description} />
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{t.settings.loadFailed}</p>
        </div>
      </>
    );
  }
  if (!form || !saved) {
    return (
      <>
        <PageHeader eyebrow={t.settings.eyebrow} title={t.nav.settings} description={t.settings.description} />
        <p className="gh-muted" role="status">{t.common.loading}</p>
      </>
    );
  }

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setFlash(null);
    setForm({ ...form, [key]: value });
  };
  const who = (s: Staff) => s.full_name || s.email || "—";
  const ownerMissing = form.website_lead_owner !== null && !staff.some((s) => s.id === form.website_lead_owner);
  const daysError = form.expiry_days.length === 0 ? t.settings.daysRequired : null;
  const markupOk = Number.isFinite(form.default_markup_pct) && form.default_markup_pct >= 0 && form.default_markup_pct <= 500;
  const markupError = markupOk ? null : t.settings.markupInvalid;
  const validityOk = Number.isInteger(form.proposal_validity_days) && form.proposal_validity_days >= 1 && form.proposal_validity_days <= 365;
  const validityError = validityOk ? null : t.settings.validityInvalid;
  const emailError = form.company_email && form.company_email.trim() && !EMAIL_RE.test(form.company_email.trim()) ? t.settings.emailInvalid : null;
  const anyError = !!(daysError || markupError || validityError || emailError);
  const dirty = !same(form, saved);
  const text = (key: TextKey) => form[key] ?? "";

  const toggleDay = (d: number) =>
    set("expiry_days", form.expiry_days.includes(d) ? form.expiry_days.filter((x) => x !== d) : [...form.expiry_days, d]);
  const toggleMuted = (id: string) =>
    set("digest_muted", form.digest_muted.includes(id) ? form.digest_muted.filter((x) => x !== id) : [...form.digest_muted, id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (anyError || !dirty) return;
    setBusy(true);
    setFlash(null);
    const { data, error } = await supabase
      .from("app_settings")
      .update(normalize(form))
      .eq("id", true)
      .select(COLUMNS)
      .single();
    setBusy(false);
    if (error || !data) {
      setFlash({ ok: false, text: t.settings.saveFailed });
      return;
    }
    const next = normalize(data as unknown as Settings);
    setSaved(next);
    setForm(next);
    setFlash({ ok: true, text: t.settings.saved });
  };

  return (
    <>
      <PageHeader eyebrow={t.settings.eyebrow} title={t.nav.settings} description={t.settings.description} />

      <form className="settings" onSubmit={onSubmit} noValidate>
        <Panel title={t.settings.leadsTitle}>
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="settings-owner">{t.settings.owner}</label>
            <select
              id="settings-owner"
              className="gh-input gh-select"
              value={ownerMissing ? "" : form.website_lead_owner ?? ""}
              onChange={(e) => set("website_lead_owner", e.target.value || null)}
            >
              <option value="">{t.settings.noOwner}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{who(s)}</option>
              ))}
            </select>
            <p className="gh-help">{t.settings.ownerHelp}</p>
          </div>
        </Panel>

        <Panel title={t.settings.staffLangTitle}>
          <div className="gh-field settings-narrow">
            <label className="gh-field-label" htmlFor="settings-staff-lang">{t.settings.staffLang}</label>
            <select
              id="settings-staff-lang"
              className="gh-input gh-select"
              value={form.staff_lang}
              onChange={(e) => set("staff_lang", e.target.value === "en" ? "en" : "es")}
              aria-describedby="settings-staff-lang-help"
            >
              <option value="es">{t.prefs.langs.es}</option>
              <option value="en">{t.prefs.langs.en}</option>
            </select>
          </div>
          <p className="gh-help" id="settings-staff-lang-help">{t.settings.staffLangHelp}</p>
        </Panel>

        <Panel title={t.settings.digestTitle}>
          <label className="gh-check">
            <input type="checkbox" checked={form.digest_enabled} onChange={(e) => set("digest_enabled", e.target.checked)} />
            {t.settings.digestEnabled}
          </label>
          <div className="gh-field settings-narrow">
            <label className="gh-field-label" htmlFor="settings-hour">{t.settings.hour}</label>
            <select
              id="settings-hour"
              className="gh-input gh-select"
              value={form.digest_hour}
              disabled={!form.digest_enabled}
              onChange={(e) => set("digest_hour", Number(e.target.value))}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>{t.settings.hourLabel(h)}</option>
              ))}
            </select>
            <p className="gh-help">{t.settings.hourHelp}</p>
          </div>
          <fieldset className="settings-fieldset" disabled={!form.digest_enabled}>
            <legend className="gh-field-label">{t.settings.recipients}</legend>
            <div className="settings-checks">
              {staff.map((s) => (
                <label key={s.id} className="gh-check">
                  <input type="checkbox" checked={!form.digest_muted.includes(s.id)} onChange={() => toggleMuted(s.id)} />
                  <span>
                    {who(s)} <span className="gh-muted">· {t.roles[s.role]}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="gh-help">{t.settings.recipientsHelp}</p>
          </fieldset>
        </Panel>

        <Panel title={t.settings.expiryTitle}>
          <fieldset className={`settings-fieldset${daysError ? " is-error" : ""}`} aria-describedby="settings-days-help">
            <legend className="gh-field-label">{t.settings.days}</legend>
            <div className="settings-checks is-inline">
              {dayOptions.map((d) => (
                <label key={d} className="gh-check">
                  <input type="checkbox" checked={form.expiry_days.includes(d)} onChange={() => toggleDay(d)} />
                  {t.settings.dayLabel(d)}
                </label>
              ))}
            </div>
            {daysError ? (
              <p className="gh-error" role="alert">{daysError}</p>
            ) : (
              <p className="gh-help" id="settings-days-help">{t.settings.daysHelp(Math.min(...form.expiry_days))}</p>
            )}
          </fieldset>
        </Panel>

        <Panel title={t.settings.estimatesTitle}>
          <div className={`gh-field settings-narrow${markupError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="settings-markup">{t.settings.markup}</label>
            <div className="pct-input">
              <input
                id="settings-markup"
                className="gh-input"
                inputMode="decimal"
                value={Number.isNaN(form.default_markup_pct) ? "" : String(form.default_markup_pct)}
                onChange={(e) => set("default_markup_pct", e.target.value.trim() === "" ? NaN : Number(e.target.value.replace(",", ".")))}
                aria-invalid={!!markupError}
                aria-describedby="settings-markup-help"
              />
              <span aria-hidden="true">%</span>
            </div>
            {markupError ? (
              <p className="gh-error" id="settings-markup-help">{markupError}</p>
            ) : (
              <p className="gh-help" id="settings-markup-help">{t.settings.markupHelp}</p>
            )}
          </div>
        </Panel>

        <Panel title={t.settings.proposalTitle}>
          <label className="gh-check">
            <input type="checkbox" checked={form.proposal_show_lines} onChange={(e) => set("proposal_show_lines", e.target.checked)} />
            {t.settings.showLines}
          </label>
          <p className="gh-help">{t.settings.showLinesHelp}</p>
          <div className={`gh-field settings-narrow${validityError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="settings-validity">{t.settings.validity}</label>
            <input
              id="settings-validity"
              className="gh-input"
              inputMode="numeric"
              value={Number.isNaN(form.proposal_validity_days) ? "" : String(form.proposal_validity_days)}
              onChange={(e) => set("proposal_validity_days", e.target.value.trim() === "" ? NaN : Number(e.target.value))}
              aria-invalid={!!validityError}
              aria-describedby="settings-validity-help"
            />
            {validityError ? (
              <p className="gh-error" id="settings-validity-help">{validityError}</p>
            ) : (
              <p className="gh-help" id="settings-validity-help">{t.settings.validityHelp}</p>
            )}
          </div>
          <div className="form-grid">
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="settings-address">{t.settings.companyAddress}</label>
              <input id="settings-address" className="gh-input" maxLength={300} value={text("company_address")} onChange={(e) => set("company_address", e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="settings-phone">{t.settings.companyPhone}</label>
              <input id="settings-phone" className="gh-input" type="tel" maxLength={50} value={text("company_phone")} onChange={(e) => set("company_phone", e.target.value)} />
            </div>
            <div className={`gh-field${emailError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="settings-email">{t.settings.companyEmail}</label>
              <input
                id="settings-email"
                className="gh-input"
                type="email"
                maxLength={320}
                value={text("company_email")}
                onChange={(e) => set("company_email", e.target.value)}
                aria-invalid={!!emailError}
              />
              {emailError && <p className="gh-error">{emailError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="settings-license">{t.settings.companyLicense}</label>
              <input id="settings-license" className="gh-input" maxLength={100} value={text("company_license")} onChange={(e) => set("company_license", e.target.value)} />
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="settings-terms">{t.settings.terms}</label>
              <textarea
                id="settings-terms"
                className="gh-input"
                rows={6}
                maxLength={5000}
                placeholder={t.settings.termsPlaceholder}
                value={text("proposal_terms")}
                onChange={(e) => set("proposal_terms", e.target.value)}
                aria-describedby="settings-terms-help"
              />
              <p className="gh-help" id="settings-terms-help">{t.settings.termsHelp}</p>
            </div>
          </div>
        </Panel>

        <Panel title={t.settings.contentTitle}>
          <label className="gh-check">
            <input type="checkbox" checked={form.posts_require_approval} onChange={(e) => set("posts_require_approval", e.target.checked)} />
            {t.settings.approval}
          </label>
          <p className="gh-help">{t.settings.approvalHelp}</p>
          <label className="gh-check">
            <input type="checkbox" checked={form.meta_autopublish} onChange={(e) => set("meta_autopublish", e.target.checked)} />
            {t.settings.autopublish}
          </label>
          <p className="gh-help">{t.settings.autopublishHelp}</p>
          <div className="meta-test">
            <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={testMeta} disabled={meta.busy}>
              {meta.busy ? t.settings.testing : t.settings.testConnection}
            </button>
            {meta.text && (
              <p className={`gh-small meta-test-result ${meta.ok ? "is-ok" : "is-error"}`} role="status">{meta.text}</p>
            )}
          </div>
        </Panel>

        <Panel title={t.settings.subsTitle}>
          <label className="gh-check">
            <input type="checkbox" checked={form.subs_alerts_enabled} onChange={(e) => set("subs_alerts_enabled", e.target.checked)} />
            {t.settings.subsEnabled}
          </label>
          <p className="gh-help">{t.settings.subsHelp}</p>
        </Panel>

        {flash && (
          <div className={`gh-notice ${flash.ok ? "is-success" : "is-error"}`} role={flash.ok ? "status" : "alert"}>
            {flash.ok ? <CheckCircleIcon /> : <AlertCircleIcon />}
            <p>{flash.text}</p>
          </div>
        )}

        <div className="form-actions">
          <button className="gh-btn gh-btn-primary" type="submit" disabled={busy || !dirty || anyError}>
            {busy ? t.common.saving : t.common.save}
          </button>
          {dirty && !busy && (
            <button className="gh-link" type="button" onClick={() => { setForm(saved); setFlash(null); }}>
              {t.settings.discard}
            </button>
          )}
        </div>
      </form>
    </>
  );
}
