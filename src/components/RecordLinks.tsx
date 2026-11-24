import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { LINK_COLUMNS, normalizeUrl, sourceOf, type RecordLink } from "../lib/links";
import { Panel } from "./Panel";
import { AlertCircleIcon, ExternalLinkIcon } from "../pages/Icons";
import { useT } from "../i18n";

type Owner = { bidId: string } | { projectId: string };

type Props = Owner & {
  /** For a project: its original bid, whose links are shown too (read-only). */
  fromBid?: { id: string; title: string } | null;
};

/** Named links to the files of a bid or project, kept in Google Drive or similar. Staff only. */
export default function RecordLinks(props: Props) {
  const t = useT();
  const l = t.links;
  const column = "bidId" in props ? "bid_id" : "project_id";
  const ownerId = "bidId" in props ? props.bidId : props.projectId;
  const fromBid = "projectId" in props ? props.fromBid ?? null : null;

  const [links, setLinks] = useState<RecordLink[] | null>(null);
  const [bidLinks, setBidLinks] = useState<RecordLink[]>([]);
  const [state, setState] = useState<"ready" | "missing" | "failed">("ready");
  const [adding, setAdding] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [own, inherited] = await Promise.all([
        supabase.from("record_links").select(LINK_COLUMNS).eq(column, ownerId).order("created_at"),
        fromBid ? supabase.from("record_links").select(LINK_COLUMNS).eq("bid_id", fromBid.id).order("created_at") : null,
      ]);
      if (!active) return;
      const err = own.error ?? inherited?.error;
      if (err) {
        setState(/schema cache|does not exist|relation/i.test(err.message) ? "missing" : "failed");
        setLinks([]);
        return;
      }
      setLinks((own.data ?? []) as RecordLink[]);
      setBidLinks((inherited?.data ?? []) as RecordLink[]);
    })();
    return () => {
      active = false;
    };
  }, [column, ownerId, fromBid?.id]);

  const remove = async (link: RecordLink) => {
    setRowError(null);
    const { error } = await supabase.from("record_links").delete().eq("id", link.id);
    setPendingDelete(null);
    if (error) return setRowError(l.deleteFailed);
    setLinks((prev) => (prev ?? []).filter((x) => x.id !== link.id));
  };

  const canAdd = state === "ready" && links !== null && !adding;

  return (
    <Panel
      title={l.title}
      action={
        canAdd && (
          <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setAdding(true)}>
            {l.add}
          </button>
        )
      }
    >
      {state !== "ready" && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? l.missingTable : l.loadFailed}</p>
        </div>
      )}

      {adding && (
        <LinkForm
          column={column}
          ownerId={ownerId}
          onCancel={() => setAdding(false)}
          onDone={(row) => {
            setAdding(false);
            setLinks((prev) => [...(prev ?? []), row]);
          }}
        />
      )}

      {rowError && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{rowError}</p>
        </div>
      )}

      {links === null ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : links.length === 0 && bidLinks.length === 0 ? (
        state === "ready" && !adding && <p className="panel-empty">{l.empty}</p>
      ) : (
        <>
          {links.length > 0 && (
            <ul className="doc-list">
              {links.map((link) => (
                <li key={link.id} className="doc-item">
                  <LinkMain link={link} />
                  <div className="doc-side">
                    <div className="doc-actions">
                      {pendingDelete === link.id ? (
                        <>
                          <button className="text-btn is-danger" type="button" onClick={() => remove(link)}>{t.common.confirm}</button>
                          <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                        </>
                      ) : (
                        <button className="text-btn" type="button" onClick={() => setPendingDelete(link.id)} aria-label={l.deleteLabel(link.label)}>
                          {l.remove}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {fromBid && bidLinks.length > 0 && (
            <div className="links-inherited">
              <p className="gh-label">
                {l.fromBid}: <Link className="meta-link" to={`/bids/${fromBid.id}`}>{fromBid.title}</Link>
              </p>
              <ul className="doc-list">
                {bidLinks.map((link) => (
                  <li key={link.id} className="doc-item">
                    <LinkMain link={link} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function LinkMain({ link }: { link: RecordLink }) {
  const t = useT();
  return (
    <div className="doc-main">
      <a className="link-out" href={link.url} target="_blank" rel="noopener noreferrer">
        {link.label}
        <ExternalLinkIcon />
        <span className="visually-hidden"> ({t.links.opensNewTab})</span>
      </a>
      <p className="gh-small gh-muted">{sourceOf(link.url)}</p>
    </div>
  );
}

function LinkForm({
  column,
  ownerId,
  onCancel,
  onDone,
}: {
  column: "bid_id" | "project_id";
  ownerId: string;
  onCancel: () => void;
  onDone: (row: RecordLink) => void;
}) {
  const t = useT();
  const l = t.links;
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeUrl(url);
  const labelError = touched && !label.trim() ? l.labelRequired : null;
  const urlError = touched && !normalized ? (url.trim() ? l.urlInvalid : l.urlRequired) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!label.trim() || !normalized) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("record_links")
      .insert({ [column]: ownerId, label: label.trim().slice(0, 120), url: normalized })
      .select(LINK_COLUMNS)
      .single();
    setBusy(false);
    if (error || !data) return setError(l.saveFailed);
    onDone(data as RecordLink);
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className={`gh-field${labelError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="link-label">{l.label}</label>
          <input
            id="link-label"
            className="gh-input"
            autoFocus
            list="link-label-suggestions"
            placeholder={l.labelPlaceholder}
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            aria-invalid={!!labelError}
            aria-describedby={labelError ? "link-label-error" : undefined}
          />
          <datalist id="link-label-suggestions">
            {l.suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          {labelError && <p className="gh-error" id="link-label-error">{labelError}</p>}
        </div>
        <div className={`gh-field${urlError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="link-url">{l.url}</label>
          <input
            id="link-url"
            className="gh-input"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://drive.google.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!!urlError}
            aria-describedby="link-url-help"
          />
          {urlError ? (
            <p className="gh-error" id="link-url-help">{urlError}</p>
          ) : (
            <p className="gh-help" id="link-url-help">{l.urlHelp}</p>
          )}
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
          {busy ? t.common.saving : l.save}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
