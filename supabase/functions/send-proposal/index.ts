// Grand Hill Back Office — send-proposal Edge Function
//
// Emails a proposal link to the client through Resend, from a signed-in staff member (super
// admin or admin). The client's replies go to the company inbox (reply-to) and the sender gets a
// blind copy. Every attempt is recorded in public.proposal_emails.
//
// Deploy: see README ("Envío de propuestas por correo"). Uses the RESEND_API_KEY already set for
// email-alerts. Optional env: PROPOSALS_FROM, PROPOSALS_REPLY_TO (else ALERTS_REPLY_TO), APP_URL.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildProposalEmail, parseSendRequest } from "./email.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const floridaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling, and are they staff?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await admin.from("profiles").select("id, role, email").eq("id", caller.user.id).maybeSingle();
  if (me?.role !== "super_admin" && me?.role !== "admin") return json({ error: "forbidden" }, 403);

  const parsed = parseSendRequest(await req.json().catch(() => null));
  if ("error" in parsed) return json({ error: parsed.error }, 400);

  const { data: link, error: linkError } = await admin
    .from("proposal_links")
    .select("id, token, lang, status, valid_until, total, content")
    .eq("id", parsed.linkId)
    .maybeSingle();
  if (linkError) return json({ error: "load_failed" }, 500);
  if (!link) return json({ error: "not_found" }, 404);
  if (link.status !== "sent") return json({ error: "not_open" }, 409);
  if (link.valid_until < floridaToday()) return json({ error: "expired" }, 409);

  const { data: settings } = await admin.from("app_settings").select("company_address, company_phone, company_email").maybeSingle();
  const appUrl = (Deno.env.get("APP_URL") ?? "https://app.grandhillcorp.com").replace(/\/+$/, "");
  const title = String(link.content?.project?.title ?? "").trim() || (link.lang === "en" ? "Proposal" : "Propuesta");

  const email = buildProposalEmail({
    lang: link.lang === "en" ? "en" : "es",
    title,
    total: link.total === null ? null : Number(link.total),
    validUntil: link.valid_until,
    url: `${appUrl}/p/${link.token}`,
    message: parsed.message,
    company: { address: settings?.company_address, phone: settings?.company_phone, email: settings?.company_email },
  });

  const senderEmail = (caller.user.email ?? me.email ?? "").toLowerCase();
  const bcc = senderEmail && senderEmail !== parsed.to && !parsed.cc.includes(senderEmail) ? [senderEmail] : [];
  const replyTo = Deno.env.get("PROPOSALS_REPLY_TO") ?? Deno.env.get("ALERTS_REPLY_TO") ?? "info@grandhillcorp.com";

  let resendId: string | null = null;
  let error: string | null = null;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
        "Content-Type": "application/json",
        // A double click or a retry sends the same request_id: Resend delivers it once.
        "Idempotency-Key": `proposal-${parsed.requestId}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("PROPOSALS_FROM") ?? "Grand Hill <proposals@updates.grandhillcorp.com>",
        to: [parsed.to],
        ...(parsed.cc.length ? { cc: parsed.cc } : {}),
        ...(bcc.length ? { bcc } : {}),
        reply_to: replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && data?.name === "invalid_idempotent_request") resendId = null;
    else if (!res.ok) error = `${res.status}: ${String(data?.message ?? "send_failed")}`.slice(0, 500);
    else resendId = data?.id ?? null;
  } catch (e) {
    error = String(e).slice(0, 500);
  }

  const { data: row } = await admin
    .from("proposal_emails")
    .insert({
      proposal_link_id: link.id,
      recipient: parsed.to,
      cc: parsed.cc,
      message: parsed.message,
      status: error ? "failed" : "sent",
      resend_id: resendId,
      error,
      sent_by: me.id,
    })
    .select("id, created_at")
    .maybeSingle();

  if (error) {
    console.error("send_failed", error);
    return json({ error: "send_failed" }, 502);
  }
  return json({ ok: true, id: row?.id ?? null, created_at: row?.created_at ?? new Date().toISOString() });
});
