import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatMoney } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Panel } from "../../components/Panel";
import { Tag, type TagTone } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { proposalUrl } from "./BidProposal";
import { dictFor, useT } from "../../i18n";
import { useAuth } from "../../auth/AuthProvider";

type Status = "sent" | "accepted" | "rejected" | "withdrawn";
type LinkRow = {
  id: string;
  token: string;
  lang: "es" | "en";
  total: number | null;
  valid_until: string;
  status: Status;
  view_count: number;
  last_viewed_at: string | null;
  decided_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  client_note: string | null;
  decision_ip: string | null;
  created_at: string;
  creator: { full_name: string | null; email: string | null } | null;
  emails?: EmailRow[];
};
export type EmailRow = {
  id: string;
  recipient: string;
  cc: string[];
  status: "sent" | "failed";
  created_at: string;
  sender: { full_name: string | null; email: string | null } | null;
};
export type ProposalClient = { contact_name: string | null; email: string | null } | null;

const COLUMNS =
  "id, token, lang, total, valid_until, status, view_count, last_viewed_at, decided_at, signer_name, signer_email, client_note, decision_ip, created_at, creator:profiles(full_name, email)";
const EMAILS = "emails:proposal_emails(id, recipient, cc, status, created_at, sender:profiles(full_name, email))";
const TONE: Record<Status | "expired", TagTone> = { sent: "warning", accepted: "success", rejected: "danger", withdrawn: "neutral", expired: "neutral" };

