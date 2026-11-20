// Clients and bids: types mirroring supabase/migrations/0001_foundations.sql. Labels live in src/i18n (sales.*).

export type ClientType = "general_contractor" | "developer" | "property_manager" | "direct_commercial" | "residential" | "other";
export type BidStatus = "new" | "estimating" | "submitted" | "won" | "lost" | "declined";

export const CLIENT_TYPES: ClientType[] = [
  "general_contractor",
  "developer",
  "property_manager",
  "direct_commercial",
  "residential",
  "other",
];

/** Pipeline order. */
export const BID_STATUSES: BidStatus[] = ["new", "estimating", "submitted", "won", "lost", "declined"];
/** Still in play: counts towards "open bids" on the dashboard. */
export const OPEN_STATUSES: BidStatus[] = ["new", "estimating", "submitted"];
/** Grand Hill still has to deliver the bid: these are the ones a due date can catch out. */
export const PRE_SUBMIT: BidStatus[] = ["new", "estimating"];

export type Client = {
  id: string;
  name: string;
  type: ClientType;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type Bid = {
  id: string;
  title: string;
  client_id: string | null;
  status: BidStatus;
  due_date: string | null;
  location: string | null;
  scope: string | null;
  estimated_value: number | null;
  our_price: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const CLIENT_COLUMNS = "id, name, type, contact_name, email, phone, notes, created_at, updated_at";
export const BID_COLUMNS =
  "id, title, client_id, status, due_date, location, scope, estimated_value, our_price, notes, created_at, updated_at";

export const SOON_DAYS = 7;

/** How pressing a bid's due date is. Only bids Grand Hill hasn't submitted yet can be late. */
export type Urgency = "overdue" | "today" | "soon" | "later" | "none";

export function urgencyOf(bid: Pick<Bid, "status" | "due_date">, today: string): { urgency: Urgency; days: number | null } {
  if (!bid.due_date) return { urgency: "none", days: null };
  const days = daysBetween(today, bid.due_date);
  if (!PRE_SUBMIT.includes(bid.status)) return { urgency: "none", days };
  if (days < 0) return { urgency: "overdue", days };
  if (days === 0) return { urgency: "today", days };
  if (days <= SOON_DAYS) return { urgency: "soon", days };
  return { urgency: "later", days };
}

function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.split("-").map(Number);
  const [y2, m2, d2] = toISO.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** USD, no cents for round amounts: 125000 -> "$125,000". */
export function formatMoney(value: number | null, locale: string): string {
  if (value === null || value === undefined) return "—";
  const whole = Number.isInteger(Number(value));
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/** "12,500.50" / "12500,50" / "$12,500" -> 12500.5. Empty -> null. Invalid -> NaN. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[$\s]/g, "");
  if (!s) return null;
  // Treat the last separator as decimal only if followed by 1-2 digits.
  const m = s.match(/^(.*?)[.,](\d{1,2})$/);
  const intPart = (m ? m[1] : s).replace(/[.,]/g, "");
  const n = Number(m ? `${intPart}.${m[2]}` : intPart);
  return /^\d+$/.test(intPart) && Number.isFinite(n) ? n : NaN;
}
