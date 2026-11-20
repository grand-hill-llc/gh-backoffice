import { useRef, useState, type FormEvent } from "react";
import { supabase } from "../../lib/supabase";
import {
  DOC_LABEL,
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

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.doc,.docx";

type Props = { subId: string; docs: SubDocument[]; onChange: () => Promise<boolean> };

export default function DocumentsSection({ subId, docs, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const openFile = async (path: string) => {
    setRowError(null);
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed URL.
    const tab = window.open("", "_blank");
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(path, 120);
    if (error || !data) {
      tab?.close();
      setRowError("No pudimos abrir el archivo.");
      return;
    }
    if (tab) tab.location.href = data.signedUrl;
    else window.location.href = data.signedUrl;
  };

  const remove = async (doc: SubDocument) => {
    setRowError(null);
    const { error } = await supabase.from("subcontractor_documents").delete().eq("id", doc.id);
    if (error) {
      setRowError("No pudimos eliminar el documento.");
      return;
    }
    if (doc.file_path) await supabase.storage.from(DOCS_BUCKET).remove([doc.file_path]);
    setPendingDelete(null);
    await onChange();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title gh-label">Documentos</h2>
        {!adding && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            Agregar documento
          </button>
        )}
      </div>

      {adding && (
        <UploadForm
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
        !adding && <p className="gh-muted panel-empty">Sin documentos. Empieza por el seguro (COI), el W-9 y la licencia.</p>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id} className="doc-item">
              <div className="doc-main">
                <p className="doc-type">{DOC_LABEL[d.doc_type]}</p>
                <p className="gh-small gh-muted">
                  {d.expires_on ? `Vence ${formatDate(d.expires_on)}` : "Sin fecha de vencimiento"}
                  {d.issued_on && ` · Emitido ${formatDate(d.issued_on)}`}
                </p>
                {d.notes && <p className="gh-small doc-notes">{d.notes}</p>}
              </div>
              <div className="doc-side">
                <ValidityTag validity={validityOf(d.expires_on)} />
                <div className="doc-actions">
                  {d.file_path && (
                    <button className="text-btn" type="button" onClick={() => openFile(d.file_path!)} title={fileNameOf(d.file_path)}>
                      Ver archivo
                    </button>
                  )}
                  {pendingDelete === d.id ? (
                    <>
                      <button className="text-btn is-danger" type="button" onClick={() => remove(d)}>Confirmar</button>
                      <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>No</button>
                    </>
                  ) : (
                    <button
                      className="text-btn"
                      type="button"
                      onClick={() => setPendingDelete(d.id)}
                      aria-label={`Eliminar ${DOC_LABEL[d.doc_type]}`}
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function UploadForm({ subId, onCancel, onDone }: { subId: string; onCancel: () => void; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<DocType>("coi");
  const [file, setFile] = useState<File | null>(null);
  const [issuedOn, setIssuedOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsExpiry = docType === "coi" || docType === "license";
  const datesInvalid = !!issuedOn && !!expiresOn && expiresOn < issuedOn;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError("Selecciona el archivo.");
    if (file.size > MAX_BYTES) return setError("El archivo pesa más de 20 MB.");
    if (datesInvalid) return setError("La fecha de vencimiento no puede ser anterior a la de emisión.");

    setBusy(true);
    const path = storagePathFor(subId, file.name);
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type || undefined });
    if (up.error) {
      setBusy(false);
      return setError("No pudimos subir el archivo. Inténtalo de nuevo.");
    }
    const { error } = await supabase.from("subcontractor_documents").insert({
      subcontractor_id: subId,
      doc_type: docType,
      file_path: path,
      issued_on: issuedOn || null,
      expires_on: expiresOn || null,
      notes: notes.trim() || null,
    });
    if (error) {
      await supabase.storage.from(DOCS_BUCKET).remove([path]);
      setBusy(false);
      return setError("No pudimos guardar el documento. Inténtalo de nuevo.");
    }
    setBusy(false);
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="doc-type">Tipo</label>
          <select id="doc-type" className="gh-input gh-select" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="doc-file">Archivo</label>
          <input
            ref={fileRef}
            id="doc-file"
            className="gh-input gh-file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="gh-help">PDF o imagen, hasta 20 MB.</p>
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="doc-issued">Emitido</label>
          <input id="doc-issued" className="gh-input" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
        </div>
        <div className={`gh-field${datesInvalid ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="doc-expires">Vence</label>
          <input
            id="doc-expires"
            className="gh-input"
            type="date"
            value={expiresOn}
            min={issuedOn || undefined}
            onChange={(e) => setExpiresOn(e.target.value)}
            aria-invalid={datesInvalid}
          />
          {needsExpiry && !expiresOn && <p className="gh-help">Recomendado: activa las alertas de vencimiento.</p>}
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="doc-notes">Notas</label>
          <input
            id="doc-notes"
            className="gh-input"
            placeholder={docType === "coi" ? "Aseguradora, número de póliza…" : undefined}
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
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy || !file}>
          {busy ? "Subiendo…" : "Guardar documento"}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>Cancelar</button>
      </div>
    </form>
  );
}
