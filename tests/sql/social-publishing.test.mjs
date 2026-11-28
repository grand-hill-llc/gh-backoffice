import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const M=fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const db=new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema storage; create schema vault; create schema net; create schema cron; create schema extensions;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name),'.',1)) $$;
grant execute on all functions in schema storage to authenticated;
alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated;
create table vault.decrypted_secrets (name text, decrypted_secret text);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ select 1::bigint $$;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const U={a:"00000000-0000-0000-0000-00000000000a",b:"00000000-0000-0000-0000-00000000000b",x:"00000000-0000-0000-0000-000000000001"};
await db.exec(`insert into auth.users values ('${U.a}','adriangerig@gmail.com'),('${U.b}','b@t.co'),('${U.x}','x@t.co');`);
for (const f of ["0001_foundations.sql","0002_projects.sql","0003_leads.sql","0004_convert_lead.sql","0005_subcontractor_portal.sql","0006_email_alerts.sql"]) await db.exec(readFileSync(M+f,"utf8").replace(/create extension[^;]+;/g,""));
await db.exec(`
insert into subcontractors(id,company_name) values ('10000000-0000-0000-0000-000000000001','X Co');
insert into profiles(id,email,role) values ('${U.a}','AdrianGerig@gmail.com','super_admin'),('${U.b}','b@t.co','admin') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=null;
insert into profiles(id,email,role,subcontractor_id) values ('${U.x}','x@t.co','subcontractor','10000000-0000-0000-0000-000000000001') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=excluded.subcontractor_id;`);
await db.exec(readFileSync(M+"0007_settings.sql","utf8"));
// 0015 only adds a column to app_settings.
await db.exec(readFileSync(M+"0015_staff_language.sql","utf8"));
await db.exec(readFileSync(M+"0016_social_posts.sql","utf8"));
await db.exec(readFileSync(M+"0017_social_publishing.sql","utf8"));
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
async function svc(sql){ await db.exec(`set test.uid=''; set role service_role;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
await db.exec("grant usage on schema public to service_role; grant select, insert, update on all tables in schema public to service_role;");
const A=U.a,B=U.b,X=U.x;
const mk=async(title,channels,status,when)=> (await as(A,`insert into social_posts(title,channels,status,scheduled_at) values ('${title}','{${channels}}','${status}',${when}) returning id`)).rows[0].id;
const claim=async(p)=> (await svc(`select post_id, channel, status, attempts from claim_social_deliveries(${p?`'${p}'`:"null"})`));

ok("autopublish off by default", (await db.query("select meta_autopublish v from app_settings")).rows[0].v===false);
const due=await mk("Due","facebook,instagram,linkedin","scheduled","now() - interval '1 minute'");
const later=await mk("Later","facebook","scheduled","now() + interval '1 day'");
const draft=await mk("Draft","instagram","draft","now() - interval '1 minute'");
const manual=await mk("Manual","linkedin","scheduled","now() - interval '1 minute'");

ok("staff can't claim", !!(await as(A,"select * from claim_social_deliveries(null)")).error);
ok("off: scheduler claims nothing", (await claim()).rows?.length===0);
await db.exec("update app_settings set meta_autopublish=true");
const c1=await claim();
ok("on: due post claimed for facebook and instagram only", c1.rows?.length===2 && c1.rows.every(r=>r.post_id===due && r.status==="publishing") && c1.rows.map(r=>r.channel).sort().join()==="facebook,instagram");
ok("second run claims nothing (no double publishing)", (await claim()).rows?.length===0);
ok("staff reads deliveries", (await as(B,"select * from social_deliveries")).rows?.length===2);
ok("subcontractor reads none", (await as(X,"select * from social_deliveries")).rows?.length===0);
ok("staff can't write deliveries", !!(await as(A,`update social_deliveries set status='published' returning id`)).error || (await as(A,`update social_deliveries set status='published' returning id`)).rows?.length===0);

// failures and retries
await db.exec(`update social_deliveries set status='failed', error='boom', finished_at=now() where post_id='${due}' and channel='facebook'`);
await db.exec(`update social_deliveries set status='published', finished_at=now() where post_id='${due}' and channel='instagram'`);
ok("failed waits 10 minutes before an automatic retry", (await claim()).rows?.length===0);
await db.exec(`update social_deliveries set finished_at=now()-interval '11 minutes' where post_id='${due}' and channel='facebook'`);
const r1=await claim();
ok("then retried once, published one untouched", r1.rows?.length===1 && r1.rows[0].channel==="facebook" && r1.rows[0].attempts===2);
await db.exec(`update social_deliveries set status='failed', attempts=3, finished_at=now()-interval '1 hour' where post_id='${due}' and channel='facebook'`);
ok("no automatic retry after 3 attempts", (await claim()).rows?.length===0);
const r2=await claim(due);
ok("'publish now' retries it anyway", r2.rows?.length===1 && r2.rows[0].attempts===4);

// interrupted sends
await db.exec(`update social_deliveries set started_at=now()-interval '20 minutes' where post_id='${due}' and channel='facebook'`);
await claim();
const intr=(await db.query(`select status, error from social_deliveries where post_id='${due}' and channel='facebook'`)).rows[0];
ok("interrupted send becomes failed, not retried", intr.status==="failed" && intr.error==="interrupted");
await db.exec(`update social_deliveries set finished_at=now()-interval '1 hour', attempts=1 where post_id='${due}' and channel='facebook'`);
ok("interrupted isn't retried by the scheduler", (await claim()).rows?.length===0);
ok("but 'publish now' retries it", (await claim(due)).rows?.length===1);

// publish now
ok("'publish now' on a future post", (await claim(later)).rows?.map(r=>r.channel).join()==="facebook");
ok("'publish now' ignores drafts", (await claim(draft)).rows?.length===0);
ok("manual-only networks never claimed", (await claim(manual)).rows?.length===0);

// instagram video processing
await db.exec(`update social_deliveries set status='processing', container_id='c1' where post_id='${later}'`);
const pr=await claim();
ok("processing video handed back to check", pr.rows?.length===1 && pr.rows[0].post_id===later && pr.rows[0].status==="publishing");

// released when out of time
const rel=await mk("Rel","facebook","scheduled","now() - interval '1 minute'");
const relRow=(await claim(rel)).rows[0];
const relId=(await db.query(`select id from social_deliveries where post_id='${rel}'`)).rows[0].id;
ok("staff can't release", !!(await as(A,`select release_social_delivery('${relId}')`)).error);
await svc(`select release_social_delivery('${relId}')`);
ok("a fresh claim released is dropped", relRow && (await db.query(`select count(*)::int n from social_deliveries where post_id='${rel}'`)).rows[0].n===0);
ok("and taken again next run", (await claim()).rows?.some(r=>r.post_id===rel));

// cleanup
ok("deleting a post deletes its deliveries", (await as(A,`delete from social_posts where id='${later}' returning id`)).rows?.length===1 && (await db.query(`select count(*)::int n from social_deliveries where post_id='${later}'`)).rows[0].n===0);
ok("admin can't turn on autopublish", ((await as(B,"update app_settings set meta_autopublish=false returning 1")).rows?.length ?? 0)===0);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
