import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  BID_COLUMNS,
  BID_STATUSES,
  CLIENT_TYPES,
  formatMoney,
  formatPct,
  marginOf,
  parseMoney,
  type Bid,
  type BidStatus,
  type ClientType,
} from "../../lib/sales";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

type Values = {
  title: string;
  client_id: string;
  status: BidStatus;
  due_date: string;
  location: string;
  scope: string;
  estimated_value: string;
  our_price: string;
  notes: string;
};

const EMPTY: Values = {
  title: "",
  client_id: "",
  status: "new",
  due_date: "",
  location: "",
  scope: "",
  estimated_value: "",
  our_price: "",
  notes: "",
};

const moneyText = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/** Create (/bids/nuevo, optionally ?cliente=<id>) and edit (/bids/:id/editar). */
export default function BidForm() {
  const { id } = useParams();
  const editing = !!id;
  const [params] = useSearchParams();
  const t = useT();
  const navigate = useNavigate();

  const [values, setValues] = useState<Values>({ ...EMPTY, client_id: params.get("cliente") ?? "" });
  const [clients, setClients] = useState<{ id: string; name: string }[] | null>(null);
  const [newClient, setNewClient] = useState<{ name: string; type: ClientType } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [c, b] = await Promise.all([
        supabase.from("clients").select("id, name").order("name"),
        id ? supabase.from("bids").select(BID_COLUMNS).eq("id", id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active) return;
      setLoading(false);
      if (c.error || b.error || (id && !b.data)) return setLoadFailed(true);
      setClients((c.data ?? []) as { id: string; name: string }[]);
      if (b.data) {
        const bid = b.data as Bid;
        setValues({
          title: bid.title,
          client_id: bid.client_id ?? "",
          status: bid.status,
          due_date: bid.due_date ?? "",
          location: bid.location ?? "",
          scope: bid.scope ?? "",
          estimated_value: moneyText(bid.estimated_value),
          our_price: moneyText(bid.our_price),
          notes: bid.notes ?? "",
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  const estimated = parseMoney(values.estimated_value);
  const price = parseMoney(values.our_price);
  const preview =
    price !== null && estimated !== null && !Number.isNaN(price) && !Number.isNaN(estimated) ? marginOf(price, estimated) : null;
  const titleError = touched && !values.title.trim() ? t.sales.bidTitleRequired : null;
  const estimatedError = touched && Number.isNaN(estimated) ? t.sales.moneyInvalid : null;
  const priceError = touched && Number.isNaN(price) ? t.sales.moneyInvalid : null;
  const newClientError = touched && newClient && !newClient.name.trim() ? t.sales.newClientNameRequired : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!values.title.trim() || Number.isNaN(estimated) || Number.isNaN(price) || (newClient && !newClient.name.trim())) return;

    setBusy(true);
    let clientId: string | null = values.client_id || null;
    if (newClient) {
      const created = await supabase
        .from("clients")
        .insert({ name: newClient.name.trim(), type: newClient.type })
        .select("id")
        .single();
      if (created.error || !created.data) {
        setBusy(false);
        return setError(t.sales.clientCreateFailed);
      }
      clientId = created.data.id;
      // Keep the form consistent if the bid save below fails and the user retries.
      setClients((list) => [...(list ?? []), { id: created.data.id, name: newClient.name.trim() }]);
      setValues((v) => ({ ...v, client_id: created.data.id }));
      setNewClient(null);
    }

    const blank = (v: string) => (v.trim() ? v.trim() : null);
    const payload = {
      title: values.title.trim(),
      client_id: clientId,
      status: values.status,
      due_date: values.due_date || null,
      location: blank(values.location),
      scope: blank(values.scope),
      estimated_value: estimated,
      our_price: price,
      notes: blank(values.notes),
    };
    const result = editing
      ? await supabase.from("bids").update(payload).eq("id", id!).select("id").single()
      : await supabase.from("bids").insert(payload).select("id").single();
    setBusy(false);
    if (result.error || !result.data) return setError(t.sales.saveFailed);
    navigate(`/bids/${result.data.id}`, { replace: editing });
  };

  const fromClient = !editing && params.get("cliente");
  const backTo = editing ? `/bids/${id}` : fromClient ? `/clientes/${fromClient}` : "/bids";
  const backLabel = editing
    ? values.title || t.sales.bidOne
    : fromClient
      ? clients?.find((c) => c.id === fromClient)?.name ?? t.sales.clientOne
      : t.sales.bidsTitle;

  if (loading) return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (loadFailed)
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>
          {t.sales.bidNotFound} <Link to="/bids">{t.sales.bidsTitle}</Link>
        </p>
      </div>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {backLabel}</Link>
      <PageHeader title={editing ? t.sales.editBidTitle : t.sales.newBidTitle} />

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.sectionProject}</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${titleError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="title">{t.sales.bidTitle}</label>
              <input
                id="title"
                className="gh-input"
                autoFocus={!editing}
                placeholder={t.sales.bidTitlePlaceholder}
                value={values.title}
                onChange={(e) => set("title", e.target.value)}
                aria-invalid={!!titleError}
                aria-describedby={titleError ? "title-error" : undefined}
              />
              {titleError && <p className="gh-error" id="title-error">{titleError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="status">{t.sales.status}</label>
              <select id="status" className="gh-input gh-select" value={values.status} onChange={(e) => set("status", e.target.value as BidStatus)}>
                {BID_STATUSES.map((s) => (
                  <option key={s} value={s}>{t.sales.bidStatuses[s]}</option>
                ))}
              </select>
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="due_date">{t.sales.dueDate}</label>
              <input id="due_date" className="gh-input" type="date" value={values.due_date} onChange={(e) => set("due_date", e.target.value)} />
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="location">{t.sales.location}</label>
              <input id="location" className="gh-input" placeholder={t.sales.locationPlaceholder} value={values.location} onChange={(e) => set("location", e.target.value)} />
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="scope">{t.sales.scope}</label>
              <textarea id="scope" className="gh-input gh-textarea" rows={3} placeholder={t.sales.scopePlaceholder} value={values.scope} onChange={(e) => set("scope", e.target.value)} />
            </div>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.sectionClient}</legend>
          {!newClient ? (
            <div className="form-grid">
              <div className="gh-field span-2">
                <label className="gh-field-label" htmlFor="client_id">{t.sales.client}</label>
                <select id="client_id" className="gh-input gh-select" value={values.client_id} onChange={(e) => set("client_id", e.target.value)}>
                  <option value="">{t.sales.chooseClient}</option>
                  {(clients ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="span-2">
                <button className="gh-link" type="button" onClick={() => setNewClient({ name: "", type: "general_contractor" })}>
                  + {t.sales.addNewClient}
                </button>
              </div>
            </div>
          ) : (
            <div className="form-grid">
              <div className={`gh-field${newClientError ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="new-client-name">{t.sales.newClientName}</label>
                <input
                  id="new-client-name"
                  className="gh-input"
                  autoFocus
                  value={newClient.name}
                  onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                  aria-invalid={!!newClientError}
                  aria-describedby={newClientError ? "new-client-error" : undefined}
                />
                {newClientError && <p className="gh-error" id="new-client-error">{newClientError}</p>}
              </div>
              <div className="gh-field">
                <label className="gh-field-label" htmlFor="new-client-type">{t.sales.type}</label>
                <select
                  id="new-client-type"
                  className="gh-input gh-select"
                  value={newClient.type}
                  onChange={(e) => setNewClient({ ...newClient, type: e.target.value as ClientType })}
                >
                  {CLIENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{t.sales.clientTypes[ct]}</option>
                  ))}
                </select>
              </div>
              <div className="span-2">
                <button className="gh-link" type="button" onClick={() => setNewClient(null)}>
                  {t.sales.pickExistingClient}
                </button>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.sectionMoney}</legend>
          <div className="form-grid">
            <MoneyField id="our_price" label={t.sales.ourPrice} help={t.sales.ourPriceHelp} value={values.our_price} error={priceError} onChange={(v) => set("our_price", v)} />
            <MoneyField
              id="estimated_value"
              label={t.sales.estimatedValue}
              help={t.sales.estimatedValueHelp}
              value={values.estimated_value}
              error={estimatedError}
              onChange={(v) => set("estimated_value", v)}
            />
            {preview && (
              <p className={`margin-preview span-2${preview.amount < 0 ? " is-negative" : ""}`} aria-live="polite">
                {t.sales.marginPreview(formatMoney(preview.amount, t.locale), formatPct(preview.pct, t.locale))}
                {preview.amount < 0 && ` · ${t.sales.marginNegative}`}
              </p>
            )}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.sales.notes}</legend>
          <div className="gh-field">
            <label className="gh-field-label visually-hidden" htmlFor="notes">{t.sales.notes}</label>
            <textarea id="notes" className="gh-input gh-textarea" rows={4} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
            <p className="gh-help">{t.sales.notesHelp}</p>
          </div>
        </fieldset>

        {error && (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{error}</p>
          </div>
        )}

        <div className="form-actions">
          <button className="gh-btn gh-btn-primary" type="submit" disabled={busy}>
            {busy ? t.common.saving : editing ? t.sales.saveChanges : t.sales.createBid}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}

function MoneyField({
  id,
  label,
  help,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  value: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`gh-field${error ? " is-error" : ""}`}>
      <label className="gh-field-label" htmlFor={id}>{label}</label>
      <div className="money-input">
        <span aria-hidden="true">$</span>
        <input
          id={id}
          className="gh-input"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={`${id}-help`}
        />
      </div>
      {error ? <p className="gh-error" id={`${id}-help`}>{error}</p> : <p className="gh-help" id={`${id}-help`}>{help}</p>}
    </div>
  );
}
