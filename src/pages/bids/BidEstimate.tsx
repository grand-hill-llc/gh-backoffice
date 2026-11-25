import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  cheapestQuotes,
  DEFAULT_MARKUP,
  ESTIMATE_LINE_COLUMNS,
  estimateTotals,
  lineAmounts,
  SUB_QUOTE_COLUMNS,
  type EstimateLine,
  type SubQuote,
} from "../../lib/estimates";
import { formatMoney, formatPct, parseMoney } from "../../lib/sales";
import { formatDate, todayISO } from "../../lib/subcontractors";
import { Panel } from "../../components/Panel";
import MoneyField from "../../components/MoneyField";
import { Tag } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { normalizeTrade, tradeLabel, useT } from "../../i18n";

type Sub = { id: string; company_name: string; trades: string[] };
/** A line being written: new (maybe from a quote) or an existing one being edited. */
type Draft = { line?: EstimateLine; quote?: SubQuote };

type Props = {
  bidId: string;
  /** New totals after any change, so the bid's cards update at once. null = the bid has no lines. */
  onTotals: (totals: { cost: number; price: number } | null) => void;
};

const UNITS = ["global", "sq ft", "lf", "unidad", "hora", "día"];

/** How the bid's price is built: subcontractor quotes per trade and the estimate lines with markup. */
export default function BidEstimate({ bidId, onTotals }: Props) {
  const t = useT();
  const e = t.estimates;
  const [quotes, setQuotes] = useState<SubQuote[]>([]);
  const [lines, setLines] = useState<EstimateLine[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [defaultMarkup, setDefaultMarkup] = useState(DEFAULT_MARKUP);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [quoteForm, setQuoteForm] = useState<SubQuote | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [q, l, s, cfg] = await Promise.all([
      supabase.from("sub_quotes").select(SUB_QUOTE_COLUMNS).eq("bid_id", bidId).order("received_on", { ascending: false }),
      supabase.from("estimate_lines").select(ESTIMATE_LINE_COLUMNS).eq("bid_id", bidId).order("position").order("created_at"),
      supabase.from("subcontractors").select("id, company_name, trades").order("company_name"),
      supabase.from("app_settings").select("default_markup_pct").maybeSingle(),
    ]);
    const err = q.error ?? l.error ?? s.error;
    if (err) {
      setState(/schema cache|does not exist|relation/i.test(err.message) ? "missing" : "failed");
      return null;
    }
    const nextLines = (l.data ?? []) as EstimateLine[];
    setQuotes((q.data ?? []) as SubQuote[]);
    setLines(nextLines);
    setSubs((s.data ?? []) as Sub[]);
    if (!cfg.error && cfg.data) setDefaultMarkup(Number((cfg.data as { default_markup_pct: number }).default_markup_pct));
    setState("ready");
    return nextLines;
  }, [bidId]);

  /** Passes the totals up (the database keeps the bid's own totals in sync with the lines). */
  const report = useCallback(
    (next: EstimateLine[] | null) => {
      if (!next) return;
      const totals = estimateTotals(next);
      onTotals(next.length ? { cost: totals.cost, price: totals.price } : null);
    },
    [onTotals]
  );

  useEffect(() => {
    load().then(report);
    // Only on first load: later changes report through refresh().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const refresh = async () => report(await load());

  const subName = (id: string) => subs.find((s) => s.id === id)?.company_name ?? "—";
  const cheapest = useMemo(() => cheapestQuotes(quotes), [quotes]);
  const usedQuotes = useMemo(() => new Set(lines.map((l) => l.sub_quote_id).filter(Boolean)), [lines]);
  const totals = estimateTotals(lines);
  const money = (v: number) => formatMoney(v, t.locale);
  const today = todayISO();

  const removeLine = async (line: EstimateLine) => {
    setRowError(null);
    const { error } = await supabase.from("estimate_lines").delete().eq("id", line.id);
    setPendingDelete(null);
    if (error) return setRowError(e.deleteFailed);
    await refresh();
  };

  const removeQuote = async (quote: SubQuote) => {
    setRowError(null);
    const { error } = await supabase.from("sub_quotes").delete().eq("id", quote.id);
    setPendingDelete(null);
    if (error) return setRowError(e.deleteFailed);
    await refresh();
  };

  if (state === "loading") return null;
  if (state !== "ready")
    return (
      <div className="gh-notice is-error" role="alert">
        <AlertCircleIcon />
        <p>{state === "missing" ? e.missingTable : e.loadFailed}</p>
      </div>
    );

  return (
    <div className="estimate">
      <Panel
        title={e.linesTitle}
        action={
          !draft && (
            <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setDraft({})}>
              {e.addLine}
            </button>
          )
        }
      >
        {draft && !draft.line && (
          <LineForm
            bidId={bidId}
            draft={draft}
            defaultMarkup={defaultMarkup}
            nextPosition={lines.length ? Math.max(...lines.map((l) => l.position)) + 1 : 0}
            subName={subName}
            onCancel={() => setDraft(null)}
            onDone={async () => {
              setDraft(null);
              await refresh();
            }}
          />
        )}

        {rowError && (
          <div className="gh-notice is-error" role="alert">
            <AlertCircleIcon />
            <p>{rowError}</p>
          </div>
        )}

        {lines.length === 0 ? (
          !draft && <p className="panel-empty">{e.noLines}</p>
        ) : (
          <div className="table-wrap is-flush">
            <table className="gh-table estimate-table">
              <thead>
                <tr>
                  <th scope="col">{e.line}</th>
                  <th scope="col" className="num">{e.quantity}</th>
                  <th scope="col" className="num">{e.cost}</th>
                  <th scope="col" className="num">{e.markup}</th>
                  <th scope="col" className="num">{e.price}</th>
                  <th scope="col"><span className="visually-hidden">{t.common.edit}</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) =>
                  draft?.line?.id === l.id ? (
                    <tr key={l.id} className="is-open">
                      <td colSpan={6}>
                        <LineForm
                          bidId={bidId}
                          draft={draft}
                          defaultMarkup={defaultMarkup}
                          nextPosition={l.position}
                          subName={subName}
                          onCancel={() => setDraft(null)}
                          onDone={async () => {
                            setDraft(null);
                            await refresh();
                          }}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr key={l.id}>
                      <td>
                        {l.description}
                        <span className="cell-sub">
                          {[l.trade ? tradeLabel(l.trade, t) : null, l.sub_quote_id ? e.fromQuoteOf(subName(quotes.find((q) => q.id === l.sub_quote_id)?.subcontractor_id ?? "")) : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </td>
                      <td className="num nowrap">
                        {Number(l.quantity).toLocaleString(t.locale)} {l.unit ?? ""}
                        {Number(l.quantity) !== 1 && <span className="cell-sub">× {money(Number(l.unit_cost))}</span>}
                      </td>
                      <td className="num nowrap">{money(Number(l.cost_amount))}</td>
                      <td className="num nowrap">{formatPct(Number(l.markup_pct) / 100, t.locale)}</td>
                      <td className="num nowrap"><strong>{money(Number(l.price_amount))}</strong></td>
                      <td className="nowrap row-actions">
                        {pendingDelete === l.id ? (
                          <>
                            <button className="text-btn is-danger" type="button" onClick={() => removeLine(l)}>{t.common.confirm}</button>
                            <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                          </>
                        ) : (
                          <>
                            <button className="text-btn" type="button" onClick={() => setDraft({ line: l })}>{t.common.edit}</button>
                            <button className="text-btn" type="button" onClick={() => setPendingDelete(l.id)} aria-label={e.deleteLineLabel(l.description)}>
                              {t.common.delete}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{e.total}</th>
                  <td />
                  <td className="num nowrap">{money(totals.cost)}</td>
                  <td className="num nowrap">{totals.markupPct !== null ? formatPct(totals.markupPct, t.locale) : "—"}</td>
                  <td className="num nowrap"><strong>{money(totals.price)}</strong></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {lines.length > 0 && (
          <p className="gh-small gh-muted">
            {e.marginNote(money(totals.margin), totals.marginPct !== null ? formatPct(totals.marginPct, t.locale) : "—")}
          </p>
        )}
      </Panel>

      <Panel
        title={e.quotesTitle}
        action={
          quoteForm === null && (
            <button className="gh-btn gh-btn-secondary gh-btn-sm" type="button" onClick={() => setQuoteForm("new")}>
              {e.addQuote}
            </button>
          )
        }
      >
        {quoteForm === "new" && (
          <QuoteForm
            bidId={bidId}
            subs={subs}
            onCancel={() => setQuoteForm(null)}
            onDone={async () => {
              setQuoteForm(null);
              await refresh();
            }}
          />
        )}

        {quotes.length === 0 ? (
          quoteForm === null && <p className="panel-empty">{e.noQuotes}</p>
        ) : (
          <ul className="doc-list">
            {quotes.map((q) =>
              quoteForm !== null && quoteForm !== "new" && quoteForm.id === q.id ? (
                <li key={q.id} className="doc-item is-editing">
                  <QuoteForm
                    bidId={bidId}
                    subs={subs}
                    initial={q}
                    onCancel={() => setQuoteForm(null)}
                    onDone={async () => {
                      setQuoteForm(null);
                      await refresh();
                    }}
                  />
                </li>
              ) : (
                <li key={q.id} className="doc-item">
                  <div className="doc-main">
                    <p className="doc-type">
                      <Link className="row-link" to={`/subcontratistas/${q.subcontractor_id}`}>{subName(q.subcontractor_id)}</Link>
                      {q.trade && <span className="gh-muted"> · {tradeLabel(q.trade, t)}</span>}
                    </p>
                    <p className="quote-amount">{money(Number(q.amount))}</p>
                    <p className="gh-small gh-muted">
                      {[
                        e.receivedOn(formatDate(q.received_on, t.locale)),
                        q.valid_until ? e.validUntil(formatDate(q.valid_until, t.locale)) : null,
                        q.reference,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {q.notes && <p className="gh-small doc-notes">{q.notes}</p>}
                  </div>
                  <div className="doc-side">
                    <div className="tag-row">
                      {cheapest.has(q.id) && <Tag tone="success">{e.cheapest}</Tag>}
                      {q.valid_until && q.valid_until < today && <Tag tone="danger">{e.expired}</Tag>}
                      {usedQuotes.has(q.id) && <Tag tone="strong">{e.inEstimate}</Tag>}
                    </div>
                    <div className="doc-actions">
                      {pendingDelete === q.id ? (
                        <>
                          <button className="text-btn is-danger" type="button" onClick={() => removeQuote(q)}>{t.common.confirm}</button>
                          <button className="text-btn" type="button" onClick={() => setPendingDelete(null)}>{t.common.no}</button>
                        </>
                      ) : (
                        <>
                          {!usedQuotes.has(q.id) && !draft && (
                            <button className="text-btn" type="button" onClick={() => setDraft({ quote: q })}>{e.useQuote}</button>
                          )}
                          <button className="text-btn" type="button" onClick={() => setQuoteForm(q)}>{t.common.edit}</button>
                          <button className="text-btn" type="button" onClick={() => setPendingDelete(q.id)} aria-label={e.deleteQuoteLabel(subName(q.subcontractor_id))}>
                            {t.common.delete}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              )
            )}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function LineForm({
  bidId,
  draft,
  defaultMarkup,
  nextPosition,
  subName,
  onCancel,
  onDone,
}: {
  bidId: string;
  draft: Draft;
  defaultMarkup: number;
  nextPosition: number;
  subName: (id: string) => string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const e = t.estimates;
  const { line, quote } = draft;
  const [description, setDescription] = useState(line?.description ?? (quote?.trade ? tradeLabel(quote.trade, t) : ""));
  const [trade, setTrade] = useState(line?.trade ? tradeLabel(line.trade, t) : quote?.trade ? tradeLabel(quote.trade, t) : "");
  const [quantity, setQuantity] = useState(String(line?.quantity ?? 1));
  const [unit, setUnit] = useState(line?.unit ?? (quote ? "global" : ""));
  const [unitCost, setUnitCost] = useState(line ? String(line.unit_cost) : quote ? String(quote.amount) : "");
  const [markup, setMarkup] = useState(String(line?.markup_pct ?? defaultMarkup));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qty = Number(quantity.replace(",", "."));
  const cost = parseMoney(unitCost);
  const pct = Number(markup.replace(",", "."));
  const qtyOk = Number.isFinite(qty) && qty > 0;
  const costOk = cost !== null && !Number.isNaN(cost);
  const pctOk = markup.trim() !== "" && Number.isFinite(pct) && pct >= 0 && pct <= 500;
  const preview = qtyOk && costOk && pctOk ? lineAmounts(qty, cost as number, pct) : null;

  const descError = touched && !description.trim() ? e.descriptionRequired : null;
  const qtyError = touched && !qtyOk ? e.quantityInvalid : null;
  const costError = touched && !costOk ? e.costRequired : null;
  const pctError = touched && !pctOk ? e.markupInvalid : null;

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    setError(null);
    if (!description.trim() || !qtyOk || !costOk || !pctOk) return;
    const values = {
      description: description.trim(),
      trade: trade.trim() ? normalizeTrade(trade) : null,
      quantity: qty,
      unit: unit.trim() || null,
      unit_cost: cost,
      markup_pct: pct,
    };
    setBusy(true);
    const { error } = line
      ? await supabase.from("estimate_lines").update(values).eq("id", line.id)
      : await supabase.from("estimate_lines").insert({ ...values, bid_id: bidId, position: nextPosition, sub_quote_id: quote?.id ?? null });
    setBusy(false);
    if (error) return setError(e.saveFailed);
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      {quote && <p className="gh-help">{e.fromQuoteNote(subName(quote.subcontractor_id), formatMoney(Number(quote.amount), t.locale))}</p>}
      <div className="form-grid">
        <div className={`gh-field span-2${descError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="line-description">{e.description}</label>
          <input
            id="line-description"
            className="gh-input"
            autoFocus
            placeholder={e.descriptionPlaceholder}
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            aria-invalid={!!descError}
            aria-describedby="line-description-help"
          />
          {descError ? (
            <p className="gh-error" id="line-description-help">{descError}</p>
          ) : (
            <p className="gh-help" id="line-description-help">{e.descriptionHelp}</p>
          )}
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="line-trade">{e.trade}</label>
          <input id="line-trade" className="gh-input" list="line-trade-options" value={trade} onChange={(ev) => setTrade(ev.target.value)} />
          <datalist id="line-trade-options">
            {Object.values(t.subs.trades).map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
        <div className="form-grid-pair">
          <div className={`gh-field${qtyError ? " is-error" : ""}`}>
            <label className="gh-field-label" htmlFor="line-qty">{e.quantity}</label>
            <input id="line-qty" className="gh-input" inputMode="decimal" value={quantity} onChange={(ev) => setQuantity(ev.target.value)} aria-invalid={!!qtyError} />
            {qtyError && <p className="gh-error">{qtyError}</p>}
          </div>
          <div className="gh-field">
            <label className="gh-field-label" htmlFor="line-unit">{e.unit}</label>
            <input id="line-unit" className="gh-input" list="line-unit-options" value={unit} onChange={(ev) => setUnit(ev.target.value)} />
            <datalist id="line-unit-options">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
        </div>
        <MoneyField id="line-cost" label={e.unitCost} help={e.unitCostHelp} value={unitCost} error={costError} onChange={setUnitCost} />
        <div className={`gh-field${pctError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="line-markup">{e.markupLabel}</label>
          <div className="pct-input">
            <input id="line-markup" className="gh-input" inputMode="decimal" value={markup} onChange={(ev) => setMarkup(ev.target.value)} aria-invalid={!!pctError} aria-describedby="line-markup-help" />
            <span aria-hidden="true">%</span>
          </div>
          {pctError ? <p className="gh-error" id="line-markup-help">{pctError}</p> : <p className="gh-help" id="line-markup-help">{e.markupHelp}</p>}
        </div>
      </div>
      {preview && (
        <p className="estimate-preview" role="status">
          {e.preview(formatMoney(preview.cost, t.locale), formatMoney(preview.price, t.locale))}
        </p>
      )}
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy}>
          {busy ? t.common.saving : line ? t.projects.saveChanges : e.saveLine}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}

function QuoteForm({
  bidId,
  subs,
  initial,
  onCancel,
  onDone,
}: {
  bidId: string;
  subs: Sub[];
  initial?: SubQuote;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const e = t.estimates;
  const [subId, setSubId] = useState(initial?.subcontractor_id ?? "");
  const [trade, setTrade] = useState(initial?.trade ? tradeLabel(initial.trade, t) : "");
  const [amount, setAmount] = useState(initial ? String(initial.amount) : "");
  const [receivedOn, setReceivedOn] = useState(initial?.received_on ?? todayISO());
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? "");
  const [reference, setReference] = useState(initial?.reference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = parseMoney(amount);
  const amountOk = parsed !== null && !Number.isNaN(parsed);
  const datesOk = !validUntil || !receivedOn || validUntil >= receivedOn;
  const subError = touched && !subId ? e.subRequired : null;
  const amountError = touched && !amountOk ? e.amountRequired : null;
  const datesError = touched && !datesOk ? e.datesInvalid : null;
  const subTrades = subs.find((s) => s.id === subId)?.trades ?? [];

  const onSubmit = async (ev: FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    setError(null);
    if (!subId || !amountOk || !datesOk) return;
    const values = {
      subcontractor_id: subId,
      trade: trade.trim() ? normalizeTrade(trade) : null,
      amount: parsed,
      received_on: receivedOn || todayISO(),
      valid_until: validUntil || null,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    };
    setBusy(true);
    const { error } = initial
      ? await supabase.from("sub_quotes").update(values).eq("id", initial.id)
      : await supabase.from("sub_quotes").insert({ ...values, bid_id: bidId });
    setBusy(false);
    if (error) return setError(e.saveFailed);
    onDone();
  };

  return (
    <form className="upload-form" onSubmit={onSubmit} noValidate>
      <div className="form-grid">
        <div className={`gh-field${subError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="quote-sub">{e.sub}</label>
          {subs.length === 0 ? (
            <p className="gh-help">{t.projects.noSubsInDirectory}</p>
          ) : (
            <select
              id="quote-sub"
              className="gh-input gh-select"
              value={subId}
              onChange={(ev) => {
                setSubId(ev.target.value);
                const first = subs.find((s) => s.id === ev.target.value)?.trades[0];
                if (!trade && first) setTrade(tradeLabel(first, t));
              }}
              aria-invalid={!!subError}
            >
              <option value="">{t.projects.chooseSub}</option>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>{s.company_name}</option>
              ))}
            </select>
          )}
          {subError && <p className="gh-error">{subError}</p>}
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="quote-trade">{e.trade}</label>
          <input id="quote-trade" className="gh-input" list="quote-trade-options" value={trade} onChange={(ev) => setTrade(ev.target.value)} />
          <datalist id="quote-trade-options">
            {(subTrades.length ? subTrades.map((x) => tradeLabel(x, t)) : Object.values(t.subs.trades)).map((label) => (
              <option key={label} value={label} />
            ))}
          </datalist>
        </div>
        <MoneyField id="quote-amount" label={e.quoteAmount} help="" value={amount} error={amountError} onChange={setAmount} />
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="quote-reference">{t.projects.reference}</label>
          <input id="quote-reference" className="gh-input" placeholder={e.referencePlaceholder} value={reference} onChange={(ev) => setReference(ev.target.value)} />
        </div>
        <div className="gh-field">
          <label className="gh-field-label" htmlFor="quote-received">{e.received}</label>
          <input id="quote-received" className="gh-input" type="date" value={receivedOn} onChange={(ev) => setReceivedOn(ev.target.value)} />
        </div>
        <div className={`gh-field${datesError ? " is-error" : ""}`}>
          <label className="gh-field-label" htmlFor="quote-valid">{e.valid}</label>
          <input id="quote-valid" className="gh-input" type="date" value={validUntil} onChange={(ev) => setValidUntil(ev.target.value)} aria-invalid={!!datesError} />
          {datesError && <p className="gh-error">{datesError}</p>}
        </div>
        <div className="gh-field span-2">
          <label className="gh-field-label" htmlFor="quote-notes">{t.projects.notes}</label>
          <input id="quote-notes" className="gh-input" placeholder={e.notesPlaceholder} value={notes} onChange={(ev) => setNotes(ev.target.value)} />
        </div>
      </div>
      {error && (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{error}</p>
        </div>
      )}
      <div className="form-actions">
        <button className="gh-btn gh-btn-primary gh-btn-sm" type="submit" disabled={busy || subs.length === 0}>
          {busy ? t.common.saving : initial ? t.projects.saveChanges : e.saveQuote}
        </button>
        <button className="gh-link" type="button" onClick={onCancel} disabled={busy}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
