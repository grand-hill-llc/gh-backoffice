// Estimates: subcontractor quotes and estimate lines. Mirrors supabase/migrations/0011_estimates.sql.

export type SubQuote = {
  id: string;
  bid_id: string;
  subcontractor_id: string;
  trade: string | null;
  amount: number;
  received_on: string;
  valid_until: string | null;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export type EstimateLine = {
  id: string;
  bid_id: string;
  position: number;
  trade: string | null;
  /** What the client reads in the proposal. */
  description: string;
  quantity: number;
  unit: string | null;
  unit_cost: number;
  markup_pct: number;
  sub_quote_id: string | null;
  /** Computed by the database with the same formula as lineAmounts(). */
  cost_amount: number;
  price_amount: number;
  created_at: string;
};

export const SUB_QUOTE_COLUMNS = "id, bid_id, subcontractor_id, trade, amount, received_on, valid_until, reference, notes, created_at";
export const ESTIMATE_LINE_COLUMNS =
  "id, bid_id, position, trade, description, quantity, unit, unit_cost, markup_pct, sub_quote_id, cost_amount, price_amount, created_at";

export const DEFAULT_MARKUP = 20;

/** Rounds to cents like Postgres round(x, 2) for positive amounts. */
export function cents(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

/** Cost = quantity × unit cost (to the cent); price = cost plus the markup (to the cent). */
export function lineAmounts(quantity: number, unitCost: number, markupPct: number): { cost: number; price: number } {
  const cost = cents(quantity * unitCost);
  return { cost, price: cents(cost * (1 + markupPct / 100)) };
}

/** margin = price − cost; marginPct is on the price (like the bid's margin); markupPct is on the cost (like each line). */
export type EstimateTotals = { cost: number; price: number; margin: number; marginPct: number | null; markupPct: number | null };

export function estimateTotals(lines: Pick<EstimateLine, "cost_amount" | "price_amount">[]): EstimateTotals {
  const cost = cents(lines.reduce((s, l) => s + Number(l.cost_amount), 0));
  const price = cents(lines.reduce((s, l) => s + Number(l.price_amount), 0));
  return {
    cost,
    price,
    margin: cents(price - cost),
    marginPct: price > 0 ? (price - cost) / price : null,
    markupPct: cost > 0 ? (price - cost) / cost : null,
  };
}

/** Normalized trade name, so "Pintura" and " pintura " compare as the same trade. */
const tradeKey = (t: string | null) => (t ?? "").trim().toLowerCase();

/** Ids of the lowest quote in each trade that has more than one quote. */
export function cheapestQuotes(quotes: Pick<SubQuote, "id" | "trade" | "amount">[]): Set<string> {
  const byTrade = new Map<string, Pick<SubQuote, "id" | "trade" | "amount">[]>();
  for (const q of quotes) {
    const k = tradeKey(q.trade);
    byTrade.set(k, [...(byTrade.get(k) ?? []), q]);
  }
  const ids = new Set<string>();
  for (const list of byTrade.values()) {
    if (list.length < 2) continue;
    const min = Math.min(...list.map((q) => Number(q.amount)));
    for (const q of list) if (Number(q.amount) === min) ids.add(q.id);
  }
  return ids;
}

/** A subcontractor assignment proposed for the project, from the estimate lines that use its quotes. */
export type ProposedAssignment = {
  key: string;
  subcontractor_id: string;
  trade: string | null;
  /** Sum of the cost of those lines: what Grand Hill budgeted to pay this sub. */
  agreed_amount: number;
  references: string[];
};

/**
 * One assignment per subcontractor and trade, for the lines tied to a quote. The amount is the
 * lines' cost (not the quote), so it matches the project budget even if a line changed the quantity.
 * Lines without a quote, or whose quote is gone, are left out. Ordered by the first line's position.
 */
export function assignmentsFromEstimate(
  lines: Pick<EstimateLine, "position" | "trade" | "sub_quote_id" | "cost_amount">[],
  quotes: Pick<SubQuote, "id" | "subcontractor_id" | "trade" | "reference">[],
): ProposedAssignment[] {
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const groups = new Map<string, ProposedAssignment & { first: number }>();
  for (const l of [...lines].sort((a, b) => a.position - b.position)) {
    const q = l.sub_quote_id ? byId.get(l.sub_quote_id) : undefined;
    if (!q) continue;
    const trade = (q.trade ?? l.trade)?.trim() || null;
    const key = `${q.subcontractor_id}|${tradeKey(trade)}`;
    const g = groups.get(key) ?? { key, subcontractor_id: q.subcontractor_id, trade, agreed_amount: 0, references: [], first: l.position };
    g.agreed_amount = cents(g.agreed_amount + Number(l.cost_amount));
    const ref = q.reference?.trim();
    if (ref && !g.references.includes(ref)) g.references.push(ref);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.first - b.first).map(({ first: _first, ...g }) => g);
}
