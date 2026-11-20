// Subcontractor domain: types mirroring supabase/migrations/0001_foundations.sql, keys and compliance rules.

export type SubStatus = "prospect" | "prequalified" | "active" | "inactive";
export type DocType = "coi" | "w9" | "license" | "agreement" | "other";
export type Validity = "valid" | "expiring" | "expired" | "no_expiry";

export type Subcontractor = {
  id: string;
  company_name: string;
  legal_name: string | null;
  trades: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string;
  status: SubStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type SubDocument = {
  id: string;
  subcontractor_id: string;
  doc_type: DocType;
  file_path: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
  created_at: string;
};

/** Row of the v_sub_documents_status view. */
export type DocStatusRow = {
  id: string;
  subcontractor_id: string;
  doc_type: DocType;
  expires_on: string | null;
  days_left: number | null;
  validity: Validity;
};

export const SUB_COLUMNS =
  "id, company_name, legal_name, trades, contact_name, email, phone, city, state, status, notes, created_at, updated_at";

// Labels for every key below live in src/i18n (subs.statuses, subs.docTypes, subs.trades…).
export const STATUSES: SubStatus[] = ["prospect", "prequalified", "active", "inactive"];
export const DOC_TYPES: DocType[] = ["coi", "w9", "license", "agreement", "other"];

/** Documents a subcontractor needs on file before working with Grand Hill. */
export const REQUIRED_DOCS: DocType[] = ["coi", "w9", "license"];

/** Suggested trades, stored by key so they read in either language. Any other trade is stored as typed. */
export const TRADE_KEYS = [
  "concrete",
  "framing",
  "drywall",
  "painting",
  "electrical",
  "plumbing",
  "hvac",
  "roofing",
  "stucco",
  "flooring",
  "carpentry",
  "waterproofing",
  "windowsDoors",
  "demolition",
  "landscaping",
] as const;
export type TradeKey = (typeof TRADE_KEYS)[number];

/** Maps a stored value to its suggested-trade key, accepting the key itself or its label in any language
 *  (rows saved before trades were stored by key hold Spanish labels such as "Pintura"). */
export function tradeKeyOf(value: string, labelSets: Record<TradeKey, string>[]): TradeKey | null {
  const v = value.trim().toLowerCase();
  for (const key of TRADE_KEYS) {
    if (key.toLowerCase() === v) return key;
    if (labelSets.some((labels) => labels[key].toLowerCase() === v)) return key;
  }
  return null;
}

export const EXPIRING_DAYS = 30;

export function validityOf(expiresOn: string | null, today = todayISO()): Validity {
  if (!expiresOn) return "no_expiry";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDaysISO(today, EXPIRING_DAYS)) return "expiring";
  return "valid";
}

export type ComplianceLevel = "ok" | "expiring" | "expired" | "missing";

export type Compliance = {
  level: ComplianceLevel;
  /** Per required doc: the best (latest-expiring) document on file, or missing. */
  byType: Record<string, ComplianceLevel>;
  missing: DocType[];
};

const SEVERITY: Record<ComplianceLevel, number> = { ok: 0, expiring: 1, missing: 2, expired: 3 };

/** For each required doc type, the most favourable document counts (a renewed COI supersedes the old one). */
export function complianceOf(docs: { doc_type: DocType; expires_on: string | null }[], today = todayISO()): Compliance {
  const byType: Record<string, ComplianceLevel> = {};
  const missing: DocType[] = [];
  let level: ComplianceLevel = "ok";

  for (const type of REQUIRED_DOCS) {
    const ofType = docs.filter((d) => d.doc_type === type);
    let best: ComplianceLevel = "missing";
    if (ofType.length) {
      // No expiry beats any date; otherwise the latest expiry wins.
      const top = ofType.some((d) => !d.expires_on)
        ? null
        : ofType.map((d) => d.expires_on as string).sort()[ofType.length - 1];
      const v = validityOf(top, today);
      best = v === "expired" ? "expired" : v === "expiring" ? "expiring" : "ok";
    } else {
      missing.push(type);
    }
    byType[type] = best;
    if (SEVERITY[best] > SEVERITY[level]) level = best;
  }
  return { level, byType, missing };
}

export function todayISO(): string {
  const d = new Date();
  return toISO(d);
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + days));
}

function toISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-11-20" -> "20 nov 2026" / "Nov 20, 2026", without timezone shifts. */
export function formatDate(iso: string | null, locale: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** Storage object name -> original file name (paths are `<sub id>/<uuid>/<file name>`). */
export function fileNameOf(path: string | null): string {
  if (!path) return "";
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

export const DOCS_BUCKET = "sub-documents";

/** Keeps the original name readable but storage-safe. */
export function storagePathFor(subId: string, fileName: string): string {
  const safe = fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return `${subId}/${crypto.randomUUID()}/${safe || "documento"}`;
}
