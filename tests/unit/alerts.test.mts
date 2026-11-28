import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_SETTINGS, cleanDays, planEmails, floridaClock, isMorningWindow, currentDocs, staffShouldSee, reminderStage, esc } from "../../supabase/functions/email-alerts/rules.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

// Monday 2026-11-23, 8:15 a.m. Florida (EST)
const MON = new Date("2026-11-23T13:15:00Z");
ok("clock date", floridaClock(MON).today === "2026-11-23");
ok("clock hour EST", floridaClock(MON).hour === 8);
ok("clock hour EDT", floridaClock(new Date("2026-07-06T12:15:00Z")).hour === 8);
ok("window mon 8", isMorningWindow(MON));
ok("not 7:59", !isMorningWindow(new Date("2026-11-23T12:59:00Z")));
ok("not 11:00", !isMorningWindow(new Date("2026-11-23T16:00:00Z")));
ok("not saturday", !isMorningWindow(new Date("2026-11-28T13:15:00Z")));
ok("not sunday", !isMorningWindow(new Date("2026-11-29T13:15:00Z")));

ok("stage none", reminderStage(31) === null);
ok("stage 30", reminderStage(30) === "30");
ok("stage 15", reminderStage(15) === "15");
ok("stage 7", reminderStage(7) === "7");
ok("stage today", reminderStage(0) === "7");
ok("stage expired", reminderStage(-1) === "expired");
ok("staff 30 tue", staffShouldSee(30, 2));
ok("staff 29 tue no", !staffShouldSee(29, 2));
ok("staff 28 mon (weekend)", staffShouldSee(28, 1));
ok("staff 27 mon no", !staffShouldSee(27, 1));
ok("staff 13 mon", staffShouldSee(13, 1));
ok("staff 7", staffShouldSee(7, 3));
ok("staff expired", staffShouldSee(-20, 3));

const base = { subcontractor_id: "s1", company_name: "ACME <b>", sub_status: "active", doc_type: "coi", review_status: "approved", rejection_reason: null, reviewed_at: null } as any;
const doc = (o: any) => ({ ...base, id: Math.random().toString(36).slice(2), expires_on: "2026-11-27", ...o });
ok("renewal replaces", currentDocs([doc({ id: "old" }), doc({ id: "new", expires_on: "2027-11-27" })])[0].id === "new");
ok("pending ignored", currentDocs([doc({ review_status: "pending" })]).length === 0);
ok("rejected ignored", currentDocs([doc({ review_status: "rejected" })]).length === 0);
ok("inactive ignored", currentDocs([doc({ sub_status: "inactive" })]).length === 0);
ok("w9 ignored", currentDocs([doc({ doc_type: "w9" })]).length === 0);
ok("no expiry wins", currentDocs([doc({}), doc({ expires_on: null })]).length === 0);

const profiles: any[] = [
  { id: "a", email: "a@x.com", full_name: "Ana Uno", role: "super_admin", subcontractor_id: null },
  { id: "b", email: "b@x.com", full_name: "Beto Dos", role: "admin", subcontractor_id: null },
  { id: "u", email: "u@sub.com", full_name: "Sub", role: "subcontractor", subcontractor_id: "s1" },
  { id: "v", email: "v@other.com", full_name: "Otro", role: "subcontractor", subcontractor_id: "s2" },
];
const leads: any[] = [
  { id: "l1", name: "Lead de Ana", company: null, status: "new", owner_id: "a", next_follow_up: "2026-11-23" },
  { id: "l2", name: "Lead de Beto", company: null, status: "contacted", owner_id: "b", next_follow_up: "2026-11-20" },
  { id: "l3", name: "Lead sin dueño", company: null, status: "new", owner_id: null, next_follow_up: "2026-11-22" },
  { id: "l4", name: "Lead futuro", company: null, status: "new", owner_id: "b", next_follow_up: "2026-12-01" },
  { id: "l5", name: "Lead perdido", company: null, status: "lost", owner_id: "b", next_follow_up: "2026-11-01" },
];
const plan = (o: any = {}) => planEmails({ profiles, docs: [doc({ id: "d1" })], leads, now: MON, appUrl: "https://app.test", ...o, settings: { ...DEFAULT_SETTINGS, subsEnabled: true, ...(o.settings ?? {}) } });
const emails = plan();
const dA = emails.find((e) => e.key === "digest:2026-11-23:a")!;
const dB = emails.find((e) => e.key === "digest:2026-11-23:b")!;
ok("digest a", dA);
ok("digest b", dB);
ok("a sees own", dA.text.includes("Lead de Ana"));
ok("a sees unowned", dA.text.includes("Lead sin dueño"));
ok("a not b's", !dA.text.includes("Lead de Beto"));
ok("b sees own", dB.text.includes("Lead de Beto"));
ok("b not unowned", !dB.text.includes("Lead sin dueño"));
ok("future excluded", !dB.text.includes("Lead futuro"));
ok("lost excluded", !dB.text.includes("Lead perdido"));
ok("both see doc", dA.text.includes("ACME") && dB.text.includes("ACME"));
ok("no digest to sub", !emails.some((e) => e.kind === "digest" && e.to.includes("sub.com")));
ok("html escaped", dA.html.includes("ACME &lt;b&gt;") && !dA.html.includes("ACME <b>"));
const rem = emails.filter((e) => e.kind === "reminder");
ok("reminder only own login", rem.length === 1 && rem[0].to === "u@sub.com");
ok("reminder no internal", !rem[0].text.includes("Lead"));
ok("reminder key stage", rem[0].key.includes(":7:u"));
ok("subs off", !plan({ settings: { subsEnabled: false } }).some((e) => e.kind !== "digest"));
ok("renewing skips reminder", !plan({ docs: [doc({ id: "d1" }), doc({ id: "p", review_status: "pending" })] }).some((e) => e.kind === "reminder"));
ok("nothing no digest", plan({ docs: [], leads: [] }).length === 0);
ok("outside window none", plan({ now: new Date("2026-11-23T18:00:00Z") }).length === 0);
ok("force ignores window", plan({ now: new Date("2026-11-23T18:00:00Z"), force: true }).length > 0);

