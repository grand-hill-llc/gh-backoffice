import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { BID_COLUMNS, CLIENT_COLUMNS, formatMoney, type Bid, type Client } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Tag } from "../../components/ui";
import DeleteZone from "../../components/DeleteZone";
import { AlertCircleIcon } from "../Icons";
import { BidStatusTag, DueNote } from "../bids/bidTags";
import { useT } from "../../i18n";

export default function ClientDetail() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [c, b] = await Promise.all([
        supabase.from("clients").select(CLIENT_COLUMNS).eq("id", id!).maybeSingle(),
        supabase.from("bids").select(BID_COLUMNS).eq("client_id", id!).order("due_date", { ascending: false, nullsFirst: true }),
      ]);
      if (!active) return;
      if (c.error || b.error) setState("error");
      else if (!c.data) setState("missing");
      else {
        setClient(c.data as Client);
        setBids((b.data ?? []) as Bid[]);
        setState("ready");
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const onDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const { error } = await supabase.from("clients").delete().eq("id", id!);
    if (error) {
      setDeleting(false);
      setDeleteError(t.sales.deleteClientFailed);
      return;
    }
    navigate("/clientes", { replace: true });
  };

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !client)
    return (
      <>
        <Link className="back-link" to="/clientes">← {t.sales.clientsTitle}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.sales.clientNotFound : t.sales.clientLoadOneFailed}</p>
        </div>
      </>
    );

  const today = todayISO();
  const won = bids.filter((b) => b.status === "won").length;
  const decided = bids.filter((b) => b.status === "won" || b.status === "lost").length;

  return (
    <>
      <Link className="back-link" to="/clientes">← {t.sales.clientsTitle}</Link>

      <header className="page-header detail-header">
        <div className="detail-title-row">
          <h1 className="gh-h2">{client.name}</h1>
          <div className="detail-actions">
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/clientes/${client.id}/editar`}>{t.common.edit}</Link>
          </div>
        </div>
        <div className="detail-meta">
          <Tag tone="strong">{t.sales.clientTypes[client.type]}</Tag>
          {decided > 0 && <span className="gh-small gh-muted">{t.sales.winRate(won, decided)}</span>}
        </div>
      </header>

      <div className="detail-grid">
        <section className="panel">
          <h2 className="panel-title gh-label">{t.sales.details}</h2>
          <dl className="facts">
            <Fact label={t.sales.contact} value={client.contact_name} />
            <Fact label={t.sales.email} value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
            <Fact label={t.sales.phone} value={client.phone} href={client.phone ? `tel:${client.phone.replace(/[^\d+]/g, "")}` : undefined} />
            <Fact label={t.sales.createdOn} value={formatDate(client.created_at, t.locale)} />
          </dl>
          {client.notes && (
            <>
              <h3 className="gh-label facts-notes-label">{t.sales.notes}</h3>
              <p className="facts-notes">{client.notes}</p>
            </>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title gh-label">{t.sales.clientBids}</h2>
            <Link className="gh-btn gh-btn-secondary gh-btn-sm" to={`/bids/nuevo?cliente=${client.id}`}>{t.sales.newBid}</Link>
          </div>
          {bids.length === 0 ? (
            <p className="gh-muted panel-empty">{t.sales.noClientBids}</p>
          ) : (
            <ul className="doc-list">
              {bids.map((b) => (
                <li key={b.id} className="doc-item">
                  <div className="doc-main">
                    <Link className="row-link" to={`/bids/${b.id}`}>{b.title}</Link>
                    <p className="gh-small gh-muted">
                      {b.due_date ? formatDate(b.due_date, t.locale) : "—"}
                      {b.our_price !== null && ` · ${formatMoney(b.our_price, t.locale)}`}
                    </p>
                    <DueNote bid={b} today={today} />
                  </div>
                  <div className="doc-side">
                    <BidStatusTag status={b.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <DeleteZone
        label={t.sales.deleteClient}
        message={t.sales.deleteClientConfirm(client.name, bids.length)}
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

export function Fact({ label, value, href }: { label: string; value: string | null; href?: string }) {
  return (
    <div className="fact">
      <dt className="gh-label">{label}</dt>
      <dd>{value ? href ? <a href={href}>{value}</a> : value : <span className="gh-muted">—</span>}</dd>
    </div>
  );
}
