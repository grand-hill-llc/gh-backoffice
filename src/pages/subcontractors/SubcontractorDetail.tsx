import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  complianceOf,
  DOCS_BUCKET,
  formatDate,
  REQUIRED_DOCS,
  SUB_COLUMNS,
  type SubDocument,
  type Subcontractor,
} from "../../lib/subcontractors";
import { AlertCircleIcon } from "../Icons";
import { ComplianceTag, StatusTag } from "./tags";
import DocumentsSection from "./DocumentsSection";
import { tradeLabel, useT } from "../../i18n";

export default function SubcontractorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const [sub, setSub] = useState<Subcontractor | null>(null);
  const [docs, setDocs] = useState<SubDocument[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    const { data, error } = await supabase
      .from("subcontractor_documents")
      .select("id, subcontractor_id, doc_type, file_path, issued_on, expires_on, notes, created_at")
      .eq("subcontractor_id", id!)
      .order("expires_on", { ascending: false, nullsFirst: true });
    if (!error) setDocs((data ?? []) as SubDocument[]);
    return !error;
  }, [id]);

  useEffect(() => {
    let active = true;
    (async () => {
      const [s, docsOk] = await Promise.all([
        supabase.from("subcontractors").select(SUB_COLUMNS).eq("id", id!).maybeSingle(),
        loadDocs(),
      ]);
      if (!active) return;
      if (s.error || !docsOk) setState("error");
      else if (!s.data) setState("missing");
      else {
        setSub(s.data as Subcontractor);
        setState("ready");
      }
    })();
    return () => {
      active = false;
    };
  }, [id, loadDocs]);

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("subcontractors").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      setDeleteError(
        /profiles|violates/i.test(error.message)
          ? t.subs.deleteBlocked
          : t.subs.deleteFailed
      );
      return;
    }
    // Rows are gone (cascade); clean up their files. A failure here only leaves orphaned files.
    const paths = docs.map((d) => d.file_path).filter((p): p is string => !!p);
    if (paths.length) await supabase.storage.from(DOCS_BUCKET).remove(paths);
    navigate("/subcontratistas", { replace: true });
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !sub)
    return (
      <>
        <Link className="back-link" to="/subcontratistas">← {t.subs.title}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.subs.notFound : t.subs.loadOneFailed}</p>
        </div>
      </>
    );

  const compliance = complianceOf(docs);
  const location = [sub.city, sub.state].filter(Boolean).join(", ");

  return (
    <>
      <Link className="back-link" to="/subcontratistas">← {t.subs.title}</Link>

      <header className="page-header detail-header">
        <div className="detail-title-row">
          <h1 className="gh-h2">{sub.company_name}</h1>
          <div className="detail-actions">
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/subcontratistas/${sub.id}/editar`}>{t.common.edit}</Link>
          </div>
        </div>
        <div className="detail-meta">
          <StatusTag status={sub.status} />
          <ComplianceTag level={compliance.level} />
          {sub.trades.length > 0 && <span className="gh-small gh-muted">{sub.trades.map((tr) => tradeLabel(tr, t)).join(" · ")}</span>}
        </div>
      </header>

      <section className="compliance-grid" aria-label={t.subs.requiredDocs}>
        {REQUIRED_DOCS.map((type) => {
          const level = compliance.byType[type];
          return (
            <div key={type} className={`compliance-card is-${level}`}>
              <p className="gh-label">{t.subs.docTypes[type]}</p>
              <p className="compliance-state">{t.subs.docState[level]}</p>
            </div>
          );
        })}
      </section>

      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title gh-label">{t.subs.details}</h2>
          <dl className="facts">
            <Fact label={t.subs.legalName} value={sub.legal_name} />
            <Fact label={t.subs.contact} value={sub.contact_name} />
            <Fact label={t.subs.email} value={sub.email} href={sub.email ? `mailto:${sub.email}` : undefined} />
            <Fact label={t.subs.phone} value={sub.phone} href={sub.phone ? `tel:${sub.phone.replace(/[^\d+]/g, "")}` : undefined} />
            <Fact label={t.subs.location} value={location} />
            <Fact label={t.subs.createdOn} value={formatDate(sub.created_at, t.locale)} />
          </dl>
          {sub.notes && (
            <>
              <h3 className="gh-label facts-notes-label">{t.subs.notes}</h3>
              <p className="facts-notes">{sub.notes}</p>
            </>
          )}
        </section>

        <DocumentsSection subId={sub.id} docs={docs} onChange={loadDocs} />
      </div>

      <section className="danger-zone">
        {!confirmDelete ? (
          <button className="gh-link danger-link" type="button" onClick={() => setConfirmDelete(true)}>
            {t.subs.deleteSub}
          </button>
        ) : (
          <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-delete-title">
            <p id="confirm-delete-title">{t.subs.deleteConfirm(sub.company_name, docs.length)}</p>
            {deleteError && <p className="gh-error">{deleteError}</p>}
            <div className="form-actions">
              <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" onClick={onDelete} disabled={deleting}>
                {deleting ? t.subs.deleting : t.subs.deleteForever}
              </button>
              <button className="gh-link" type="button" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                {t.common.cancel}
              </button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function Fact({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="fact">
      <dt className="gh-label">{label}</dt>
      <dd>{value ? href ? <a href={href}>{value}</a> : value : <span className="gh-muted">—</span>}</dd>
    </div>
  );
}