/** Proposal links sent for this bid and what the client did with them. Staff only. */
export default function BidProposalLinks({ bidId, bidTitle, client }: { bidId: string; bidTitle: string; client: ProposalClient }) {
  const t = useT();
  const p = t.proposalLinks;
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [state, setState] = useState<"ready" | "missing" | "failed">("ready");
  const [pendingWithdraw, setPendingWithdraw] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [mailing, setMailing] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = (columns: string) =>
      supabase.from("proposal_links").select(columns).eq("bid_id", bidId).order("created_at", { ascending: false });
    (async () => {
      let { data, error } = await load(`${COLUMNS}, ${EMAILS}`);
      // Migration 0014 not applied yet: show the links without their emails.
      if (error && /proposal_emails/i.test(error.message)) ({ data, error } = await load(COLUMNS));
      {
        if (!active) return;
        if (error) {
          setState(/schema cache|does not exist|relation/i.test(error.message) ? "missing" : "failed");
          setRows([]);
          return;
        }
        setRows((data ?? []) as unknown as LinkRow[]);
      }
    })();
    return () => {
      active = false;
    };
  }, [bidId]);

  if (rows === null) return null;

  const dateTime = (iso: string) =>
    new Date(iso).toLocaleString(t.locale, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const today = todayISO();
  // created_at is a timestamp: show the local day, not the UTC one.
  const localDay = (iso: string) => new Date(iso).toLocaleDateString(t.locale, { day: "numeric", month: "short", year: "numeric" });

  const withdraw = async (row: LinkRow) => {
    setRowError(null);
    const { error } = await supabase.from("proposal_links").update({ status: "withdrawn" }).eq("id", row.id);
    setPendingWithdraw(null);
    if (error) return setRowError(p.withdrawFailed);
    setRows((list) => (list ?? []).map((r) => (r.id === row.id ? { ...r, status: "withdrawn" } : r)));
  };

  const copy = async (row: LinkRow) => {
    try {
      await navigator.clipboard.writeText(proposalUrl(row.token));
      setCopied(row.id);
    } catch {
      setCopied(null);
    }
  };

  return (
    <Panel
      title={p.title}
      action={
        <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/bids/${bidId}/propuesta`}>
          {t.proposal.open}
        </Link>
      }
    >
      {state === "failed" && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{p.loadFailed}</p>
        </div>
      )}
      {rowError && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{rowError}</p>
        </div>
      )}
      {rows.length === 0 && state !== "failed" && <p className="panel-empty">{p.empty}</p>}
      {rows.length > 0 && (
      <ul className="doc-list">
        {rows.map((r) => {
          const expired = r.status === "sent" && r.valid_until < today;
          const shown: Status | "expired" = expired ? "expired" : r.status;
          const who = r.creator?.full_name || r.creator?.email;
          return (
            <li key={r.id} className={`doc-item link-item is-${r.status}${mailing === r.id ? " is-mailing" : ""}`}>
              <div className="doc-main">
                <p className="doc-type">
                  {formatMoney(r.total === null ? null : Number(r.total), t.locale)}
                  <span className="gh-muted"> · {t.prefs.langs[r.lang]}</span>
                </p>
                <p className="gh-small gh-muted">
                  {[p.createdOn(localDay(r.created_at), who ?? null), p.validUntil(formatDate(r.valid_until, t.locale))].join(" · ")}
                </p>
                <p className="gh-small">
                  {r.view_count > 0 && r.last_viewed_at ? p.views(r.view_count, dateTime(r.last_viewed_at)) : p.notViewed}
                </p>
                {r.decided_at && (
                  <p className="gh-small">
                    {r.status === "accepted"
                      ? p.acceptedBy(r.signer_name ?? "—", dateTime(r.decided_at))
                      : p.rejectedBy(r.signer_name, dateTime(r.decided_at))}
                    {r.signer_email && <span className="gh-muted"> · {r.signer_email}</span>}
                    {r.decision_ip && <span className="gh-muted"> · IP {r.decision_ip}</span>}
                  </p>
                )}
                {(r.emails ?? [])
                  .filter((m) => m.status === "sent")
                  .sort((a, b) => a.created_at.localeCompare(b.created_at))
                  .map((m) => (
                    <p key={m.id} className="gh-small">
                      {p.mail.sentTo(m.recipient, dateTime(m.created_at), m.sender?.full_name || m.sender?.email || null)}
                      {m.cc.length > 0 && <span className="gh-muted"> · {p.mail.ccLine(m.cc.join(", "))}</span>}
                    </p>
                  ))}
                {r.client_note && <p className="gh-small doc-notes">“{r.client_note}”</p>}
              </div>
              <div className="doc-side">
                <Tag tone={TONE[shown]}>{p.statuses[shown]}</Tag>
                <div className="doc-actions">
                  {pendingWithdraw === r.id ? (
                    <>
                      <button className="text-btn is-danger" type="button" onClick={() => withdraw(r)}>{t.common.confirm}</button>
                      <button className="text-btn" type="button" onClick={() => setPendingWithdraw(null)}>{t.common.no}</button>
                    </>
                  ) : (
                    <>
                      <Link className="text-btn" to={`/p/${r.token}?vista=1`} target="_blank" rel="noopener noreferrer">{p.open}</Link>
                      {r.status === "sent" && !expired && mailing !== r.id && (
                        <button className="text-btn" type="button" onClick={() => setMailing(r.id)}>{p.mail.send}</button>
                      )}
                      {r.status === "sent" && (
                        <>
                          <button className="text-btn" type="button" onClick={() => copy(r)}>{copied === r.id ? p.copied : p.copy}</button>
                          <button className="text-btn" type="button" onClick={() => setPendingWithdraw(r.id)}>{p.withdraw}</button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              {mailing === r.id && (
                  <MailForm
                    row={r}
                    bidTitle={bidTitle}
                    client={client}
                    onCancel={() => setMailing(null)}
                    onSent={(m) => {
                      setMailing(null);
                      setRows((list) => (list ?? []).map((x) => (x.id === r.id ? { ...x, emails: [...(x.emails ?? []), m] } : x)));
                    }}
                  />
                )}
            </li>
          );
        })}
      </ul>
      )}
      {rows.length > 0 && <p className="gh-small gh-muted">{p.help}</p>}
    </Panel>
  );
}

/** The function's own error code, "missing" when it isn't deployed, "network" when there was no answer. */
async function functionErrorCode(error: unknown): Promise<string | null> {
  const name = (error as { name?: string })?.name;
  // No answer (network drop, timeout): the email may have gone out.
  if (name === "FunctionsFetchError" || name === "FunctionsRelayError") return "network";
  const ctx = (error as { context?: Response })?.context;
  if (!ctx || typeof ctx.json !== "function") return null;
  try {
    const body = await ctx.json();
    if (typeof body?.error === "string") return body.error;
    return ctx.status === 404 ? "missing" : null;
  } catch {
    return ctx.status === 404 ? "missing" : null;
  }
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const splitEmails = (v: string) => [...new Set(v.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

/** Email one open proposal link to the client. The send-proposal function does the sending. */
export function MailForm({
  row,
  bidTitle,
  client,
  onCancel,
  onSent,
}: {
  row: Pick<LinkRow, "id" | "lang">;
  bidTitle: string;
  client: ProposalClient;
  onCancel: () => void;
  onSent: (m: EmailRow) => void;
}) {
  const t = useT();
  const m = t.proposalLinks.mail;
  const { profile } = useAuth();
  const sender = profile?.full_name || null;
  const [to, setTo] = useState(client?.email ?? "");
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState(() => dictFor(row.lang).proposalLinks.mail.defaultMessage(client?.contact_name ?? null, bidTitle, sender));
  // Same id until the server answers: a retry after a timeout reaches Resend as the same email.
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ccList = splitEmails(cc);
  const toError = touched && !EMAIL_RE.test(to.trim()) ? m.invalidTo : null;
  const ccError = touched ? (ccList.some((e) => !EMAIL_RE.test(e)) ? m.invalidCc : ccList.length > 5 ? m.tooManyCc : null) : null;
  const id = (name: string) => `mail-${row.id}-${name}`;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!EMAIL_RE.test(to.trim()) || ccList.some((x) => !EMAIL_RE.test(x)) || ccList.length > 5) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("send-proposal", {
      body: { link_id: row.id, to: to.trim(), cc: ccList, message, request_id: requestId },
    });
    setBusy(false);
    if (error) {
      const code = await functionErrorCode(error);
      // The server answered with an error, so nothing was sent: the next try is a new email.
      if (code !== "network") setRequestId(crypto.randomUUID());
      const known: Record<string, string> = {
        invalid_email: m.invalidTo,
        invalid_cc: m.invalidCc,
        too_many_cc: m.tooManyCc,
        message_too_long: m.tooLong,
        not_open: m.notOpen,
        expired: m.expired,
        missing: m.missing,
      };
      return setError((code && known[code]) || m.failed);
    }
    onSent({
      id: data?.id ?? requestId,
      recipient: to.trim().toLowerCase(),
      cc: ccList.filter((x) => x !== to.trim().toLowerCase()),
      status: "sent",
      created_at: data?.created_at ?? new Date().toISOString(),
      sender: { full_name: profile?.full_name ?? null, email: profile?.email ?? null },
    });
  };

  return (
    <form className="upload-form mail-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className={`gh-field${toError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor={id("to")}>{m.to}</label>
          <input
            id={id("to")}
            className="gh-input"
            type="email"
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-invalid={!!toError}
            aria-describedby={toError ? id("to-error") : undefined}
          />
          {toError && <p className="gh-error" id={id("to-error")}>{toError}</p>}
        </div>
        <div className={`gh-field${ccError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor={id("cc")}>{m.cc}</label>
          <input
            id={id("cc")}
            className="gh-input"
            autoComplete="off"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            aria-invalid={!!ccError}
            aria-describedby={ccError ? id("cc-error") : id("cc-help")}
          />
          {ccError ? <p className="gh-error" id={id("cc-error")}>{ccError}</p> : <p className="gh-help" id={id("cc-help")}>{m.ccHelp}</p>}
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor={id("message")}>{m.message}</label>
          <textarea
            id={id("message")}
            className="gh-input gh-textarea"
            rows={9}
            maxLength={4000}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            aria-describedby={id("message-help")}
          />
          <p className="gh-help" id={id("message-help")}>{m.messageHelp(t.prefs.langs[row.lang])}</p>
        </div>
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>{busy ? m.sending : m.submit}</button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
