// Grand Hill Back Office — admin-users Edge Function
//
// Account management that needs the service_role key, which must never reach the browser:
//   list    every auth user with its sign-in status (who was invited, who has signed in)
//   invite  send an invitation email and create the person's profile with a role
//   delete  remove a person's account entirely (their profile goes with it)
// Role changes don't need this function: super admins update public.profiles directly, under RLS.
//
// Only a signed-in super_admin can call it. Deploy: see README ("Gestión de usuarios").

import { createClient } from "jsr:@supabase/supabase-js@2";

const ROLES = ["super_admin", "admin", "subcontractor"] as const;
type Role = (typeof ROLES)[number];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is calling, and are they a super admin?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerError } = await admin.auth.getUser(token);
  if (callerError || !caller.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await admin.from("profiles").select("role").eq("id", caller.user.id).maybeSingle();
  if (me?.role !== "super_admin") return json({ error: "forbidden" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }

  switch (body.action) {
    case "list": {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) return json({ error: "list_failed" }, 500);
      return json({
        users: data.users.map((u) => ({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at,
          invited_at: u.invited_at ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        })),
      });
    }

    case "invite": {
      const email = String(body.email ?? "").trim().toLowerCase();
      const fullName = String(body.full_name ?? "").trim() || null;
      const role = body.role as Role;
      const subcontractorId = body.subcontractor_id ? String(body.subcontractor_id) : null;
      const redirectTo = typeof body.redirect_to === "string" ? body.redirect_to : undefined;

      if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
      if (!ROLES.includes(role)) return json({ error: "invalid_role" }, 400);
      if ((role === "subcontractor") !== !!subcontractorId) return json({ error: "invalid_company" }, 400);

      // Supabase checks redirect_to against the project's allowed Redirect URLs.
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: fullName } });
      if (error || !data.user) {
        const exists = /already|registered|exists/i.test(error?.message ?? "");
        return json({ error: exists ? "exists" : "invite_failed", detail: error?.message }, exists ? 409 : 500);
      }

      const { error: profileError } = await admin
        .from("profiles")
        .insert({ id: data.user.id, email, full_name: fullName, role, subcontractor_id: subcontractorId });
      if (profileError) {
        // Don't leave an account with no role behind.
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: "profile_failed", detail: profileError.message }, 500);
      }
      return json({ id: data.user.id });
    }

    case "delete": {
      const id = String(body.id ?? "");
      if (!id) return json({ error: "bad_request" }, 400);
      if (id === caller.user.id) return json({ error: "self" }, 400);
      // The profile goes with the account (on delete cascade). The last super admin is protected by a trigger.
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) {
        const last = /ultimo super admin|último super admin/i.test(error.message);
        return json({ error: last ? "last_super_admin" : "delete_failed", detail: error.message }, last ? 409 : 500);
      }
      return json({ ok: true });
    }

    default:
      return json({ error: "unknown_action" }, 400);
  }
});
