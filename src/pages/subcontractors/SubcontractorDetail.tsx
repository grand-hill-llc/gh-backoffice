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
import DeleteZone from "../../components/DeleteZone";
import { Facts, mailHref, NoteBlock, Panel, telHref } from "../../components/Panel";
import { tradeLabel, useT } from "../../i18n";

export default function SubcontractorDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const t = useT();
  const [sub, setSub] = useState<Subcontractor | null>(null);
  const [docs, setDocs] = useState<SubDocument[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
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
        <Panel title={t.subs.details}>
          <Facts
            completeHref={`/subcontratistas/${sub.id}/editar`}
            items={[
              { label: t.subs.legalName, value: sub.legal_name },
              { label: t.subs.contact, value: sub.contact_name },
              { label: t.subs.email, value: sub.email, href: mailHref(sub.email) },
              { label: t.subs.phone, value: sub.phone, href: telHref(sub.phone) },
              { label: t.subs.location, value: location },
              { label: t.subs.createdOn, value: formatDate(sub.created_at, t.locale) },
            ]}
          />
          {sub.notes && <NoteBlock title={t.subs.notes} text={sub.notes} />}
        </Panel>

        <DocumentsSection subId={sub.id} docs={docs} onChange={loadDocs} />
      </div>

      <DeleteZone
        label={t.subs.deleteSub}
        message={t.subs.deleteConfirm(sub.company_name, docs.length)}
        confirmLabel={t.subs.deleteForever}
        busyLabel={t.subs.deleting}
        cancelLabel={t.common.cancel}
        error={deleteError}
        busy={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}

