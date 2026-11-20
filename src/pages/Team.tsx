import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { type Role } from "../lib/roles";
import { formatDate } from "../lib/subcontractors";
import { useAuth } from "../auth/AuthProvider";
import { useT } from "../i18n";
import { PageHeader, Tag } from "../components/ui";
import { AlertCircleIcon, CheckCircleIcon, TrashIcon } from "./Icons";

const ROLES: Role[] = ["super_admin", "admin", "subcontractor"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FUNCTION = "admin-users";

type Profile = { id: string; full_name: string | null; email: string | null; role: Role; subcontractor_id: string | null };
type AuthUser = { id: string; email: string | null; invited_at: string | null; email_confirmed_at: string | null; last_sign_in_at: string | null };
type Company = { id: string; company_name: string };
/** One person: their account (when the admin function is available) and their profile (role), if any. */
type Person = { id: string; email: string | null; profile: Profile | null; account: AuthUser | null };

type Flash = { ok: boolean; text: string } | null;

/** Error code returned by the admin-users function, read from the HTTP error body. */
async function functionErrorCode(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const body = await ctx.json();
    return typeof body?.error === "string" ? body.error : null;
  } catch {
    return null;
  }
}

const resetRedirect = () => `${window.location.origin}/restablecer`;

export default function Team() {
  const t = useT();
  const { session } = useAuth();
  const myId = session?.user.id ?? null;

  const [people, setPeople] = useState<Person[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [failed, setFailed] = useState(false);
  const [fnAvailable, setFnAvailable] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  const load = useCallback(async () => {
    const [p, c, f] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, role, subcontractor_id"),
      supabase.from("subcontractors").select("id, company_name").order("company_name"),
      supabase.functions.invoke(FUNCTION, { body: { action: "list" } }),
    ]);
    if (p.error || c.error) {
      setFailed(true);
      return;
    }
    const profiles = (p.data ?? []) as Profile[];
    setCompanies((c.data ?? []) as Company[]);

    // Without the function we can still show who has a role.
    const accounts = f.error ? null : ((f.data?.users ?? []) as AuthUser[]);
    setFnAvailable(!f.error);

    const byId = new Map<string, Person>();
    for (const a of accounts ?? []) byId.set(a.id, { id: a.id, email: a.email, profile: null, account: a });
    for (const pr of profiles) {
      const existing = byId.get(pr.id);
      byId.set(pr.id, { id: pr.id, email: existing?.email ?? pr.email, profile: pr, account: existing?.account ?? null });
    }
    // Super admins, admins, subcontractors, then accounts with no role; by name within each group.
    const order = (x: Person) => (x.profile ? ROLES.indexOf(x.profile.role) : ROLES.length);
    const label = (x: Person) => (x.profile?.full_name || x.email || "").toLowerCase();
    setPeople([...byId.values()].sort((a, b) => order(a) - order(b) || label(a).localeCompare(label(b))));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const who = (p: Person) => p.profile?.full_name || p.email || "—";
  const companyName = (id: string | null) => companies.find((c) => c.id === id)?.company_name ?? null;

  const status = (p: Person): { text: string; tone: "muted" | "warn" | "danger" } => {
    if (!p.profile) return { text: t.team.statusNoRole, tone: "danger" };
    const a = p.account;
    if (!a) return { text: t.team.statusUnknown, tone: "muted" };
    if (a.last_sign_in_at) return { text: t.team.statusActive(formatDate(a.last_sign_in_at, t.locale)), tone: "muted" };
    if (a.invited_at) return { text: t.team.statusInvited(formatDate(a.invited_at, t.locale)), tone: "warn" };
    return { text: t.team.statusNeverSignedIn, tone: "warn" };
  };

  const resend = async (p: Person) => {
    if (!p.email) return;
    setBusyId(p.id);
    setFlash(null);
    const { error } = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: resetRedirect() });
    setBusyId(null);
    setFlash(error ? { ok: false, text: t.team.resendFailed } : { ok: true, text: t.team.resent(p.email) });
  };

  const remove = async (p: Person) => {
    setBusyId(p.id);
    setFlash(null);
    const { error } = await supabase.functions.invoke(FUNCTION, { body: { action: "delete", id: p.id } });
    setBusyId(null);
    setRemoving(null);
    if (error) {
      const code = await functionErrorCode(error);
      setFlash({
        ok: false,
        text: code === "last_super_admin" ? t.team.lastSuperAdmin : code === "self" ? t.team.cantRemoveSelf : t.team.removeFailed,
      });
      return;
    }
    setFlash({ ok: true, text: t.team.removed(who(p)) });
    await load();
  };

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.team.eyebrow} title={t.nav.team} description={t.team.description} />
        {fnAvailable && !inviting && people && (
          <button className="gh-btn gh-btn-primary" type="button" onClick={() => setInviting(true)}>
            {t.team.invite}
          </button>
        )}
      </div>

      {flash && (
        <div className={`gh-notice ${flash.ok ? "is-success" : "is-error"} team-flash`} role={flash.ok ? "status" : "alert"}>
          {flash.ok ? <CheckCircleIcon /> : <AlertCircleIcon />}
          <p>{flash.text}</p>
        </div>
      )}

      {!fnAvailable && people && (
        <div className="gh-notice team-flash" role="status">
          <AlertCircleIcon />
          <p>{t.team.functionMissing}</p>
        </div>
      )}

      {inviting && (
        <InviteForm
          companies={companies}
          onCancel={() => setInviting(false)}
          onDone={async (email) => {
            setInviting(false);
            setFlash({ ok: true, text: t.team.invited(email) });
            await load();
          }}
        />
      )}

      {failed ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{t.team.loadFailed}</p>
        </div>
      ) : !people ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : (
        <div className="table-wrap">
          <table className="gh-table team-table">
            <thead>
              <tr>
                <th scope="col">{t.team.name}</th>
                <th scope="col">{t.team.role}</th>
                <th scope="col">{t.team.status}</th>
                <th scope="col"><span className="visually-hidden">{t.common.edit}</span></th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const s = status(p);
                const isMe = p.id === myId;
                return (
                  <Fragment key={p.id}>
                    <tr className={editing === p.id || removing === p.id ? "is-open" : undefined}>
                      <td className="col-company">
                        <span className="team-name">
                          {who(p)}
                          {isMe && <Tag tone="neutral">{t.team.you}</Tag>}
                        </span>
                        {p.profile?.full_name && p.email && <span className="cell-sub">{p.email}</span>}
                      </td>
                      <td>
                        {p.profile ? (
                          <>
                            <Tag tone={p.profile.role === "super_admin" ? "strong" : "neutral"}>{t.roles[p.profile.role]}</Tag>
                            {p.profile.role === "subcontractor" && (
                              <span className="cell-sub">{companyName(p.profile.subcontractor_id) ?? "—"}</span>
                            )}
                          </>
                        ) : (
                          <span className="gh-muted">—</span>
                        )}
                      </td>
                      <td className={`team-status is-${s.tone}`}>{s.text}</td>
                      <td className="row-actions">
                        <button className="text-btn" type="button" onClick={() => { setRemoving(null); setEditing(editing === p.id ? null : p.id); }}>
                          {p.profile ? t.team.edit : t.team.assignRole}
                        </button>
                        {p.email && p.profile && (
                          <button className="text-btn" type="button" disabled={busyId === p.id} onClick={() => resend(p)} aria-label={t.team.resendLabel(who(p))}>
                            {t.team.resend}
                          </button>
                        )}
                        {fnAvailable && !isMe && (
                          <button className="text-btn is-danger" type="button" onClick={() => { setEditing(null); setRemoving(removing === p.id ? null : p.id); }}>
                            {t.team.remove}
                          </button>
                        )}
                      </td>
                    </tr>
                    {editing === p.id && (
                      <tr className="team-detail">
                        <td colSpan={4}>
                          <RoleEditor
                            person={p}
                            companies={companies}
                            onCancel={() => setEditing(null)}
                            onDone={async () => {
                              setEditing(null);
                              setFlash({ ok: true, text: t.team.roleSaved });
                              await load();
                            }}
                          />
                        </td>
                      </tr>
                    )}
                    {removing === p.id && (
                      <tr className="team-detail">
                        <td colSpan={4}>
                          <div className="confirm-box">
                            <p>{t.team.removeConfirm(who(p))}</p>
                            <div className="form-actions">
                              <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" disabled={busyId === p.id} onClick={() => remove(p)}>
                                {busyId !== p.id && <TrashIcon />}
                                {busyId === p.id ? t.team.removing : t.team.removeForever}
                              </button>
                              <button className="gh-link" type="button" onClick={() => setRemoving(null)}>{t.common.cancel}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {fnAvailable && <p className="gh-small gh-muted team-note">{t.team.rateLimitNote}</p>}
    </>
  );
}

/** Role and, for subcontractors, their company. Shared by the invite form and the role editor. */
function RoleFields({
  idPrefix,
  role,
  companyId,
  companies,
  companyError,
  onRole,
  onCompany,
}: {
  idPrefix: string;
  role: Role;
  companyId: string;
  companies: Company[];
  companyError: string | null;
  onRole: (r: Role) => void;
  onCompany: (id: string) => void;
}) {
  const t = useT();
  return (
    <>
      <div className="gh-field">
        <label className="gh-field-label" htmlFor={`${idPrefix}-role`}>{t.team.role}</label>
        <select id={`${idPrefix}-role`} className="gh-input gh-select" value={role} onChange={(e) => onRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>{t.roles[r]}</option>
          ))}
        </select>
        <p className="gh-help">{t.team.roleHelp[role]}</p>
      </div>
      {role === "subcontractor" && (
        <div className={`gh-field${companyError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor={`${idPrefix}-company`}>{t.team.company}</label>
          <select
            id={`${idPrefix}-company`}
            className="gh-input gh-select"
            value={companyId}
            onChange={(e) => onCompany(e.target.value)}
            aria-invalid={!!companyError}
            aria-describedby={companyError ? `${idPrefix}-company-error` : undefined}
          >
            <option value="">{t.team.chooseCompany}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
          {companyError && <p className="gh-error" id={`${idPrefix}-company-error`}>{companyError}</p>}
        </div>
      )}
    </>
  );
}

function InviteForm({ companies, onCancel, onDone }: { companies: Company[]; onCancel: () => void; onDone: (email: string) => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [companyId, setCompanyId] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameError = touched && !name.trim() ? t.team.nameRequired : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? t.team.emailInvalid : null;
  const companyError = touched && role === "subcontractor" && !companyId ? t.team.companyRequired : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || (role === "subcontractor" && !companyId)) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke(FUNCTION, {
      body: {
        action: "invite",
        email: email.trim().toLowerCase(),
        full_name: name.trim(),
        role,
        subcontractor_id: role === "subcontractor" ? companyId : null,
        redirect_to: resetRedirect(),
      },
    });
    setBusy(false);
    if (error) {
      const code = await functionErrorCode(error);
      return setError(code === "exists" ? t.team.inviteExists : code === "invalid_email" ? t.team.emailInvalid : t.team.inviteFailed);
    }
    onDone(email.trim().toLowerCase());
  };

  return (
    <form className="upload-form team-invite" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className={`gh-field${nameError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="invite-name">{t.team.name}</label>
          <input
            id="invite-name"
            className="gh-input"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "invite-name-error" : undefined}
          />
          {nameError && <p className="gh-error" id="invite-name-error">{nameError}</p>}
        </div>
        <div className={`gh-field${emailError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="invite-email">{t.team.email}</label>
          <input
            id="invite-email"
            className="gh-input"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!emailError}
            aria-describedby={emailError ? "invite-email-error" : undefined}
          />
          {emailError && <p className="gh-error" id="invite-email-error">{emailError}</p>}
        </div>
        <RoleFields
          idPrefix="invite"
          role={role}
          companyId={companyId}
          companies={companies}
          companyError={companyError}
          onRole={setRole}
          onCompany={setCompanyId}
        />
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.team.sending : t.team.sendInvite}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}

function RoleEditor({ person, companies, onCancel, onDone }: { person: Person; companies: Company[]; onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const [role, setRole] = useState<Role>(person.profile?.role ?? "admin");
  const [companyId, setCompanyId] = useState(person.profile?.subcontractor_id ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyError = touched && role === "subcontractor" && !companyId ? t.team.companyRequired : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (role === "subcontractor" && !companyId) return;
    // The database requires a company for subcontractors and none for staff.
    const change = { role, subcontractor_id: role === "subcontractor" ? companyId : null };
    setBusy(true);
    const { error } = person.profile
      ? await supabase.from("profiles").update(change).eq("id", person.id)
      : await supabase.from("profiles").insert({ id: person.id, email: person.email, ...change });
    setBusy(false);
    if (error) return setError(/super admin/i.test(error.message) ? t.team.lastSuperAdmin : t.team.roleFailed);
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <RoleFields
          idPrefix={`edit-${person.id}`}
          role={role}
          companyId={companyId}
          companies={companies}
          companyError={companyError}
          onRole={setRole}
          onCompany={setCompanyId}
        />
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.team.saveRole}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