const rej = doc({ id: "r1", review_status: "rejected", rejection_reason: "<script>x</script>", reviewed_at: "2026-11-23T17:00:00Z" });
const after = plan({ now: new Date("2026-11-23T18:00:00Z"), docs: [rej], leads: [] });
ok("review any hour", after.length === 1 && after[0].kind === "review" && after[0].to === "u@sub.com");
ok("reason escaped", after[0].html.includes("&lt;script&gt;") && !after[0].html.includes("<script>"));
ok("review old skipped", plan({ now: new Date("2026-11-27T18:00:00Z"), docs: [rej], leads: [] }).length === 0);
ok("subject one line", !plan({ now: new Date("2026-11-23T18:00:00Z"), leads: [], docs: [{ ...rej, company_name: "A\r\nBcc: x@y.com" }] })[0].subject.match(/[\r\n]/));
ok("esc quotes", esc(`"'`) === "&quot;&#39;");

// ---- settings
ok("clean days sorts/dedupes", JSON.stringify(cleanDays([7, 30, 7, 0, 500, "x"])) === "[30,7]");
ok("clean days fallback", JSON.stringify(cleanDays([])) === "[30,15,7]");
ok("hour 6 window", isMorningWindow(new Date("2026-11-23T11:30:00Z"), 6));
ok("hour 6 closes at 9", !isMorningWindow(new Date("2026-11-23T14:00:00Z"), 6));
ok("hour 10 not at 8", !isMorningWindow(MON, 10));
ok("digest waits for hour 10", !plan({ settings: { digestHour: 10 } }).some((e) => e.kind === "digest"));
ok("digest off", !plan({ settings: { digestEnabled: false } }).some((e) => e.kind === "digest"));
ok("digest off keeps sub reminders", plan({ settings: { digestEnabled: false } }).some((e) => e.kind === "reminder"));
const muted = plan({ settings: { digestMuted: ["b"] } });
ok("muted b gets none", !muted.some((e) => e.key.endsWith(":b")) && muted.some((e) => e.key.endsWith(":a")));
ok("muted owner lead not moved to a", !muted.find((e) => e.key.endsWith(":a"))!.text.includes("Lead de Beto"));
ok("custom days stage", reminderStage(40, [60, 45]) === "45" && reminderStage(50, [60, 45]) === "60" && reminderStage(61, [60]) === null);
ok("custom staff daily threshold", staffShouldSee(3, 2, [30, 3]) && !staffShouldSee(5, 2, [30, 3]) && staffShouldSee(30, 2, [30, 3]));
ok("day 1 only", reminderStage(1, [1]) === "1" && reminderStage(2, [1]) === null);
const d45 = plan({ docs: [doc({ id: "d45", expires_on: "2027-01-07" })], leads: [], settings: { expiryDays: [45, 15] } });
ok("45-day reminder sent", d45.some((e) => e.kind === "reminder" && e.key.includes(":45:")));
ok("45-day in staff digest once", d45.some((e) => e.kind === "digest"));

