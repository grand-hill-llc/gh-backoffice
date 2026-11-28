// Content planner: posts for Facebook, Instagram, LinkedIn and Google (migration 0016).

export type Channel = "facebook" | "instagram" | "linkedin" | "google";
export type PostStatus = "draft" | "pending" | "scheduled" | "published";

export const CHANNELS: Channel[] = ["facebook", "instagram", "linkedin", "google"];
export const POST_STATUSES: PostStatus[] = ["draft", "pending", "scheduled", "published"];

export type SocialPost = {
  id: string;
  title: string;
  body: string;
  channels: Channel[];
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  published_url: string | null;
  notes: string | null;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PostMedia = { id: string; post_id: string; position: number; path: string; mime_type: string; size_bytes: number | null };

export const POST_COLUMNS =
  "id, title, body, channels, status, scheduled_at, published_at, published_url, notes, review_note, reviewed_by, reviewed_at, created_by, created_at, updated_at";

export const MEDIA_BUCKET = "social-media";
export const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

/** Caption length each network accepts. */
export const CAPTION_LIMITS: Record<Channel, number> = { facebook: 63206, instagram: 2200, linkedin: 3000, google: 1500 };
export const INSTAGRAM_MAX_MEDIA = 10;

/** Times are planned in Florida time, wherever the person planning is. */
export const PLAN_TZ = "America/New_York";

function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}

/** "2026-03-08T10:30" read as Florida time -> ISO instant. */
export function localToIso(local: string, tz = PLAN_TZ): string {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min);
  // Offset at that moment, refined once for the hour around a DST change.
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = partsIn(new Date(guess), tz);
    guess = wall - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - guess);
  }
  return new Date(guess).toISOString();
}

/** ISO instant -> "2026-03-08T10:30" in Florida time (for a datetime-local input). */
export function isoToLocal(iso: string, tz = PLAN_TZ): string {
  const p = partsIn(new Date(iso), tz);
  const n = (v: number) => String(v).padStart(2, "0");
  return `${p.y}-${n(p.m)}-${n(p.d)}T${n(p.h)}:${n(p.min)}`;
}

/** Calendar day ("2026-03-08") of an instant, in Florida. */
export function dayOf(iso: string, tz = PLAN_TZ): string {
  return isoToLocal(iso, tz).slice(0, 10);
}

/** When a post sits on the calendar: published date if out, else its planned date. */
export function postDate(p: Pick<SocialPost, "status" | "published_at" | "scheduled_at">): string | null {
  return p.status === "published" ? p.published_at : p.scheduled_at;
}

/** Days of a month grid, weeks starting Monday, padded with the neighbouring months. */
export function monthGrid(month: string): { day: string; inMonth: boolean }[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const total = Math.ceil((lead + daysIn) / 7) * 7;
  return Array.from({ length: total }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    return { day: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 };
  });
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export type PostWarning =
  | { kind: "tooLong"; channel: Channel; limit: number }
  | { kind: "instagramNeedsMedia" }
  | { kind: "instagramTooMany"; max: number }
  | { kind: "instagramFormat" }
  | { kind: "facebookVideoAlone" }
  | { kind: "inPast" };

/** What would make a network reject the post, or is likely a mistake. Advisory: saving still works. */
export function postWarnings(
  p: { body: string; channels: Channel[]; scheduled_at: string | null; status: PostStatus },
  media: { mime_type: string }[],
  now = new Date().toISOString(),
): PostWarning[] {
  const out: PostWarning[] = [];
  const len = [...p.body].length;
  for (const c of p.channels) if (len > CAPTION_LIMITS[c]) out.push({ kind: "tooLong", channel: c, limit: CAPTION_LIMITS[c] });
  if (p.channels.includes("instagram")) {
    if (media.length === 0) out.push({ kind: "instagramNeedsMedia" });
    if (media.length > INSTAGRAM_MAX_MEDIA) out.push({ kind: "instagramTooMany", max: INSTAGRAM_MAX_MEDIA });
    if (media.some((m) => m.mime_type === "image/png" || m.mime_type === "image/webp")) out.push({ kind: "instagramFormat" });
  }
  if (p.channels.includes("facebook") && media.length > 1 && media.some((m) => m.mime_type.startsWith("video/"))) out.push({ kind: "facebookVideoAlone" });
  if (p.status !== "published" && p.scheduled_at && p.scheduled_at < now) out.push({ kind: "inPast" });
  return out;
}

/** Storage path inside the post's folder, keeping the original name readable. */
export function mediaPathFor(postId: string, fileName: string): string {
  const safe = fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-100);
  return `${postId}/${crypto.randomUUID()}/${safe || "archivo"}`;
}

export const isVideo = (mime: string) => mime.startsWith("video/");

/** Networks the app publishes to by itself (migration 0017); the rest are posted by hand. */
export const AUTO_CHANNELS: Channel[] = ["facebook", "instagram"];
export type DeliveryStatus = "publishing" | "processing" | "published" | "failed";
export type Delivery = {
  id: string;
  post_id: string;
  channel: "facebook" | "instagram";
  status: DeliveryStatus;
  attempts: number;
  permalink: string | null;
  error: string | null;
  finished_at: string | null;
};
export const DELIVERY_COLUMNS = "id, post_id, channel, status, attempts, permalink, error, finished_at";

/** Known error codes from the publishing function; anything else is Meta's own message. */
export function deliveryErrorKey(error: string | null): string | null {
  if (!error) return null;
  if (error.startsWith("instagram_container_")) return "instagram_container_error";
  return error;
}
