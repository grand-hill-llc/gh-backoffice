// Leads (CRM): types mirroring supabase/migrations/0003_leads.sql. Labels in src/i18n (leads.*).

export type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "lost";
export type LeadSource = "website" | "instagram" | "facebook" | "whatsapp" | "referral" | "other";
export type ActivityKind = "call" | "email" | "message" | "meeting" | "note";

/** Pipeline order. "converted" is reached by converting the lead into a client + bid, not picked by hand. */
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "converted", "lost"];
export const PICKABLE_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "lost"];
export const OPEN_LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified"];
export const LEAD_SOURCES: LeadSource[] = ["website", "instagram", "facebook", "whatsapp", "referral", "other"];
export const ACTIVITY_KINDS: ActivityKind[] = ["call", "message", "email", "meeting", "note"];

export type Lead = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  owner_id: string | null;
  interest: string | null;
  location: string | null;
  next_follow_up: string | null;
  lost_reason: string | null;
  notes: string | null;
  client_id: string | null;
  bid_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  kind: ActivityKind;
  occurred_at: string;
  summary: string;
  created_by: string | null;
  created_at: string;
};

export const LEAD_COLUMNS =
  "id, name, company, email, phone, source, status, owner_id, interest, location, next_follow_up, lost_reason, notes, client_id, bid_id, created_at, updated_at";
export const ACTIVITY_COLUMNS = "id, lead_id, kind, occurred_at, summary, created_by, created_at";

/** Staff who can own a lead. */
export type Owner = { id: string; full_name: string | null; email: string | null };
export const ownerName = (o: Owner | undefined | null) => o?.full_name || o?.email || "—";

export type FollowUp = "overdue" | "today" | "soon" | "later" | "none";
export const FOLLOW_UP_SOON_DAYS = 3;

/** How pressing the next follow-up is. Only open leads are chased. */
export function followUpOf(lead: Pick<Lead, "status" | "next_follow_up">, today: string): { state: FollowUp; days: number | null } {
  if (!lead.next_follow_up || !OPEN_LEAD_STATUSES.includes(lead.status)) return { state: "none", days: null };
  const days = daysBetween(today, lead.next_follow_up);
  if (days < 0) return { state: "overdue", days };
  if (days === 0) return { state: "today", days };
  if (days <= FOLLOW_UP_SOON_DAYS) return { state: "soon", days };
  return { state: "later", days };
}

export function daysBetween(fromISO: string, toISO: string): number {
  const [y1, m1, d1] = fromISO.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = toISO.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** today + n days as YYYY-MM-DD (local time). */
export function addDays(todayISO: string, n: number): string {
  const [y, m, d] = todayISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** WhatsApp chat link from a phone as typed. US numbers without country code get +1. */
export function whatsappHref(phone: string | null): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return digits.length >= 11 ? `https://wa.me/${digits}` : undefined;
}

/** "hace 3 días" / "3 days ago", from an ISO timestamp. */
export function relativeTime(iso: string, locale: string, now = new Date()): string {
  const diffMin = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diffMin);
  if (abs < 60) return rtf.format(diffMin, "minute");
  if (abs < 60 * 24) return rtf.format(Math.round(diffMin / 60), "hour");
  if (abs < 60 * 24 * 30) return rtf.format(Math.round(diffMin / (60 * 24)), "day");
  return rtf.format(Math.round(diffMin / (60 * 24 * 30)), "month");
}