// ---- change orders
const co = (o: any) => ({ id: "co1", project_id: "p1", project_name: "Obra <x>", number: 3, title: "Cerca", status: "pending", contract_delta: 6500, sub_delta: null, requested_on: "2026-11-20", decided_at: null, subcontractor_id: null, current_agreed: null, ...o });
const withCo = plan({ changeOrders: [co({})], docs: [], leads: [] });
const dgA = withCo.find((e) => e.key === "digest:2026-11-23:a")!;
ok("pending CO makes digest", dgA && withCo.some((e) => e.key === "digest:2026-11-23:b"));
ok("pending CO in digest text", dgA.text.includes("Órdenes de cambio por aprobar") && dgA.text.includes("CO 3 · Cerca") && dgA.text.includes("+$6,500") && dgA.text.includes("hace 3 días"));
ok("CO link to project", dgA.text.includes("https://app.test/proyectos/p1"));
ok("CO name escaped", dgA.html.includes("Obra &lt;x&gt;"));
ok("approved CO not in digest", !plan({ changeOrders: [co({ status: "approved", decided_at: "2026-11-23T10:00:00Z" })], docs: [], leads: [] }).some((e) => e.kind === "digest"));
const appr = co({ status: "approved", decided_at: "2026-11-23T17:00:00Z", subcontractor_id: "s1", sub_delta: 4000, current_agreed: 42000 });
const ch = plan({ now: new Date("2026-11-23T18:00:00Z"), changeOrders: [appr], docs: [], leads: [] });
ok("change email any hour to own login only", ch.length === 1 && ch[0].kind === "change" && ch[0].to === "u@sub.com");
ok("change email amounts", ch[0].text.includes("+$4,000") && ch[0].text.includes("$42,000") && ch[0].text.includes("CO 3"));
ok("change email hides contract", !ch[0].text.includes("6,500") && !ch[0].text.includes("6500"));
ok("change key", ch[0].key === "change:co1:2026-11-23T17:00:00Z:u");
ok("change off when subs off", plan({ now: new Date("2026-11-23T18:00:00Z"), changeOrders: [appr], docs: [], leads: [], settings: { subsEnabled: false } }).length === 0);
ok("old approval skipped", plan({ now: new Date("2026-11-30T18:00:00Z"), changeOrders: [appr], docs: [], leads: [] }).length === 0);
ok("approved without sub: no email", plan({ now: new Date("2026-11-23T18:00:00Z"), changeOrders: [co({ status: "approved", decided_at: "2026-11-23T17:00:00Z" })], docs: [], leads: [] }).length === 0);
ok("credit email", plan({ now: new Date("2026-11-23T18:00:00Z"), changeOrders: [{ ...appr, sub_delta: -500, current_agreed: 37500 }], docs: [], leads: [] })[0].text.includes("−$500"));

