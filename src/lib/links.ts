// Named links to files kept outside the app (Google Drive…). Mirrors supabase/migrations/0010_record_links.sql.

export type RecordLink = {
  id: string;
  bid_id: string | null;
  project_id: string | null;
  label: string;
  url: string;
  created_at: string;
};

export const LINK_COLUMNS = "id, bid_id, project_id, label, url, created_at";

/** Accepts a pasted address and returns it as https, or null if it isn't a usable https link.
 *  "drive.google.com/…" gets https:// added; http:// and other schemes are refused. */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" || !u.hostname.includes(".")) return null;
    return u.href.length <= 2000 ? u.href : null;
  } catch {
    return null;
  }
}

/** "drive.google.com" -> "Google Drive"; anything else -> its host name. */
export function sourceOf(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
  if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(host)) return "Google Drive";
  if (/(^|\.)dropbox\.com$/.test(host)) return "Dropbox";
  if (/(^|\.)onedrive\.live\.com$|(^|\.)sharepoint\.com$|^1drv\.ms$/.test(host)) return "OneDrive";
  return host;
}
