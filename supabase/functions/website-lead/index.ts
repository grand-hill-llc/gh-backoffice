// Grand Hill Back Office — website-lead Edge Function
//
// Receives the "quote" form from grandhillcorp.com through a Netlify outgoing webhook
// (Netlify still sends its email notification as before) and turns it into a lead:
// source "website", stage "new", follow-up today, and the message in the lead's history.
// If an open lead with the same email already exists, the message is added to it instead.
// Every website lead is assigned to the default owner (Adrian). WEBSITE_LEAD_OWNER (optional secret,
// an email) changes who that is without touching the code. It can be reassigned from the lead page.
//
// Netlify has no Supabase session, so this function is deployed with --no-verify-jwt and
// instead only accepts requests signed with NETLIFY_WEBHOOK_SECRET (Netlify's JWS signature).
// Deploy and setup: see README ("Formulario del sitio web").

import { createClient } from "jsr:@supabase/supabase-js@2";
import { leadFromSubmission, verifyNetlifySignature } from "./submission.ts";

/** Adrian: default owner of website leads (override with the WEBSITE_LEAD_OWNER secret). */
const DEFAULT_OWNER_EMAIL = "adriangerig@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Today in Florida, as YYYY-MM-DD, so a lead arriving at night isn't dated tomorrow. */
function todayInFlorida(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const secret = Deno.env.get("NETLIFY_WEBHOOK_SECRET") ?? "";
  const raw = await req.text();
  if (!(await verifyNetlifySignature(req.headers.get("X-Webhook-Signature"), raw, secret))) {
    return json({ error: "invalid_signature" }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  const lead = leadFromSubmission(body);
  // Not our form, or no name: acknowledge so Netlify doesn't retry, but store nothing.
  if (!lead) return json({ ignored: true });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const today = todayInFlorida();

  /** The default owner's profile id, or null (lead stays unassigned) if that person has no staff profile. */
  const pickOwner = async (): Promise<string | null> => {
    const email = (Deno.env.get("WEBSITE_LEAD_OWNER") ?? DEFAULT_OWNER_EMAIL).trim().toLowerCase();
    const { data } = await db
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .in("role", ["super_admin", "admin"])
      .limit(1)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  // Same person writing again while their lead is still open: add to it, don't duplicate.
  if (lead.email) {
    const { data: existing } = await db
      .from("leads")
      .select("id, owner_id")
      .eq("email", lead.email)
      .in("status", ["new", "contacted", "qualified"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const { error } = await db.from("lead_activities").insert({ lead_id: existing.id, kind: "message", summary: lead.message });
      if (error) return json({ error: "activity_failed" }, 500);
      // Keep its owner; only fill it in if nobody had it.
      const update: Record<string, unknown> = { next_follow_up: today };
      if (!existing.owner_id) update.owner_id = await pickOwner();
      await db.from("leads").update(update).eq("id", existing.id);
      return json({ lead_id: existing.id, duplicate: true });
    }
  }

  const { data: created, error } = await db
    .from("leads")
    .insert({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      location: lead.location,
      interest: lead.interest,
      source: "website",
      status: "new",
      owner_id: await pickOwner(),
      next_follow_up: today,
    })
    .select("id")
    .single();
  if (error || !created) return json({ error: "lead_failed" }, 500);

  await db.from("lead_activities").insert({ lead_id: created.id, kind: "message", summary: lead.message });
  return json({ lead_id: created.id });
});
