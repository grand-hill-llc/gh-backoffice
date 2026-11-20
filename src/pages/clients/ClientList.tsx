import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { CLIENT_COLUMNS, CLIENT_TYPES, OPEN_STATUSES, type BidStatus, type Client, type ClientType } from "../../lib/sales";
import { EmptyState, PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

type BidCounts = { open: number; total: number };
type Loaded = { clients: Client[]; counts: Map<string, BidCounts> };

export default function ClientList() {
  const t = useT();
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<ClientType | "all">("all");

  useEffect(() => {
    let active = true;
    (async () => {
      const [clients, bids] = await Promise.all([
        supabase.from("clients").select(CLIENT_COLUMNS).order("name"),
        supabase.from("bids").select("client_id, status").not("client_id", "is", null),
      ]);
      if (!active) return;
      if (clients.error || bids.error) {
        setError(true);
        return;
      }
      const counts = new Map<string, BidCounts>();
      for (const b of (bids.data ?? []) as { client_id: string; status: BidStatus }[]) {
        const c = counts.get(b.client_id) ?? { open: 0, total: 0 };
        c.total += 1;
        if (OPEN_STATUSES.includes(b.status)) c.open += 1;
        counts.set(b.client_id, c);
      }
      setData({ clients: (clients.data ?? []) as Client[], counts });
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.clients.filter((c) => {
      if (type !== "all" && c.type !== type) return false;
      if (!q) return true;
      return [c.name, c.contact_name, c.email].filter(Boolean).some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [data, query, type]);

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.sales.eyebrow} title={t.sales.clientsTitle} description={t.sales.clientsDescription} />
        <Link className="gh-btn gh-btn-primary" to="/clientes/nuevo">
          {t.sales.newClient}
        </Link>
      </div>

      {error ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{t.sales.clientsLoadFailed}</p>
        </div>
      ) : !data ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : data.clients.length === 0 ? (
        <EmptyState title={t.sales.clientsEmptyTitle}>{t.sales.clientsEmptyBody}</EmptyState>
      ) : (
        <>
          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="client-search">{t.sales.search}</label>
              <input
                id="client-search"
                className="gh-input"
                type="search"
                placeholder={t.sales.clientSearchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="gh-field toolbar-wide">
              <label className="gh-field-label" htmlFor="client-type">{t.sales.type}</label>
              <select id="client-type" className="gh-input gh-select" value={type} onChange={(e) => setType(e.target.value as ClientType | "all")}>
                <option value="all">{t.sales.allTypes}</option>
                {CLIENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{t.sales.clientTypes[ct]}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">
            {filtered.length === data.clients.length
              ? t.sales.clientCount(data.clients.length)
              : t.sales.countFiltered(filtered.length, data.clients.length)}
          </p>

          {filtered.length === 0 ? (
            <EmptyState title={t.sales.noClientMatchTitle}>{t.sales.noClientMatchBody}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">{t.sales.colName}</th>
                    <th scope="col">{t.sales.colType}</th>
                    <th scope="col">{t.sales.colContact}</th>
                    <th scope="col">{t.sales.colBids}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const counts = data.counts.get(c.id) ?? { open: 0, total: 0 };
                    return (
                      <tr key={c.id} onClick={() => navigate(`/clientes/${c.id}`)}>
                        <td className="col-company">
                          <Link className="row-link" to={`/clientes/${c.id}`} onClick={(e) => e.stopPropagation()}>
                            {c.name}
                          </Link>
                        </td>
                        <td className="cell-muted">{t.sales.clientTypes[c.type]}</td>
                        <td className="col-contact">
                          {c.contact_name ?? "—"}
                          {(c.phone || c.email) && <span className="cell-sub nowrap">{c.phone ?? c.email}</span>}
                        </td>
                        <td className="cell-muted nowrap">{t.sales.bidsSummary(counts.open, counts.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
