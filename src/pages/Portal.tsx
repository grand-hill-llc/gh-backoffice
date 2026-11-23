import { useCallback, useEffect, useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import {
  complianceOf,
  DOCS_BUCKET,
  fileNameOf,
  formatDate,
  REQUIRED_DOCS,
  storagePathFor,
  todayISO,
  validityOf,
  type DocType,
  type ReviewStatus,
} from "../lib/subcontractors";
import { formatMoney } from "../lib/sales";
import type { ProjectStatus } from "../lib/projects";
import { Facts, mailHref, Panel, telHref } from "../components/Panel";
import { PageHeader, Tag } from "../components/ui";
import { AlertCircleIcon, CheckCircleIcon } from "./Icons";
import { ProjectStatusTag } from "./projects/projectTags";
import { ValidityTag } from "./subcontractors/tags";
import { tradeLabel, useT } from "../i18n";

// Everything here comes from the portal_* database functions, which only return this
// company's data and never include internal notes, contracts, margins or clients.
type Company = {
  id: string;
  company_name: string;
  legal_name: string | null;
  trades: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
};
type PortalDoc = {
  id: string;
  doc_type: DocType;
  file_path: string | null;
  issued_on: string | null;
  expires_on: string | null;
  review_status: ReviewStatus;
  rejection_reason: string | null;
  created_at: string;
};
type Payment = { id: string; occurred_on: string; amount: number; reference: string | null };
type Job = {
  id: string;
  project_name: string;
  location: string | null;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  trade: string | null;
  agreed_amount: number | null;
  payments: Payment[];
};
type Flash = { ok: boolean; text: string } | null;

const MAX_BYTES = 20 * 1024 * 1024;
const UPLOAD_TYPES: DocType[] = ["coi", "w9", "license"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Portal() {
  const t = useT();
  const [company, setCompany] = useState<Company | null>(null);
  const [docs, setDocs] = useState<PortalDoc[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);

  const loadDocs = useCallback(async () => {
    const { data, error } = await supabase.rpc("portal_documents");
    if (error) throw error;
    setDocs((data ?? []) as PortalDoc[]);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const [c, d, j] = await Promise.all([supabase.rpc("portal_company"), supabase.rpc("portal_documents"), supabase.rpc("portal_assignments")]);
      if (!active) return;
      const err = c.error ?? d.error ?? j.error;
      if (err) return setState(/could not find the function/i.test(err.message) ? "missing" : "error");
      setCompany(c.data as Company);
      setDocs((d.data ?? []) as PortalDoc[]);
      setJobs((j.data ?? []) as Job[]);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, []);

  const openFile = async (path: string) => {
    setFlash(null);
    const tab = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120);
    if (error || !data) {
      tab?.close();
      setFlash({ ok: false, text: t.subs.openFailed });
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !company)
    return (
      <>
        <PageHeader eyebrow={t.portal.eyebrow} title={t.portal.fallbackTitle} />
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.portal.missingMigration : t.portal.loadFailed}</p>
        </div>
      </>
    );

  const compliance = complianceOf(docs.filter((d) => d.review_status === "approved"));
  const pendingTypes = new Set(docs.filter((d) => d.review_status === "pending").map((d) => d.doc_type));
  const location = [company.city, company.state].filter(Boolean).join(", ");

  return (
    <>
      <PageHeader eyebrow={t.portal.eyebrow} title={company.company_name} description={t.portal.description} />

      {flash && (
        <div className={`gh-notice ${flash.ok ? "is-success" : "is-error"} portal-notice`} role={flash.ok ? "status" : "alert"}>
          {flash.ok ? <CheckCircleIcon /> : <AlertCircleIcon />}
          <p>{flash.text}</p>
        </div>
      )}

      <section className="compliance-grid" aria-label={t.subs.requiredDocs}>
        {REQUIRED_DOCS.map((type) => {
          const level = compliance.byType[type];
          return (
            <div key={type} className={`compliance-card is-${level}`}>
              <p className="gh-label">{t.subs.docTypes[type]}</p>
              <p className="compliance-state">{t.subs.docState[level]}</p>
              {pendingTypes.has(type) && <p className="gh-small gh-muted">{t.portal.inReview}</p>}
            </div>
          );
        })}
      </section>

      <div className="detail-grid">
        <Panel
          title={t.portal.company}
          action={
            !editing && (
              <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setEditing(true)}>
                {t.portal.editContact}
              </button>
            )
          }
        >
          {editing ? (
            <ContactForm
              company={company}
              onCancel={() => setEditing(false)}
              onSaved={(updated) => {
                setCompany(updated);
                setEditing(false);
                setFlash({ ok: true, text: t.portal.contactSaved });
              }}
            />
          ) : (
            <Facts
              items={[
                { label: t.portal.legalName, value: company.legal_name },
                { label: t.portal.contactName, value: company.contact_name },
                { label: t.portal.email, value: company.email, href: mailHref(company.email) },
                { label: t.portal.phone, value: company.phone, href: telHref(company.phone) },
                { label: t.portal.location, value: location },
                { label: t.portal.trades, value: company.trades.map((x) => tradeLabel(x, t)).join(", ") },
              ]}
            />
          )}
          <p className="gh-small gh-muted" style={{ margin: 0 }}>{t.portal.otherChanges}</p>
        </Panel>

        <Panel
          title={t.portal.documents}
          action={
            !uploading && (
              <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setUploading(true)}>
                {t.portal.upload}
              </button>
            )
          }
        >
          {uploading && (
            <UploadForm
              companyId={company.id}
              pendingTypes={pendingTypes}
              onCancel={() => setUploading(false)}
              onDone={async () => {
                setUploading(false);
                setFlash({ ok: true, text: t.portal.submitted });
                try {
                  await loadDocs();
                } catch {
                  setFlash({ ok: false, text: t.portal.loadFailed });
                }
              }}
            />
          )}
          {docs.length === 0 ? (
            !uploading && <p className="panel-empty">{t.portal.noDocuments}</p>
          ) : (
            <ul className="doc-list">
              {docs.map((d) => (
                <li key={d.id} className="doc-item">
                  <div className="doc-main">
                    <p className="doc-type">{t.subs.docTypes[d.doc_type]}</p>
                    <p className="gh-small gh-muted">
                      {d.expires_on ? t.subs.expiresOn(formatDate(d.expires_on, t.locale)) : t.subs.noExpiry}
                      {d.issued_on && ` · ${t.subs.issuedOn(formatDate(d.issued_on, t.locale))}`}
                    </p>
                    {d.review_status === "rejected" && (
                      <p className="gh-small doc-notes">
                        {d.rejection_reason ? `${t.portal.rejectedReason(d.rejection_reason)} ` : ""}
                        {t.portal.uploadAgain}
                      </p>
                    )}
                  </div>
                  <div className="doc-side">
                    {d.review_status === "pending" ? (
                      <Tag tone="warning">{t.portal.inReview}</Tag>
                    ) : d.review_status === "rejected" ? (
                      <Tag tone="danger">{t.portal.rejected}</Tag>
                    ) : (
                      <ValidityTag validity={validityOf(d.expires_on)} />
                    )}
                    {d.file_path && (
                      <div className="doc-actions">
                        <button className="text-btn" type="button" onClick={() => openFile(d.file_path!)} title={fileNameOf(d.file_path)}>
                          {t.subs.viewFile}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="detail-stack">
        <Panel title={t.portal.jobs}>
          {jobs.length === 0 ? (
            <p className="panel-empty">{t.portal.noJobs}</p>
          ) : (
            <div className="portal-jobs">
              {jobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function JobCard({ job }: { job: Job }) {
  const t = useT();
  const money = (v: number | null) => formatMoney(v, t.locale);
  const paid = job.payments.reduce((s, p) => s + Number(p.amount), 0);
  const dates = [job.start_date, job.end_date].filter(Boolean).map((d) => formatDate(d, t.locale)).join(" – ");
  const meta = [job.trade, job.location, dates].filter(Boolean).join(" · ");

  return (
    <article className="portal-job">
      <div className="portal-job-head">
        <div>
          <h3>{job.project_name}</h3>
          {meta && <p className="gh-small gh-muted">{meta}</p>}
        </div>
        <ProjectStatusTag status={job.status} />
      </div>
      <dl className="portal-money">
        <div>
          <dt className="gh-label">{t.portal.agreed}</dt>
          <dd>{money(job.agreed_amount)}</dd>
        </div>
        <div>
          <dt className="gh-label">{t.portal.paid}</dt>
          <dd>{money(paid)}</dd>
        </div>
        <div>
          <dt className="gh-label">{t.portal.pending}</dt>
          <dd>{job.agreed_amount === null ? "—" : money(Math.max(0, Number(job.agreed_amount) - paid))}</dd>
        </div>
      </dl>
      {job.payments.length === 0 ? (
        <p className="gh-small gh-muted" style={{ margin: 0 }}>{t.portal.noPayments}</p>
      ) : (
        <ul className="portal-payments" aria-label={t.portal.payments}>
          {job.payments.map((p) => (
            <li key={p.id}>
              <span>
                {formatDate(p.occurred_on, t.locale)}
                {p.reference && <span className="gh-muted"> · {p.reference}</span>}
              </span>
              <span>{money(Number(p.amount))}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function ContactForm({ company, onCancel, onSaved }: { company: Company; onCancel: () => void; onSaved: (c: Company) => void }) {
  const t = useT();
  const [name, setName] = useState(company.contact_name ?? "");
  const [email, setEmail] = useState(company.email ?? "");
  const [phone, setPhone] = useState(company.phone ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailError = touched && email.trim() && !EMAIL_RE.test(email.trim()) ? t.portal.emailInvalid : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (email.trim() && !EMAIL_RE.test(email.trim())) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("portal_update_contact", { p_contact_name: name, p_email: email, p_phone: phone });
    setBusy(false);
    if (error || !data) return setError(t.portal.contactFailed);
    onSaved(data as Company);
  };

  return (
    <form className="gh-form" onSubmit={onSubmit} noValidate>
      <div className="gh-field">
        <label className="gh-field-label" htmlFor="portal-contact">{t.portal.contactName}</label>
        <input id="portal-contact" className="gh-input" autoComplete="name" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className={`gh-field${emailError ? " is-error" : ""}`}>
        <label className="gh-field-label" htmlFor="portal-email">{t.portal.email}</label>
        <input
          id="portal-email"
          className="gh-input"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? "portal-email-error" : undefined}
        />
        {emailError && <p className="gh-error" id="portal-email-error">{emailError}</p>}
      </div>
      <div className="gh-field">
        <label className="gh-field-label" htmlFor="portal-phone">{t.portal.phone}</label>
        <input id="portal-phone" className="gh-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={50} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : t.portal.saveContact}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}

function UploadForm({
  companyId,
  pendingTypes,
  onCancel,
  onDone,
}: {
  companyId: string;
  pendingTypes: Set<DocType>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const [docType, setDocType] = useState<DocType>(UPLOAD_TYPES.find((x) => !pendingTypes.has(x)) ?? "coi");
  const [file, setFile] = useState<File | null>(null);
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsExpiry = docType === "coi" || docType === "license";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Checked before uploading: a subcontractor can't delete a file once it's in storage.
    if (pendingTypes.has(docType)) return setError(t.portal.alreadyPending);
    if (!file) return setError(t.portal.pickFile);
    if (file.size > MAX_BYTES) return setError(t.portal.fileTooBig);
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) return setError(t.portal.fileType);
    if (needsExpiry && !expiresOn) return setError(t.portal.expiresRequired);
    if (expiresOn && expiresOn < todayISO()) return setError(t.portal.alreadyExpired);
    if (issuedOn && expiresOn && expiresOn < issuedOn) return setError(t.portal.datesInvalid);

    setBusy(true);
    const path = storagePathFor(companyId, file.name);
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
    if (up.error) {
      setBusy(false);
      return setError(t.portal.uploadFailed);
    }
    const { error } = await supabase.rpc("portal_submit_document", {
      p_doc_type: docType,
      p_file_path: path,
      p_issued_on: issuedOn || null,
      p_expires_on: expiresOn || null,
    });
    setBusy(false);
    if (error) {
      const m = error.message;
      return setError(
        /already_pending/.test(m)
          ? t.portal.alreadyPending
          : /already_expired/.test(m)
            ? t.portal.alreadyExpired
            : /expiry_required/.test(m)
              ? t.portal.expiresRequired
              : /invalid_dates/.test(m)
                ? t.portal.datesInvalid
                : t.portal.uploadFailed
      );
    }
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="portal-doc-type">{t.portal.docType}</label>
          <select id="portal-doc-type" className="gh-input gh-select" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {UPLOAD_TYPES.map((d) => (
              <option key={d} value={d}>{t.subs.docTypes[d]}</option>
            ))}
          </select>
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="portal-doc-file">{t.portal.file}</label>
          <input
            id="portal-doc-file"
            className="gh-input gh-file"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="gh-help">{t.portal.fileHelp}</p>
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="portal-doc-issued">{t.portal.issued}</label>
          <input id="portal-doc-issued" className="gh-input" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="portal-doc-expires">
            {t.portal.expires}{needsExpiry ? " *" : ""}
          </label>
          <input id="portal-doc-expires" className="gh-input" type="date" min={issuedOn || undefined} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </div>
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.portal.uploading : t.portal.submit}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