// ---- proposal answers
const pd = (o: any) => ({ id: "pl1", bid_id: "b9", bid_title: "Clubhouse <x>", client_name: "ACME", status: "accepted", decided_at: "2026-11-23T17:00:00Z", signer_name: "Ana Cliente", signer_email: "ana@acme.com", client_note: null, total: 15996, created_by: "b", ...o });
const pr = plan({ now: new Date("2026-11-23T18:00:00Z"), proposals: [pd({})], docs: [], leads: [] });
ok("proposal to creator and super admin", pr.length === 2 && pr.every((e) => e.kind === "proposal") && pr.some((e) => e.to === "b@x.com") && pr.some((e) => e.to === "a@x.com"));
ok("proposal not to subs", !pr.some((e) => e.to.includes("sub.com") || e.to.includes("other.com")));
ok("proposal accepted text", pr[0].text.includes("Ana Cliente aceptó") && pr[0].text.includes("$15,996") && pr[0].text.includes("Ganado") && pr[0].text.includes("https://app.test/bids/b9"));
ok("proposal escaped", pr[0].html.includes("Clubhouse &lt;x&gt;"));
ok("proposal subs switch irrelevant", plan({ now: new Date("2026-11-23T18:00:00Z"), proposals: [pd({})], docs: [], leads: [], settings: { subsEnabled: false, digestEnabled: false } }).length === 2);
const rj2 = plan({ now: new Date("2026-11-23T18:00:00Z"), proposals: [pd({ status: "rejected", signer_name: null, client_note: "Too high", created_by: "a" })], docs: [], leads: [] });
ok("rejected once to super admin creator", rj2.length === 1 && rj2[0].text.includes("El cliente rechazó") && rj2[0].text.includes("Comentario: Too high"));
ok("old answer skipped", plan({ now: new Date("2026-11-30T18:00:00Z"), proposals: [pd({})], docs: [], leads: [] }).length === 0);
ok("proposal key", pr[0].key.startsWith("proposal:pl1:2026-11-23T17:00:00Z:"));
// ---- team emails in English (Configuración > staff_lang)
const en = { staffLang: "en" as const };
const prEn = plan({ now: new Date("2026-11-23T18:00:00Z"), proposals: [pd({})], docs: [], leads: [], settings: en });
ok("proposal in English", prEn[0].subject.includes("Proposal accepted") && prEn[0].text.includes("Ana Cliente accepted the proposal") && prEn[0].text.includes("$15,996") && prEn[0].text.includes("Won") && prEn[0].html.includes("Open the bid and create the project"));
const rjEn = plan({ now: new Date("2026-11-23T18:00:00Z"), proposals: [pd({ status: "rejected", signer_name: null, client_note: "Too high", created_by: "a" })], docs: [], leads: [], settings: en });
ok("declined in English", rjEn[0].text.includes("The client declined") && rjEn[0].text.includes("Comment: Too high"));
const digEn = plan({ settings: en }).find((e) => e.kind === "digest")!;
ok("digest in English", /^Grand Hill · \d+ items? for today$/.test(digEn.subject) && digEn.html.includes("this needs attention") && digEn.html.includes("Open the overview") && !digEn.html.includes("Documentos"));
ok("digest doc labels in English", !digEn.html.includes("Seguro (COI)") && (digEn.html.includes("Insurance (COI)") || digEn.html.includes("License") || !digEn.html.includes("COI")));
const subEmails = plan({ settings: en }).filter((e) => e.kind === "reminder" || e.kind === "review");
ok("sub emails stay bilingual", subEmails.every((e) => e.text.includes("portal")) && subEmails.some((e) => /[áéíóú]|Sube|Tu /.test(e.text)));
ok("unknown language falls back to Spanish", plan({ settings: { staffLang: "fr" as unknown as "es" } }).find((e) => e.kind === "digest")!.subject.includes("de hoy"));

// SQL
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema vault; create schema net; create schema cron; create schema extensions;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create table net.calls (url text, headers jsonb);
  create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net.calls values (url, headers) returning 1::bigint $$;
  create table cron.jobs (name text, sched text, cmd text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.jobs values (n, s, c) returning 1::bigint $$;
`);
const sql = readFileSync(new URL("../../supabase/migrations/0006_email_alerts.sql", import.meta.url), "utf8").replace(/create extension[^;]+;/g, "");
await db.exec(sql);
const claim = async (k: string) => (await db.query<any>("select public.claim_email($1,'digest','a@x.com') c", [k])).rows[0].c;
ok("first claim", await claim("k1"));
ok("in flight blocked", !(await claim("k1")));
await db.exec("update public.email_log set status='sent' where dedupe_key='k1'");
ok("sent blocked", !(await claim("k1")));
await claim("k2"); await db.exec("update public.email_log set status='failed' where dedupe_key='k2'");
ok("failed retries", await claim("k2"));
await db.exec("update public.email_log set updated_at=now()-interval '20 minutes' where dedupe_key='k2'");
ok("stale retries", await claim("k2"));
await db.exec("update public.email_log set status='failed', attempts=5 where dedupe_key='k2'");
ok("retry cap", !(await claim("k2")));
await db.exec("select public.invoke_email_alerts()");
ok("inactive until secret", (await db.query<any>("select count(*)::int n from net.calls")).rows[0].n === 0);
await db.exec("insert into vault.decrypted_secrets values ('email_alerts_secret','s3')");
await db.exec("select public.invoke_email_alerts()");
ok("calls with secret", (await db.query<any>("select headers->>'x-alerts-secret' s from net.calls")).rows[0]?.s === "s3");
ok("job scheduled", (await db.query<any>("select count(*)::int n from cron.jobs where name='email-alerts' and sched='*/15 * * * *'")).rows[0].n === 1);
for (const role of ["anon", "authenticated"]) {
  for (const [label, q] of [["log", "select * from public.email_log"], ["claim", "select public.claim_email('z','d','e')"], ["invoke", "select public.invoke_email_alerts()"]]) {
    await db.exec(`set role ${role}`);
    let denied = false;
    try { await db.query(q); } catch { denied = true; }
    await db.exec("reset role");
    ok(`${role} denied ${label}`, denied);
  }
}
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
