// Grand Hill Back Office — email-alerts Edge Function
//
// Called every 15 minutes by pg_cron (migration 0006). It sends through Resend:
//   staff digest      weekday mornings in Florida, only when something needs attention
//   expiry reminders  COI and license on each reminder date and once expired, to portal logins
//   review results    approved or rejected documents, to portal logins
//   change approvals  an approved change order that changes a sub's agreed amount, to portal logins
//   proposal answers  a client accepted or rejected a proposal link, to its sender and the super admins
// Hour, recipients, reminder days and on/off switches come from public.app_settings (Configuración).
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
import {
  cleanDays,
  DEFAULT_SETTINGS,
  planEmails,
  type AlertSettings,
  type ChangeOrderRow,
  type ProposalDecision,
  type Doc,
  type Email,
  type Lead,
  type Profile,
} from "./rules.ts";

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

  const [profiles, docs, leads, stored, orders, assignments, decisions] = await Promise.all([
    admin.from("profiles").select("id, email, full_name, role, subcontractor_id"),
    admin
      .from("subcontractor_documents")
      .select("id, subcontractor_id, doc_type, expires_on, review_status, rejection_reason, reviewed_at, subcontractors(company_name, status)"),
    admin
      .from("leads")
      .select("id, name, company, status, owner_id, next_follow_up")
      .not("status", "in", "(converted,lost)")
      .not("next_follow_up", "is", null),
    admin
      .from("app_settings")
      .select("digest_enabled, digest_hour, digest_muted, expiry_days, subs_alerts_enabled")
      .maybeSingle(),
    admin
      .from("change_orders")
      .select("id, project_id, number, title, status, contract_delta, sub_delta, project_sub_id, requested_on, decided_at, project:projects(name)"),
    admin.from("project_subs").select("id, subcontractor_id, agreed_amount"),
    admin
      .from("proposal_links")
      .select("id, bid_id, status, decided_at, signer_name, signer_email, client_note, total, created_by, bid:bids(title, client:clients(name))")
      .in("status", ["accepted", "rejected"])
      .gte("decided_at", new Date(Date.now() - 3 * 86_400_000).toISOString()),
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

  // Change orders (0008/0009). Without them the other alerts still go out.
  if (orders.error || assignments.error) console.error("change_orders_unavailable", orders.error?.message ?? assignments.error?.message);
  type OrderRow = Omit<ChangeOrderRow, "project_name" | "subcontractor_id" | "current_agreed"> & {
    project_sub_id: string | null;
    project: { name: string } | null;
  };
  const orderRows = orders.error || assignments.error ? [] : (orders.data as unknown as OrderRow[]);
  const subsById = new Map(
    ((assignments.data ?? []) as { id: string; subcontractor_id: string; agreed_amount: number | null }[]).map((a) => [a.id, a]),
  );
  const approvedBySub = new Map<string, number>();
  for (const o of orderRows) {
    if (o.status === "approved" && o.project_sub_id && o.sub_delta !== null) {
      approvedBySub.set(o.project_sub_id, (approvedBySub.get(o.project_sub_id) ?? 0) + Number(o.sub_delta));
    }
  }
  const changeOrders: ChangeOrderRow[] = orderRows.map(({ project, project_sub_id, ...o }) => {
    const a = project_sub_id ? subsById.get(project_sub_id) : undefined;
    return {
      ...o,
      project_name: project?.name ?? "—",
      subcontractor_id: a?.subcontractor_id ?? null,
      current_agreed: a ? Number(a.agreed_amount ?? 0) + (approvedBySub.get(a.id) ?? 0) : null,
    };
  });

  // Proposal answers (0013). Without them the other alerts still go out.
  if (decisions.error) console.error("proposal_links_unavailable", decisions.error.message);
  type DecisionRow = Omit<ProposalDecision, "bid_title" | "client_name"> & { bid: { title: string; client: { name: string } | null } | null };
  const proposals: ProposalDecision[] = decisions.error
    ? []
    : (decisions.data as unknown as DecisionRow[]).map(({ bid, ...d }) => ({ ...d, bid_title: bid?.title ?? "—", client_name: bid?.client?.name ?? null }));

  // Configuración in the app. Before migration 0007 there is no table: today's defaults and the old secret.
  const s = stored.error ? null : stored.data;
  const settings: AlertSettings = s
    ? {
        digestEnabled: s.digest_enabled,
        digestHour: s.digest_hour,
        digestMuted: s.digest_muted ?? [],
        expiryDays: cleanDays(s.expiry_days),
        subsEnabled: s.subs_alerts_enabled,
      }
    : { ...DEFAULT_SETTINGS, subsEnabled: Deno.env.get("ALERTS_SUBS_ENABLED") === "true" };
  // A preview shows every kind of email, whatever is switched off.
  if (previewTo) Object.assign(settings, { digestEnabled: true, digestMuted: [], subsEnabled: true });

  const emails = planEmails({
    profiles: profiles.data as Profile[],
    docs: docRows,
    leads: leads.data as Lead[],
    now: new Date(),
    appUrl: (Deno.env.get("APP_URL") ?? "https://app.grandhillcorp.com").replace(/\/+$/, ""),
    settings,
    changeOrders,
    proposals,
    force: dryRun || Boolean(previewTo),
  });

  const counts = (list: Email[]) =>
    list.reduce<Record<string, number>>((acc, e) => ({ ...acc, [e.kind]: (acc[e.kind] ?? 0) + 1 }), {});

  if (dryRun) return json({ dry_run: true, due: counts(emails) });

  if (previewTo) {
    const samples = ["digest", "reminder", "review", "change", "proposal"].flatMap((kind) => emails.find((e) => e.kind === kind) ?? []);
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
