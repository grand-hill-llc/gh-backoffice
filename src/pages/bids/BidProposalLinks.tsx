import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { formatMoney } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Panel } from "../../components/Panel";
import { Tag, type TagTone } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { proposalUrl } from "./BidProposal";
import { useT } from "../../i18n";

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
};

const COLUMNS =
  "id, token, lang, total, valid_until, status, view_count, last_viewed_at, decided_at, signer_name, signer_email, client_note, decision_ip, created_at, creator:profiles(full_name, email)";
const TONE: Record<Status | "expired", TagTone> = { sent: "warning", accepted: "success", rejected: "danger", withdrawn: "neutral", expired: "neutral" };

/** Proposal links sent for this bid and what the client did with them. Staff only. */
export default function BidProposalLinks({ bidId }: { bidId: string }) {
  const t = useT();
  const p = t.proposalLinks;
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [state, setState] = useState<"ready" | "missing" | "failed">("ready");
  const [pendingWithdraw, setPendingWithdraw] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("proposal_links")
      .select(COLUMNS)
      .eq("bid_id", bidId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setState(/schema cache|does not exist|relation/i.test(error.message) ? "missing" : "failed");
          setRows([]);
          return;
        }
        setRows((data ?? []) as unknown as LinkRow[]);
      });
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
            <li key={r.id} className={`doc-item link-item is-${r.status}`}>
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
            </li>
          );
        })}
      </ul>
      )}
      {rows.length > 0 && <p className="gh-small gh-muted">{p.help}</p>}
    </Panel>
  );
}
