// Grand Hill Back Office — social-publish Edge Function
//
// Publishes planned posts (migration 0016) on the Facebook Page and the Instagram professional
// account linked to it, and records the result per network in public.social_deliveries (0017).
//
// Callers:
//   pg_cron every 5 minutes, with x-alerts-secret (same secret as email-alerts): posts that are due.
//   Staff from the app, with their session:
//     { "post_id": "<uuid>" }   "Publicar ahora" for one scheduled post (also retries its failures)
//     { "action": "status" }    checks the Meta connection: Page name and Instagram account
//
// Deployed with --no-verify-jwt (pg_cron has no session); this file checks every request itself.
// Secrets: META_ACCESS_TOKEN (system user token of the Meta app), META_PAGE_ID, and the
// ALERTS_CRON_SECRET already set for email-alerts. Setup: README ("Publicación en Facebook e Instagram").

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  blockedReason,
  errorText,
  GRAPH_VERSION,
  publishFacebook,
  publishInstagram,
  PublishError,
  resumeInstagram,
  type Graph,
  type Media,
  type Outcome,
} from "./meta.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alerts-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const AUTO = ["facebook", "instagram"];
const PROCESSING_LIMIT_MS = 60 * 60 * 1000; // an Instagram video not ready after an hour fails
const BUDGET_MS = 100_000; // stop starting new deliveries after this, the platform cuts at ~150 s

/** Graph API caller with a token. Meta errors become PublishError with Meta's own message. */
function graphWith(token: string): Graph {
  return async (method, path, params = {}) => {
    const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
    const init: RequestInit = { method };
    if (method === "GET") {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("access_token", token);
    } else {
      init.body = new URLSearchParams({ ...params, access_token: token });
    }
    const res = await fetch(url, init);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = data.error as { message?: string; code?: number } | undefined;
    if (!res.ok || err) throw new PublishError(err?.message ? `${err.message}${err.code ? ` (${err.code})` : ""}` : `http_${res.status}`);
    return data;
  };
}

type Account = { pageId: string; pageName: string; pageToken: string; igId: string | null; igUsername: string | null };

