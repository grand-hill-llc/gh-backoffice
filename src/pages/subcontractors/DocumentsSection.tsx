import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import {
  DOC_TYPES,
  DOCS_BUCKET,
  fileNameOf,
  formatDate,
  storagePathFor,
  validityOf,
  type DocType,
  type SubDocument,
} from "../../lib/subcontractors";
import { AlertCircleIcon } from "../Icons";
import { ValidityTag } from "./tags";
import { Panel } from "../../components/Panel";
import { Tag } from "../../components/ui";
import { useAuth } from "../../auth/AuthProvider";
import { useT } from "../../i18n";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx";

type Props = { subId: string; docs: SubDocument[]; onChange: () => Promise<boolean> };

export default function DocumentsSection({ subId, docs, onChange }: Props) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const { session } = useAuth();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);

  // Documents waiting for a decision come first.
  const ordered = [...docs].sort((a, b) => Number(b.review_status === "pending") - Number(a.review_status === "pending"));

  const review = async (doc: SubDocument, approved: boolean) => {
    if (!approved && !reason.trim()) return setReasonTouched(true);
    setRowError(null);
    setReviewBusy(true);
    const { error } = await supabase
      .from("subcontractor_documents")
      .update({
        review_status: approved ? "approved" : "rejected",
        rejection_reason: approved ? null : reason.trim(),
        reviewed_by: session?.user.id ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", doc.id);
    setReviewBusy(false);
    if (error) return setRowError(t.subs.reviewFailed);
    setRejecting(null);
    setReason("");
    setReasonTouched(false);
    await onChange();
  };

  const openFile = async (path: string) => {
    setRowError(null);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed URL.
    const tab = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120);
    if (error || !data) {
      tab?.close();
      setRowError(t.subs.openFailed);
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const remove = async (doc: SubDocument) => {
    setRowError(null);
    const { error } = await supabase.from("subcontractor_documents").delete().eq("id", doc.id);
    if (error) {
      setRowError(t.subs.deleteDocFailed);
      return;
    }
    if (doc.file_path) await supabase.storage.from(DOCS_BUCKET).remove([doc.file_path]);
    setPendingDelete(null);
    await onChange();
  };

  return (
    <Panel
      title={t.subs.documents}
      action={
        !adding && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            {t.subs.addDocument}
          </button>
        )
      }
    >

      {adding && (
        <DocForm
          subId={subId}
          onCancel={() => setAdding(false)}
          onDone={async () => {
            setAdding(false);
            await onChange();
          }}
        />
      )}

      {rowError && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{rowError}</p>
        </div>
      )}

      {docs.length === 0 ? (
        !adding && <p className="panel-empty">{t.subs.noDocuments}</p>
      ) : (
        <ul className="doc-list">
          {ordered.map((d) =>
            editing === d.id ? (
              <li key={d.id} className="doc-item is-editing">
                <DocForm
                  subId={subId}
                  doc={d}
                  onCancel={() => setEditing(null)}
                  onDone={async () => {
                    setEditing(null);
                    await onChange();
                  }}
                />
              </li>
            ) : (
            <li key={d.id} className="doc-item">
              <div className="doc-main">
                <p className="doc-type">{t.subs.docTypes[d.doc_type]}</p>
                <p className="gh-small gh-muted">
                  {d.expires_on ? t.subs.expiresOn(formatDate(d.expires_on, t.locale)) : t.subs.noExpiry}
                  {d.issued_on && ` · ${t.subs.issuedOn(formatDate(d.issued_on, t.locale))}`}
                </p>
                {d.notes && <p className="gh-small doc-notes">{d.notes}</p>}
                {d.review_status === "pending" && <p className="gh-small gh-muted">{t.subs.fromPortal}</p>}
                {d.review_status === "rejected" && d.rejection_reason && (
                  <p className="gh-small doc-notes">{t.subs.rejectedReason(d.rejection_reason)}</p>
                )}
                {d.review_status === "pending" && rejecting !== d.id && (
                  <div className="review-actions">
                    <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" disabled={reviewBusy} onClick={() => review(d, true)}>
                      {t.subs.approve}
                    </button>
                    <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" disabled={reviewBusy} onClick={() => { setRejecting(d.id); setReason(""); setReasonTouched(false); }}>
                      {t.subs.reject}
                    </button>
                  </div>
                )}
                {rejecting === d.id && (
                  <div className={`gh-field review-reason${reasonTouched && !reason.trim() ? " is-error" : ""}`}>
                    <label className="gh-field-label" htmlFor={`reject-${d.id}`}>{t.subs.rejectReason}</label>
                    <input
                      id={`reject-${d.id}`}
                      className="gh-input"
                      autoFocus
                      placeholder={t.subs.rejectPlaceholder}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      aria-invalid={reasonTouched && !reason.trim()}
                    />
                    {reasonTouched && !reason.trim() && <p className="gh-error">{t.subs.rejectRequired}</p>}
                    <div className="form-actions">
                      <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" disabled={reviewBusy} onClick={() => review(d, false)}>
                        {t.subs.confirmReject}
                      </button>
                      <button className="gh-link" type="button" disabled={reviewBusy} onClick={() => setRejecting(null)}>{t.common.cancel}</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="doc-side">
                {d.review_status === "pending" ? (
                  <Tag tone="warning">{t.subs.inReview}</Tag>
                ) : d.review_status === "rejected" ? (
                  <Tag tone="danger">{t.subs.rejected}</Tag>
                ) : (
                  <ValidityTag validity={validityOf(d.expires_on)} />
                )}
                <div className="doc-actions">
                  {d.file_path && (
                    <button className="text-btn" type="button" onClick={() => openFile(d.file_path!)} title={fileNameOf(d.file_path)}>
                      {t.subs.viewFile}
                    </button>
                  )}
                  {pendingDelete !== d.id && (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => {
                        setEditing(d.id);
                        setAdding(false);
                        setRejecting(null);
                      }}
                      aria-label={t.subs.editDocLabel(t.subs.docTypes[d.doc_type])}
                    >
                      {t.common.edit}
                    </button>
                  )}
                  {pendingDelete === d.id ? (
                    <>
                      <button className="text-btn is-danger" type="button" onClick={() => remove(d)}>{t.common.confirm}</button>
                      <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                    </>
                  ) : (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => setPendingDelete(d.id)}
                      aria-label={t.subs.deleteDocLabel(t.subs.docTypes[d.doc_type])}
                    >
                      {t.common.delete}
                    </button>
                  )}
                </div>
              </div>
            </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}

/** Upload a new document, or edit one (type, dates, notes and optionally its file). */
function DocForm({ subId, doc, onCancel, onDone }: { subId: string; doc?: SubDocument; onCancel: () => void; onDone: () => void }) {
  const t = useT();
  const editing = !!doc;
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocType>(doc?.doc_type ?? "coi");
  const [file, setFile] = useState<File | null>(null);
  const [issuedOn, setIssuedOn] = useState(doc?.issued_on ?? "");
  const [expiresOn, setExpiresOn] = useState(doc?.expires_on ?? "");
  const [notes, setNotes] = useState(doc?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsExpiry = docType === "coi" || docType === "license";
  const datesInvalid = !!issuedOn && !!expiresOn && expiresOn < issuedOn;
  const id = (name: string) => (doc ? `doc-${doc.id}-${name}` : `doc-${name}`);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file && !editing) return setError(t.subs.pickFile);
    if (file && file.size > MAX_BYTES) return setError(t.subs.fileTooBig);
    if (datesInvalid) return setError(t.subs.datesInvalid);

    setBusy(true);
    let path: string | null = null;
    if (file) {
      path = storagePathFor(subId, file.name);
      const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (up.error) {
        setBusy(false);
        return setError(t.subs.uploadFailed);
      }
    }
    const fields = {
      doc_type: docType,
      issued_on: issuedOn || null,
      expires_on: expiresOn || null,
      notes: notes.trim() || null,
    };
    const { error } = doc
      ? await supabase.from("subcontractor_documents").update(path ? { ...fields, file_path: path } : fields).eq("id", doc.id)
      : await supabase.from("subcontractor_documents").insert({ ...fields, subcontractor_id: subId, file_path: path });
    if (error) {
      if (path) await supabase.storage.from(DOCS_BUCKET).remove([path]);
      setBusy(false);
      // One pending document per type and company (0005): changing the type can collide.
      return setError(/one_pending|duplicate/i.test(error.message) ? t.subs.pendingTypeTaken : t.subs.saveDocFailed);
    }
    // The new file is saved: the replaced one is no longer referenced.
    if (path && doc?.file_path) await supabase.storage.from(DOCS_BUCKET).remove([doc.file_path]);
    setBusy(false);
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className="gh-field">
          <label className="gh-field-label" htmlFor={id("type")}>{t.subs.docType}</label>
          <select id={id("type")} className="gh-input gh-select" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>{t.subs.docTypes[d]}</option>
            ))}
          </select>
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor={id("file")}>{editing ? t.subs.replaceFile : t.subs.file}</label>
          <input
            ref={fileRef}
            id={id("file")}
            className="gh-input gh-file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="gh-help">
            {!editing ? t.subs.fileHelp : doc?.file_path ? t.subs.replaceFileHelp(fileNameOf(doc.file_path)) : t.subs.addFileHelp}
          </p>
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor={id("issued")}>{t.subs.issued}</label>
          <input id={id("issued")} className="gh-input" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className={`gh-field${datesInvalid ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor={id("expires")}>{t.subs.expires}</label>
          <input
            id={id("expires")}
            className="gh-input"
            type="date"
            value={expiresOn}
            min={issuedOn || undefined}
            onChange={(e) => setExpiresOn(e.target.value)}
            aria-invalid={datesInvalid}
          />
          {needsExpiry && !expiresOn && <p className="gh-help">{t.subs.expiryHint}</p>}
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor={id("notes")}>{t.subs.notes}</label>
          <input
            id={id("notes")}
            className="gh-input"
            placeholder={docType === "coi" ? t.subs.coiNotesPlaceholder : undefined}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}

      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy || (!editing && !file)}>
          {busy ? (file ? t.subs.uploading : t.common.saving) : editing ? t.subs.saveDocChanges : t.subs.saveDocument}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
