import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { BID_COLUMNS, formatMoney, formatPct, marginOf, type Bid, type BidStatus } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import DeleteZone from "../../components/DeleteZone";
import RecordLinks from "../../components/RecordLinks";
import BidEstimate from "./BidEstimate";
import BidProposalLinks from "./BidProposalLinks";
import { AlertCircleIcon, BuildingIcon } from "../Icons";
import StatusSteps from "../../components/StatusSteps";
import { Facts, NoteBlock, Panel } from "../../components/Panel";
import { DueNote } from "./bidTags";
import { useT } from "../../i18n";

type Row = Bid & { client: { id: string; name: string } | null };

export default function BidDetail() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const [bid, setBid] = useState<Row | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sourceLead, setSourceLead] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** The bid's cost and price come from its estimate lines (and can't be typed by hand). */
  const [fromEstimate, setFromEstimate] = useState(false);

  const onTotals = useCallback((totals: { cost: number; price: number } | null) => {
    setFromEstimate(!!totals);
    if (totals) setBid((b) => (b ? { ...b, estimated_value: totals.cost, our_price: totals.price } : b));
  }, []);

  useEffect(() => {
    let active = true;
    // The lead this bid came from, if it was converted from one (missing table just hides the link).
    supabase
      .from("leads")
      .select("id, name")
      .eq("bid_id", id!)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setSourceLead((data as { id: string; name: string } | null) ?? null);
      });
    // Missing projects table (migration 0002 not applied) just hides the button.
    supabase
      .from("projects")
      .select("id")
      .eq("bid_id", id!)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setProjectId((data as { id: string } | null)?.id ?? null);
      });
    supabase
      .from("bids")
      .select(`${BID_COLUMNS}, client:clients(id, name)`)
      .eq("id", id!)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setState("error");
        else if (!data) setState("missing");
        else {
          setBid(data as unknown as Row);
          setState("ready");
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const changeStatus = async (status: BidStatus) => {
    if (!bid || status === bid.status) return;
    const previous = bid.status;
    setBid({ ...bid, status });
    setStatusBusy(true);
    setStatusMsg(null);
    const { error } = await supabase.from("bids").update({ status }).eq("id", bid.id);
    setStatusBusy(false);
    if (error) {
      setBid((b) => (b ? { ...b, status: previous } : b));
      setStatusMsg({ ok: false, text: t.sales.statusSaveFailed });
    } else {
      setStatusMsg({ ok: true, text: t.sales.statusSaved });
    }
  };

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("bids").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      setDeleteError(t.sales.deleteBidFailed);
      return;
    }
    navigate("/bids", { replace: true });
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !bid)
    return (
      <>
        <Link className="back-link" to="/bids">← {t.sales.bidsTitle}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.sales.bidNotFound : t.sales.bidLoadOneFailed}</p>
        </div>
      </>
    );

  const margin = marginOf(bid.our_price, bid.estimated_value);

  return (
    <>
      <Link className="back-link" to="/bids">← {t.sales.bidsTitle}</Link>

      <header className="page-header detail-header">
        <div className="detail-title-row">
          <h1 className="gh-h2">{bid.title}</h1>
          <div className="detail-actions">
            {projectId ? (
              <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/proyectos/${projectId}`}>{t.projects.viewProject}</Link>
            ) : (
              bid.status === "won" && (
                <Link className="gh-btn gh-btn-primary gh-btn-sm" to={`/proyectos/nuevo?bid=${bid.id}`}>{t.projects.createFromBid}</Link>
              )
            )}
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/bids/${bid.id}/editar`}>{t.common.edit}</Link>
          </div>
        </div>
        <div className="detail-meta">
          {bid.client ? (
            <Link className="meta-link meta-client" to={`/clientes/${bid.client.id}`}>
              <BuildingIcon />
              {bid.client.name}
            </Link>
          ) : (
            <span className="gh-small gh-muted">{t.sales.noClient}</span>
          )}
          {sourceLead && (
            <span className="gh-small gh-muted">
              {t.leads.fromLead}: <Link className="meta-link" to={`/leads/${sourceLead.id}`}>{sourceLead.name}</Link>
            </span>
          )}
        </div>
      </header>

      <StatusSteps
        id="bid-status-label"
        label={t.sales.status}
        steps={["new", "estimating", "submitted", "won"] as BidStatus[]}
        endings={["lost", "declined"] as BidStatus[]}
        success="won"
        value={bid.status}
        labels={t.sales.bidStatuses}
        busy={statusBusy}
        onChange={changeStatus}
        message={statusMsg}
      />

      <div className="money-grid">
        <div className="money-card">
          <p className="gh-label">{t.sales.ourPrice}</p>
          <p className="money-value">{formatMoney(bid.our_price, t.locale)}</p>
          {fromEstimate && <span className="money-sub">{t.estimates.fromEstimate}</span>}
        </div>
        <div className="money-card">
          <p className="gh-label">{t.sales.estimatedValue}</p>
          <p className="money-value">{formatMoney(bid.estimated_value, t.locale)}</p>
          {fromEstimate && <span className="money-sub">{t.estimates.fromEstimate}</span>}
        </div>
        <div className={`money-card${margin && margin.amount < 0 ? " is-negative" : ""}`}>
          <p className="gh-label">{t.sales.margin}</p>
          <p className="money-value">{margin ? formatMoney(margin.amount, t.locale) : "—"}</p>
          {margin && margin.pct !== null && <span className="money-sub">{formatPct(margin.pct, t.locale)}</span>}
          {margin && margin.amount < 0 && <span className="due-note is-danger">{t.sales.marginNegative}</span>}
        </div>
        <div className="money-card">
          <p className="gh-label">{t.sales.dueDate}</p>
          <p className="money-value">{bid.due_date ? formatDate(bid.due_date, t.locale) : "—"}</p>
          <DueNote bid={bid} today={todayISO()} />
        </div>
      </div>

      <div className="detail-grid">
        <Panel title={t.sales.details}>
          <Facts
            completeHref={`/bids/${bid.id}/editar`}
            items={[
              { label: t.sales.location, value: bid.location },
              { label: t.sales.createdOn, value: formatDate(bid.created_at, t.locale) },
            ]}
          />
        </Panel>
        <Panel title={t.sales.scope}>
          {bid.scope ? <p className="panel-text">{bid.scope}</p> : <p className="panel-empty">—</p>}
          {bid.notes && <NoteBlock title={t.sales.notes} text={bid.notes} />}
        </Panel>
      </div>

      <div className="detail-stack">
        <BidEstimate bidId={bid.id} onTotals={onTotals} />
        <BidProposalLinks bidId={bid.id} />
        <RecordLinks bidId={bid.id} />
      </div>

      <DeleteZone
        label={t.sales.deleteBid}
        message={t.sales.deleteBidConfirm(bid.title)}
        confirmLabel={t.sales.deleteForever}
        busyLabel={t.sales.deleting}
        cancelLabel={t.common.cancel}
        error={deleteError}
        busy={deleting}
        onConfirm={onDelete}
      />
    </>
  );
}