async function account(): Promise<Account> {
  const token = Deno.env.get("META_ACCESS_TOKEN");
  const pageId = Deno.env.get("META_PAGE_ID");
  if (!token || !pageId) throw new PublishError("not_configured");
  const page = await graphWith(token)("GET", pageId, { fields: "name,access_token,instagram_business_account{id,username}" });
  const ig = page.instagram_business_account as { id?: string; username?: string } | undefined;
  if (!page.access_token) throw new PublishError("no_page_access");
  return { pageId, pageName: String(page.name ?? ""), pageToken: String(page.access_token), igId: ig?.id ?? null, igUsername: ig?.username ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const body = (await req.json().catch(() => ({}))) as { post_id?: unknown; action?: unknown };

  // Scheduler or staff?
  let postId: string | null = null;
  if (!sameSecret(req.headers.get("x-alerts-secret") ?? "", Deno.env.get("ALERTS_CRON_SECRET") ?? "")) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: caller } = await db.auth.getUser(token);
    if (!caller?.user) return json({ error: "unauthorized" }, 401);
    const { data: me } = await db.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
    if (me?.role !== "super_admin" && me?.role !== "admin") return json({ error: "forbidden" }, 403);

    if (body.action === "status") {
      try {
        const a = await account();
        return json({ ok: true, page: a.pageName, instagram: a.igUsername });
      } catch (e) {
        return json({ ok: false, error: errorText(e) });
      }
    }
    if (typeof body.post_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.post_id)) return json({ error: "bad_request" }, 400);
    postId = body.post_id;
  }

  let acct: Account;
  try {
    acct = await account();
  } catch (e) {
    return json({ error: errorText(e) }, postId ? 409 : 200);
  }

  const { data: claimed, error: claimError } = await db.rpc("claim_social_deliveries", { p_post: postId });
  if (claimError) return json({ error: "claim_failed" }, 500);
  const deliveries = (claimed ?? []) as { id: string; post_id: string; channel: "facebook" | "instagram"; container_id: string | null; created_at: string }[];
  if (!deliveries.length) return json({ ok: true, deliveries: [] });

  const started = Date.now();
  const results: { channel: string; status: string; error?: string }[] = [];
  const touched = new Set<string>();

  for (const d of deliveries) {
    if (Date.now() - started > BUDGET_MS) {
      // Out of time: hand it back for the next run instead of leaving it half-claimed.
      await db.rpc("release_social_delivery", { p_id: d.id }).then(() => null, () => null);
      continue;
    }
    touched.add(d.post_id);
    let outcome: Outcome | null = null;
    let error: string | null = null;
    try {
      const { data: post } = await db.from("social_posts").select("body").eq("id", d.post_id).single();
      const text = String(post?.body ?? "");
      const graph = graphWith(acct.pageToken);
      if (d.channel === "instagram" && !acct.igId) throw new PublishError("instagram_not_linked");

      if (d.container_id) {
        if (Date.now() - Date.parse(d.created_at) > PROCESSING_LIMIT_MS) throw new PublishError("instagram_processing_timeout");
        outcome = await resumeInstagram(graph, acct.igId!, d.container_id, text);
      } else {
        const { data: rows } = await db.from("social_post_media").select("path, mime_type").eq("post_id", d.post_id).order("position");
        const files = (rows ?? []) as { path: string; mime_type: string }[];
        const blocked = blockedReason(d.channel, text, files.map((f) => ({ url: "", mime: f.mime_type })));
        if (blocked) throw new PublishError(blocked);
        // Meta downloads the files itself: private links valid for an hour.
        const signed = files.length ? (await db.storage.from("social-media").createSignedUrls(files.map((f) => f.path), 3600)).data ?? [] : [];
        const media: Media[] = files.map((f, i) => ({ url: signed[i]?.signedUrl ?? "", mime: f.mime_type }));
        if (media.some((m) => !m.url)) throw new PublishError("file_link_failed");
        outcome =
          d.channel === "facebook" ? await publishFacebook(graph, acct.pageId, text, media) : await publishInstagram(graph, acct.igId!, text, media);
      }
    } catch (e) {
      error = errorText(e);
    }

    const update =
      error || !outcome
        ? { status: "failed", error: error ?? "unknown", finished_at: new Date().toISOString(), container_id: null }
        : outcome.status === "processing"
          ? { status: "processing", container_id: outcome.containerId }
          : { status: "published", external_id: outcome.externalId, permalink: outcome.permalink, error: null, finished_at: new Date().toISOString(), container_id: null };
    await db.from("social_deliveries").update(update).eq("id", d.id);
    results.push({ channel: d.channel, status: update.status, ...(error ? { error } : {}) });
  }

  // A post published everywhere it goes automatically, and nowhere by hand, is marked published.
  for (const id of touched) {
    const [{ data: post }, { data: done }] = await Promise.all([
      db.from("social_posts").select("status, channels").eq("id", id).single(),
      db.from("social_deliveries").select("channel, status, permalink").eq("post_id", id),
    ]);
    if (!post || post.status !== "scheduled") continue;
    const channels = (post.channels ?? []) as string[];
    const rows = (done ?? []) as { channel: string; status: string; permalink: string | null }[];
    const allAuto = channels.filter((c) => AUTO.includes(c)).every((c) => rows.some((r) => r.channel === c && r.status === "published"));
    if (allAuto && channels.every((c) => AUTO.includes(c))) {
      const link = rows.find((r) => r.channel === "facebook")?.permalink ?? rows.find((r) => r.channel === "instagram")?.permalink ?? null;
      await db.from("social_posts").update({ status: "published", published_url: link }).eq("id", id);
    }
  }

  return json({ ok: true, deliveries: results });
});
