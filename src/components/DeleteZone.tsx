import { useState } from "react";
import { TrashIcon } from "../pages/Icons";

/** Bottom-of-page delete link that expands into an explicit confirmation. */
export default function DeleteZone({
  label,
  message,
  confirmLabel,
  busyLabel,
  cancelLabel,
  error,
  busy,
  onConfirm,
}: {
  label: string;
  message: string;
  confirmLabel: string;
  busyLabel: string;
  cancelLabel: string;
  error: string | null;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="danger-zone">
      {!confirming ? (
        <button className="gh-link danger-link" type="button" onClick={() => setConfirming(true)}>
          <TrashIcon />
          {label}
        </button>
      ) : (
        <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-delete-msg">
          <p id="confirm-delete-msg">{message}</p>
          {error && <p className="gh-error">{error}</p>}
          <div className="form-actions">
            <button className="gh-btn gh-btn-primary gh-btn-sm" type="button" onClick={onConfirm} disabled={busy}>
              {!busy && <TrashIcon />}
              {busy ? busyLabel : confirmLabel}
            </button>
            <button className="gh-link" type="button" onClick={() => setConfirming(false)} disabled={busy}>
              {cancelLabel}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
