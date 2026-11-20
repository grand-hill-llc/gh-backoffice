import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { BID_COLUMNS, formatMoney, formatPct, marginOf, OPEN_STATUSES, type Bid, type BidStatus } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { EmptyState, PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { BidStatusTag, DueNote } from "./bidTags";
import { useT } from "../../i18n";

type View = "open" | "won" | "closed" | "all";
const VIEWS: View[] = ["open", "won", "closed", "all"];
const IN_VIEW: Record<View, (s: BidStatus) => boolean> = {
  open: (s) => OPEN_STATUSES.includes(s),
  won: (s) => s === "won",
  closed: (s) => s === "lost" || s === "declined",
  all: () => true,
};

type Row = Bid & { client: { name: string } | null };

/** Open bids first by due date (soonest first, undated last); closed views newest first. */
function sortFor(view: View) {
  return (a: Row, b: Row) => {
    if (view === "open") {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return b.created_at.localeCompare(a.created_at);
    }
    return (b.due_date ?? b.created_at).localeCompare(a.due_date ?? a.created_at);
  };
}

export default function BidList() {
  const t = useT();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("open");

  useEffect(() => {
    let active = true;
    supabase
      .from("bids")
      .select(`${BID_COLUMNS}, client:clients(name)`)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError(true);
        else setRows((data ?? []) as unknown as Row[]);
      });
    return () => {
      active = false;
    };
  }, []);

  const counts = useMemo(() => {
    const c: Record<View, number> = { open: 0, won: 0, closed: 0, all: 0 };
    for (const r of rows ?? []) for (const v of VIEWS) if (IN_VIEW[v](r.status)) c[v] += 1;
    return c;
  }, [rows]);

  const openTotal = useMemo(
    () => (rows ?? []).filter((r) => OPEN_STATUSES.includes(r.status)).reduce((sum, r) => sum + Number(r.our_price ?? 0), 0),
    [rows]
  );

  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => IN_VIEW[view](r.status))
      .filter((r) => !q || [r.title, r.client?.name, r.location].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q)))
      .sort(sortFor(view));
  }, [rows, query, view]);

  const today = todayISO();

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.sales.eyebrow} title={t.sales.bidsTitle} description={t.sales.bidsDescription} />
        <Link className="gh-btn gh-btn-primary" to="/bids/nuevo">
          {t.sales.newBid}
        </Link>
      </div>

      {error ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{t.sales.bidsLoadFailed}</p>
        </div>
      ) : !rows ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={t.sales.bidsEmptyTitle}>{t.sales.bidsEmptyBody}</EmptyState>
      ) : (
        <>
          <div className="view-tabs" role="tablist" aria-label={t.sales.bidsTitle}>
            {VIEWS.map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className="view-tab" onClick={() => setView(v)}>
                {t.sales.views[v]} <span className="view-count">{counts[v]}</span>
              </button>
            ))}
          </div>

          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="bid-search">{t.sales.search}</label>
              <input
                id="bid-search"
                className="gh-input"
                type="search"
                placeholder={t.sales.bidSearchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">
            {t.sales.bidCount(filtered.length)}
            {view === "open" && openTotal > 0 && ` · ${t.sales.openTotal(formatMoney(openTotal, t.locale))}`}
          </p>

          {filtered.length === 0 ? (
            <EmptyState title={t.sales.noBidMatchTitle}>{t.sales.noBidMatchBody}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">{t.sales.colTitle}</th>
                    <th scope="col">{t.sales.colClient}</th>
                    <th scope="col">{t.sales.colStatus}</th>
                    <th scope="col">{t.sales.colDue}</th>
                    <th scope="col" className="num">{t.sales.colPrice}</th>
                    <th scope="col" className="num">{t.sales.colMargin}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => (
                    <tr key={b.id} onClick={() => navigate(`/bids/${b.id}`)}>
                      <td className="col-company">
                        <Link className="row-link" to={`/bids/${b.id}`} onClick={(e) => e.stopPropagation()}>
                          {b.title}
                        </Link>
                        {b.location && <span className="cell-sub">{b.location}</span>}
                      </td>
                      <td className={b.client ? "" : "cell-muted"}>{b.client?.name ?? t.sales.noClient}</td>
                      <td><BidStatusTag status={b.status} /></td>
                      <td className="nowrap">
                        {b.due_date ? formatDate(b.due_date, t.locale) : "—"}
                        <DueNote bid={b} today={today} />
                      </td>
                      <td className="num nowrap">{formatMoney(b.our_price, t.locale)}</td>
                      <MarginCell price={b.our_price} cost={b.estimated_value} locale={t.locale} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}

function MarginCell({ price, cost, locale }: { price: number | null; cost: number | null; locale: string }) {
  const m = marginOf(price, cost);
  if (!m) return <td className="num cell-muted">—</td>;
  return (
    <td className={`num${m.amount < 0 ? " is-negative" : ""}`}>
      {m.pct !== null ? formatPct(m.pct, locale) : "—"}
      <span className="cell-sub">{formatMoney(m.amount, locale)}</span>
    </td>
  );
}
