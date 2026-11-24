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
};
type Staff = { id: string; full_name: string | null; email: string | null; role: "super_admin" | "admin" };

const COLUMNS = "website_lead_owner, digest_enabled, digest_hour, digest_muted, expiry_days, subs_alerts_enabled";
const HOURS = [6, 7, 8, 9, 10, 11];
const DAY_OPTIONS = [60, 45, 30, 15, 7, 3, 1];

const normalize = (s: Settings): Settings => ({
  ...s,
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

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      supabase.from("app_settings").select(COLUMNS).maybeSingle(),
      supabase.from("profiles").select("id, full_name, email, role").in("role", ["super_admin", "admin"]),
    ]);
    if (s.error || p.error || !s.data) {
      setFailed(true);
      return;
    }
    const settings = normalize(s.data as Settings);
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
  const dirty = !same(form, saved);

  const toggleDay = (d: number) =>
    set("expiry_days", form.expiry_days.includes(d) ? form.expiry_days.filter((x) => x !== d) : [...form.expiry_days, d]);
  const toggleMuted = (id: string) =>
    set("digest_muted", form.digest_muted.includes(id) ? form.digest_muted.filter((x) => x !== id) : [...form.digest_muted, id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (daysError || !dirty) return;
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
    const next = normalize(data as Settings);
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
          <button className="gh-btn gh-btn-primary" type="submit" disabled={busy || !dirty || !!daysError}>
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
