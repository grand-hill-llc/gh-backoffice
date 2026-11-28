// Publishing a post on a Facebook Page and an Instagram professional account through the Graph API.
// Pure logic: the HTTP call is injected, so tests run it against a fake Graph API.

export const GRAPH_VERSION = "v23.0";

export type Media = { url: string; mime: string };
export type Graph = (method: "GET" | "POST", path: string, params?: Record<string, string>) => Promise<Record<string, unknown>>;

export class PublishError extends Error {}

export type Outcome =
  | { status: "published"; externalId: string; permalink: string | null }
  | { status: "processing"; containerId: string };

const isVideo = (m: Media) => m.mime.startsWith("video/");
const isJpeg = (m: Media) => m.mime === "image/jpeg";
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Why a post can't go to a network as it is, or null. Checked before calling Meta. */
export function blockedReason(channel: "facebook" | "instagram", body: string, media: Media[]): string | null {
  if (channel === "facebook") {
    if (!body.trim() && media.length === 0) return "empty";
    if (media.some(isVideo) && media.length > 1) return "facebook_video_alone";
    return null;
  }
  if (media.length === 0) return "instagram_needs_media";
  if (media.length > 10) return "instagram_too_many";
  if (media.some((m) => !isVideo(m) && !isJpeg(m))) return "instagram_jpeg_only";
  if ([...body].length > 2200) return "instagram_caption_too_long";
  return null;
}

export async function publishFacebook(graph: Graph, pageId: string, body: string, media: Media[]): Promise<Outcome> {
  let postId: string;
  if (media.length === 1 && isVideo(media[0])) {
    const r = await graph("POST", `${pageId}/videos`, { file_url: media[0].url, description: body });
    postId = str(r.id);
  } else if (media.length > 0) {
    const ids: string[] = [];
    for (const m of media) {
      const r = await graph("POST", `${pageId}/photos`, { url: m.url, published: "false" });
      ids.push(str(r.id));
    }
    const r = await graph("POST", `${pageId}/feed`, {
      message: body,
      attached_media: JSON.stringify(ids.map((id) => ({ media_fbid: id }))),
    });
    postId = str(r.id);
  } else {
    const r = await graph("POST", `${pageId}/feed`, { message: body });
    postId = str(r.id);
  }
  if (!postId) throw new PublishError("no_id");
  let permalink: string | null = null;
  try {
    const p = await graph("GET", postId, { fields: "permalink_url" });
    const raw = str(p.permalink_url);
    permalink = raw ? (raw.startsWith("http") ? raw : `https://www.facebook.com${raw}`) : null;
  } catch {
    // The post is out; a missing link is not a failure.
  }
  return { status: "published", externalId: postId, permalink };
}

/** Instagram works in two steps: a media container Meta prepares, then publishing it. */
type IgContainer = { kind: "single"; id: string } | { kind: "carousel"; children: string[] };

async function containerState(graph: Graph, id: string): Promise<"ready" | "waiting"> {
  const r = await graph("GET", id, { fields: "status_code" });
  const code = str(r.status_code);
  if (code === "ERROR" || code === "EXPIRED") throw new PublishError(`instagram_container_${code.toLowerCase()}`);
  return code === "FINISHED" || code === "PUBLISHED" ? "ready" : "waiting";
}

/** Waits up to `waitMs` for every container to be ready. */
async function allReady(graph: Graph, ids: string[], waitMs: number, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    const states = await Promise.all(ids.map((id) => containerState(graph, id)));
    if (states.every((s) => s === "ready")) return true;
    if (Date.now() >= until) return false;
    await sleep(3000);
  }
}

async function finishInstagram(graph: Graph, igId: string, c: IgContainer, body: string, waitMs: number, sleep: (ms: number) => Promise<void>): Promise<Outcome> {
  const pending = c.kind === "single" ? [c.id] : c.children;
  if (!(await allReady(graph, pending, waitMs, sleep))) return { status: "processing", containerId: JSON.stringify(c) };

  let creation = c.kind === "single" ? c.id : "";
  if (c.kind === "carousel") {
    const r = await graph("POST", `${igId}/media`, { media_type: "CAROUSEL", children: c.children.join(","), caption: body });
    creation = str(r.id);
    if (!(await allReady(graph, [creation], waitMs, sleep))) return { status: "processing", containerId: JSON.stringify({ kind: "single", id: creation }) };
  }
  const pub = await graph("POST", `${igId}/media_publish`, { creation_id: creation });
  const mediaId = str(pub.id);
  if (!mediaId) throw new PublishError("no_id");
  let permalink: string | null = null;
  try {
    permalink = str((await graph("GET", mediaId, { fields: "permalink" })).permalink) || null;
  } catch {
    // Published anyway.
  }
  return { status: "published", externalId: mediaId, permalink };
}

export async function publishInstagram(
  graph: Graph,
  igId: string,
  body: string,
  media: Media[],
  opts: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Outcome> {
  const waitMs = opts.waitMs ?? 40000;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  let c: IgContainer;
  if (media.length === 1) {
    const m = media[0];
    const r = await graph(
      "POST",
      `${igId}/media`,
      isVideo(m) ? { media_type: "REELS", video_url: m.url, caption: body } : { image_url: m.url, caption: body },
    );
    c = { kind: "single", id: str(r.id) };
  } else {
    const children: string[] = [];
    for (const m of media) {
      const r = await graph(
        "POST",
        `${igId}/media`,
        isVideo(m) ? { media_type: "VIDEO", video_url: m.url, is_carousel_item: "true" } : { image_url: m.url, is_carousel_item: "true" },
      );
      children.push(str(r.id));
    }
    c = { kind: "carousel", children };
  }
  return finishInstagram(graph, igId, c, body, waitMs, sleep);
}

/** Next run for a video Meta was still preparing. */
export async function resumeInstagram(
  graph: Graph,
  igId: string,
  containerId: string,
  body: string,
  opts: { waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<Outcome> {
  let c: IgContainer;
  try {
    c = JSON.parse(containerId);
  } catch {
    throw new PublishError("bad_container");
  }
  return finishInstagram(graph, igId, c, body, opts.waitMs ?? 20000, opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))));
}

/** Short, readable error to store on the delivery. */
export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, 500);
}
