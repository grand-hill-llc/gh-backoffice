// Grand Hill Back Office — email-alerts Edge Function
//
// Called every 15 minutes by pg_cron (migration 0006). It sends through Resend:
//   staff digest      weekdays at 8:00 a.m. Florida, only when something needs attention
//   expiry reminders  COI and license at 30, 15 and 7 days and once expired, to portal logins
//   review results    approved or rejected documents, to portal logins
//
// pg_cron has no user session, so this is deployed with --no-verify-jwt and only accepts
// requests carrying ALERTS_CRON_SECRET in x-alerts-secret.
//
// Body (optional):
//   { "dry_run": true }             counts what would be sent now, sends nothing
//   { "preview_to": "a@b.com" }     sends one sample of each kind there, without logging it
//
// Deploy and setup: see README ("Alertas por correo").

import { createClient } from "jsr:@supabase/supabase-js@2";
import { planEmails, type Doc, type Email, type Lead, type Profile } from "./rules.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function sameSecret(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sendResend(email: Email, idempotencyKey?: string): Promise<{ id?: string; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const replyTo = Deno.env.get("ALERTS_REPLY_TO");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: Deno.env.get("ALERTS_FROM") ?? "Grand Hill <alerts@updates.grandhillcorp.com>",
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  // Same key with changed content: the first attempt was accepted, so don't count it as a failure.
  if (res.status === 409 && data?.name === "invalid_idempotent_request") return {};
  if (!res.ok) return { error: `${res.status}: ${String(data?.message ?? "send_failed").slice(0, 300)}` };
  return { id: data?.id };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!sameSecret(req.headers.get("x-alerts-secret") ?? "", Deno.env.get("ALERTS_CRON_SECRET") ?? "")) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({})) as { dry_run?: boolean; preview_to?: string };
  const previewTo = typeof body.preview_to === "string" ? body.preview_to.trim().toLowerCase() : "";
  if (previewTo && !EMAIL_RE.test(previewTo)) return json({ error: "invalid_email" }, 400);
  const dryRun = body.dry_run === true;
  if (!dryRun && !Deno.env.get("RESEND_API_KEY")) return json({ error: "missing_resend_key" }, 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [profiles, docs, leads] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role, subcontractor_id"),
    admin
      .from("subcontractor_documents")
      .select("id, subcontractor_id, doc_type, expires_on, review_status, rejection_reason, reviewed_at, subcontractors(company_name, status)"),
    admin
      .from("leads")
      .select("id, name, company, status, owner_id, next_follow_up")
      .not("status", "in", "(converted,lost)")
      .not("next_follow_up", "is", null),
  ]);
  if (profiles.error || docs.error || leads.error) {
    console.error("load_failed", profiles.error?.message, docs.error?.message, leads.error?.message);
    return json({ error: "load_failed" }, 500);
  }

  type DocRow = Omit<Doc, "company_name" | "sub_status"> & { subcontractors: { company_name: string; status: string } | null };
  const docRows: Doc[] = (docs.data as unknown as DocRow[]).map(({ subcontractors, ...d }) => ({
    ...d,
    company_name: subcontractors?.company_name ?? "—",
    sub_status: subcontractors?.status ?? "inactive",
  }));

  const emails = planEmails({
    profiles: profiles.data as Profile[],
    docs: docRows,
    leads: leads.data as Lead[],
    now: new Date(),
    appUrl: (Deno.env.get("APP_URL") ?? "https://app.grandhillcorp.com").replace(/\/+$/, ""),
    subsEnabled: Deno.env.get("ALERTS_SUBS_ENABLED") === "true" || Boolean(previewTo),
    force: dryRun || Boolean(previewTo),
  });

  const counts = (list: Email[]) =>
    list.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

  if (dryRun) return json({ dry_run: true, due: counts(emails) });

  if (previewTo) {
    const samples = ["digest", "reminder", "review"].flatMap((kind) => emails.find((e) => e.kind === kind) ?? []);
    const results = [];
    for (const e of samples) {
      const r = await sendResend({ ...e, to: previewTo, subject: `[PRUEBA] ${e.subject}` });
      results.push({ kind: e.kind, ok: !r.error, error: r.error });
      await sleep(600);
    }
    return json({ preview: true, results });
  }

  let sent = 0, failed = 0, skipped = 0;
  for (const email of emails) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_email", {
      p_key: email.key, p_kind: email.kind, p_recipient: email.to,
    });
    if (claimError) {
      console.error("claim_failed", claimError.message);
      failed++;
      continue;
    }
    if (!claimed) {
      skipped++;
      continue;
    }

    // Resend ignores a repeated key, so retrying after a crash can't deliver it twice.
    const result = await sendResend(email, email.key).catch((e) => ({ id: undefined, error: String(e).slice(0, 300) }));
    await admin
      .from("email_log")
      .update(
        result.error
          ? { status: "failed", error: result.error, updated_at: new Date().toISOString() }
          : { status: "sent", provider_id: result.id ?? null, error: null, updated_at: new Date().toISOString() },
      )
      .eq("dedupe_key", email.key);
    if (result.error) failed++;
    else sent++;
    await sleep(600); // stays under Resend's default rate limit
  }

  return json({ sent, failed, skipped });
});
