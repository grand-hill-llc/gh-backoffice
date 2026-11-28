// Facebook and Instagram publishing (supabase/functions/social-publish/meta.ts) against a fake Graph API.
import { blockedReason, publishFacebook, publishInstagram, resumeInstagram, type Graph } from "../../supabase/functions/social-publish/meta.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

type Call = { method: string; path: string; params: Record<string, string> };
function fake(opts: { statuses?: string[][]; failOn?: string } = {}) {
  const calls: Call[] = [];
  let n = 0;
  const statusQueue = new Map<string, string[]>();
  const graph: Graph = async (method, path, params = {}) => {
    calls.push({ method, path, params });
    if (opts.failOn && path.endsWith(opts.failOn)) throw new Error("(#100) Invalid parameter");
    if (method === "GET" && params.fields === "status_code") {
      const q = statusQueue.get(path) ?? [];
      return { status_code: q.length ? q.shift()! : "FINISHED" };
    }
    if (method === "GET" && params.fields === "permalink_url") return { permalink_url: `/grandhill/posts/${path}` };
    if (method === "GET" && params.fields === "permalink") return { permalink: `https://www.instagram.com/p/${path}/` };
    const id = `id${++n}`;
    if (opts.statuses?.length) statusQueue.set(id, opts.statuses.shift()!);
    return { id };
  };
  return { graph, calls };
}
const img = (n = 1) => Array.from({ length: n }, (_, i) => ({ url: `https://files/${i}.jpg`, mime: "image/jpeg" }));
const vid = { url: "https://files/v.mp4", mime: "video/mp4" };
const noSleep = async () => {};

// ---- what can't go out
ok("facebook empty", blockedReason("facebook", "  ", []) === "empty");
ok("facebook text only fine", blockedReason("facebook", "Hola", []) === null);
ok("facebook video must go alone", blockedReason("facebook", "x", [vid, ...img()]) === "facebook_video_alone");
ok("instagram needs media", blockedReason("instagram", "x", []) === "instagram_needs_media");
ok("instagram jpeg only", blockedReason("instagram", "x", [{ url: "", mime: "image/png" }]) === "instagram_jpeg_only");
ok("instagram video fine", blockedReason("instagram", "x", [vid]) === null);
ok("instagram max 10", blockedReason("instagram", "x", img(11)) === "instagram_too_many");
ok("instagram caption limit", blockedReason("instagram", "x".repeat(2201), img()) === "instagram_caption_too_long");

// ---- facebook
{
  const f = fake();
  const r = await publishFacebook(f.graph, "PAGE", "Hola", []);
  ok("fb text: one feed post", f.calls[0].path === "PAGE/feed" && f.calls[0].params.message === "Hola");
  ok("fb text: absolute permalink", r.status === "published" && r.permalink === "https://www.facebook.com/grandhill/posts/id1");
}
{
  const f = fake();
  const r = await publishFacebook(f.graph, "PAGE", "Fotos", img(2));
  const photos = f.calls.filter((c) => c.path === "PAGE/photos");
  ok("fb photos uploaded unpublished", photos.length === 2 && photos.every((c) => c.params.published === "false"));
  const feed = f.calls.find((c) => c.path === "PAGE/feed")!;
  ok("fb photos attached to one post", feed.params.attached_media === JSON.stringify([{ media_fbid: "id1" }, { media_fbid: "id2" }]) && feed.params.message === "Fotos");
  ok("fb photos result", r.status === "published" && r.externalId === "id3");
}
{
  const f = fake();
  await publishFacebook(f.graph, "PAGE", "Video", [vid]);
  ok("fb video via /videos", f.calls[0].path === "PAGE/videos" && f.calls[0].params.file_url === vid.url && f.calls[0].params.description === "Video");
}
{
  const f = fake();
  f.calls.length = 0;
  const g: Graph = async (m, p, prm) => { if (prm?.fields === "permalink_url") throw new Error("nope"); return f.graph(m, p, prm); };
  const r = await publishFacebook(g, "PAGE", "x", []);
  ok("fb missing permalink isn't a failure", r.status === "published" && r.permalink === null);
}
{
  const f = fake({ failOn: "/feed" });
  let msg = "";
  try { await publishFacebook(f.graph, "PAGE", "x", []); } catch (e) { msg = (e as Error).message; }
  ok("fb error surfaces Meta's message", msg.includes("Invalid parameter"));
}

// ---- instagram
{
  const f = fake();
  const r = await publishInstagram(f.graph, "IG", "Caption", img(1), { sleep: noSleep });
  ok("ig image: container with caption", f.calls[0].path === "IG/media" && f.calls[0].params.image_url && f.calls[0].params.caption === "Caption");
  const pub = f.calls.find((c) => c.path === "IG/media_publish")!;
  ok("ig image: publishes the container", pub.params.creation_id === "id1");
  ok("ig image: permalink", r.status === "published" && r.permalink === "https://www.instagram.com/p/id2/");
}
{
  const f = fake();
  await publishInstagram(f.graph, "IG", "Cap", [...img(2), vid], { sleep: noSleep });
  const children = f.calls.filter((c) => c.path === "IG/media" && c.params.is_carousel_item === "true");
  ok("ig carousel: children without caption", children.length === 3 && children.every((c) => !c.params.caption) && children[2].params.media_type === "VIDEO");
  const carousel = f.calls.find((c) => c.params.media_type === "CAROUSEL")!;
  ok("ig carousel: parent lists children in order", carousel.params.children === "id1,id2,id3" && carousel.params.caption === "Cap");
}
{
  // Reel still processing after the wait: comes back as processing, then finishes on the next run.
  const f = fake({ statuses: [["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS"]] });
  const r = await publishInstagram(f.graph, "IG", "Reel", [vid], { waitMs: 0, sleep: noSleep });
  ok("ig reel: media_type REELS", f.calls[0].params.media_type === "REELS" && f.calls[0].params.video_url === vid.url);
  ok("ig reel processing kept for later", r.status === "processing" && JSON.parse(r.containerId).id === "id1");
  ok("ig reel: not published yet", !f.calls.some((c) => c.path === "IG/media_publish"));
  const r2 = await resumeInstagram(f.graph, "IG", (r as { containerId: string }).containerId, "Reel", { waitMs: 10000, sleep: noSleep });
  ok("ig reel resumed and published", r2.status === "published" && f.calls.some((c) => c.path === "IG/media_publish" && c.params.creation_id === "id1"));
}
{
  const f = fake({ statuses: [["ERROR"]] });
  let msg = "";
  try { await publishInstagram(f.graph, "IG", "x", [vid], { sleep: noSleep }); } catch (e) { msg = (e as Error).message; }
  ok("ig container error fails", msg === "instagram_container_error");
}
{
  let msg = "";
  try { await resumeInstagram(fake().graph, "IG", "garbage", "x"); } catch (e) { msg = (e as Error).message; }
  ok("ig bad container id fails cleanly", msg === "bad_container");
}

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
