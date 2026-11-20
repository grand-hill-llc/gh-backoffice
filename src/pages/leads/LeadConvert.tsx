import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { LEAD_COLUMNS, OPEN_LEAD_STATUSES, type Lead } from "../../lib/leads";
import { CLIENT_TYPES, type ClientType } from "../../lib/sales";
import { PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { useT } from "../../i18n";

type ClientOption = { id: string; name: string; email: string | null };

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/** A client that is very likely the same as the lead: same email, or same company / person name. */
function findMatch(lead: Lead, clients: ClientOption[]): ClientOption | null {
  const email = norm(lead.email);
  if (email) {
    const byEmail = clients.find((c) => norm(c.email) === email);
    if (byEmail) return byEmail;
  }
  const names = [norm(lead.company), norm(lead.name)].filter(Boolean);
  return clients.find((c) => names.includes(norm(c.name))) ?? null;
}

/** /leads/:id/convertir — the lead becomes a client (new or existing) plus a bid, in one database transaction. */
export default function LeadConvert() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();

  const [lead, setLead] = useState<Lead | null>(null);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [suggested, setSuggested] = useState<ClientOption | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "closed" | "error">("loading");

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [clientId, setClientId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientType, setClientType] = useState<ClientType>("direct_commercial");
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [scope, setScope] = useState("");
  const [dueDate, setDueDate] = useState("");

  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [l, c] = await Promise.all([
        supabase.from("leads").select(LEAD_COLUMNS).eq("id", id!).maybeSingle(),
        supabase.from("clients").select("id, name, email").order("name"),
      ]);
      if (!active) return;
      if (l.error || c.error) return setState("error");
      if (!l.data) return setState("missing");
      const ld = l.data as Lead;
      const list = (c.data ?? []) as ClientOption[];
      setLead(ld);
      setClients(list);
      if (!OPEN_LEAD_STATUSES.includes(ld.status)) return setState("closed");

      // Pre-fill from what the lead already knows.
      const match = findMatch(ld, list);
      setSuggested(match);
      setMode(match ? "existing" : "new");
      setClientId(match?.id ?? "");
      setClientName(ld.company || ld.name);
      setClientType(ld.company ? "direct_commercial" : "residential");
      const interest = (ld.interest ?? "").trim();
      setTitle(interest && interest.length <= 70 ? interest : ld.company || ld.name);
      setLocation(ld.location ?? "");
      setScope(interest);
      setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const clientNameError = touched && mode === "new" && !clientName.trim() ? t.leads.clientNameRequired : null;
  const clientPickError = touched && mode === "existing" && !clientId ? t.leads.pickClient : null;
  const titleError = touched && !title.trim() ? t.leads.bidTitleRequired : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    setTouched(true);
    setError(null);
    if ((mode === "new" && !clientName.trim()) || (mode === "existing" && !clientId) || !title.trim()) return;

    setBusy(true);
    const { data, error } = await supabase.rpc("convert_lead", {
      p_lead_id: lead.id,
      p_client_id: mode === "existing" ? clientId : null,
      p_new_client:
        mode === "new"
          ? { name: clientName.trim(), type: clientType, contact_name: lead.name, email: lead.email, phone: lead.phone }
          : null,
      p_bid: { title: title.trim(), location: location.trim(), scope: scope.trim(), due_date: dueDate, status: "new" },
      p_note: t.leads.convertedActivity,
    });
    setBusy(false);
    if (error || !data) {
      const msg = error?.message ?? "";
      return setError(
        /could not find the function/i.test(msg)
          ? t.leads.missingFunction
          : /lead_not_open/i.test(msg)
            ? t.leads.notOpen
            : t.leads.convertFailed
      );
    }
    navigate(`/bids/${(data as { bid_id: string }).bid_id}`, { replace: true });
  };

  const backTo = `/leads/${id}`;

  if (state === "loading") return <p className="gh-muted" role="status">{t.common.loading}</p>;
  if (state !== "ready" || !lead)
    return (
      <>
        <Link className="back-link" to={state === "missing" ? "/leads" : backTo}>← {lead?.name ?? t.leads.title}</Link>
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{state === "missing" ? t.leads.notFound : state === "closed" ? t.leads.notOpen : t.leads.loadOneFailed}</p>
        </div>
      </>
    );

  return (
    <>
      <Link className="back-link" to={backTo}>← {lead.name}</Link>
      <PageHeader title={t.leads.convertTitle} />
      <p className="form-intro gh-muted">{t.leads.convertIntro(lead.name)}</p>

      <form className="gh-form panel-form" onSubmit={onSubmit} noValidate>
        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.clientSection}</legend>
          <div className="segmented choice-segmented" role="group" aria-label={t.leads.clientSection}>
            <button type="button" aria-pressed={mode === "new"} onClick={() => setMode("new")}>{t.leads.newClientOption}</button>
            <button type="button" aria-pressed={mode === "existing"} onClick={() => setMode("existing")} disabled={clients.length === 0}>
              {t.leads.existingClientOption}
            </button>
          </div>

          {mode === "existing" && suggested && clientId === suggested.id && (
            <p className="gh-help suggestion">{t.leads.suggested(suggested.name)}</p>
          )}

          {mode === "new" ? (
            <div className="form-grid">
              <div className={`gh-field span-2${clientNameError ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="client-name">{t.leads.clientName}</label>
                <input
                  id="client-name"
                  className="gh-input"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  aria-invalid={!!clientNameError}
                  aria-describedby={clientNameError ? "client-name-error" : "client-name-help"}
                />
                {clientNameError ? (
                  <p className="gh-error" id="client-name-error">{clientNameError}</p>
                ) : (
                  <p className="gh-help" id="client-name-help">{t.leads.clientNameHelp}</p>
                )}
              </div>
              <div className="gh-field">
                <label className="gh-field-label" htmlFor="client-type">{t.leads.clientType}</label>
                <select id="client-type" className="gh-input gh-select" value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
                  {CLIENT_TYPES.map((ct) => (
                    <option key={ct} value={ct}>{t.sales.clientTypes[ct]}</option>
                  ))}
                </select>
              </div>
              <p className="gh-help span-2 carry-over">
                {[lead.name, lead.email, lead.phone].filter(Boolean).join(" · ")}
              </p>
            </div>
          ) : (
            <div className={`gh-field${clientPickError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="client-id">{t.leads.clientSection}</label>
              <select
                id="client-id"
                className="gh-input gh-select"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                aria-invalid={!!clientPickError}
                aria-describedby={clientPickError ? "client-id-error" : undefined}
              >
                <option value="">{t.leads.chooseClient}</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {clientPickError && <p className="gh-error" id="client-id-error">{clientPickError}</p>}
            </div>
          )}
        </fieldset>

        <fieldset className="form-section">
          <legend className="gh-label">{t.leads.bidSection}</legend>
          <div className="form-grid">
            <div className={`gh-field span-2${titleError ? " is-error" : ""}`}>
              <label className="gh-field-label" htmlFor="bid-title">{t.leads.bidTitle}</label>
              <input
                id="bid-title"
                className="gh-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={!!titleError}
                aria-describedby={titleError ? "bid-title-error" : undefined}
              />
              {titleError && <p className="gh-error" id="bid-title-error">{titleError}</p>}
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="bid-location">{t.leads.location}</label>
              <input id="bid-location" className="gh-input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="bid-due">{t.leads.dueDate}</label>
              <input id="bid-due" className="gh-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="gh-field span-2">
              <label className="gh-field-label" htmlFor="bid-scope">{t.sales.scope}</label>
              <textarea id="bid-scope" className="gh-input gh-textarea" rows={3} value={scope} onChange={(e) => setScope(e.target.value)} />
            </div>
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
            {busy ? t.leads.converting : t.leads.convertNow}
          </button>
          <Link className="gh-link" to={backTo}>{t.common.cancel}</Link>
        </div>
      </form>
    </>
  );
}
