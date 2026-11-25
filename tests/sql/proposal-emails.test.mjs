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
for (const f of ["0001_foundations.sql","0002_projects.sql","0003_leads.sql","0004_convert_lead.sql","0005_subcontractor_portal.sql","0006_email_alerts.sql","0007_settings.sql","0008_change_orders.sql","0009_change_order_decisions.sql","0010_record_links.sql","0011_estimates.sql","0012_proposal_settings.sql"]) await db.exec(readFileSync(M+f,"utf8").replace(/create extension[^;]+;/g,""));
await db.exec(`
insert into subcontractors(id,company_name) values ('10000000-0000-0000-0000-000000000001','X Co');
insert into profiles(id,email,role) values ('${U.a}','AdrianGerig@gmail.com','super_admin'),('${U.b}','b@t.co','admin') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=null;
insert into profiles(id,email,role,subcontractor_id) values ('${U.x}','x@t.co','subcontractor','10000000-0000-0000-0000-000000000001') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=excluded.subcontractor_id;`);




await db.exec(readFileSync(M+"0013_proposal_links.sql","utf8"));
await db.exec(readFileSync(M+"0014_proposal_emails.sql","utf8"));
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
async function anon(sql){ await db.exec(`set test.uid=''; set role anon;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const B="50000000-0000-0000-0000-000000000001";
await db.exec(`insert into bids(id,title,status) values ('${B}','Bid','submitted')`);
const L=(await as(U.b,`insert into proposal_links(bid_id,lang,content,total,valid_until) values ('${B}','en','{}',100,current_date + 30) returning id`)).rows[0];
// What the send-proposal function does with the service role (here: the table owner).
const ins=(extra={})=>{const v={recipient:"'ana@client.com'",cc:"'{}'",status:"'sent'",sent_by:`'${U.b}'`,...extra};return db.query(`insert into proposal_emails(proposal_link_id,${Object.keys(v)}) values ('${L.id}',${Object.values(v)}) returning id`).then(r=>({rows:r.rows}),e=>({error:e.message}));};
ok("service inserts", !(await ins()).error);
ok("bad status refused", !!(await ins({status:"'queued'"})).error);
ok("max 5 cc", !!(await ins({cc:"'{a@b.co,c@b.co,d@b.co,e@b.co,f@b.co,g@b.co}'"})).error);
ok("5 cc ok", !(await ins({cc:"'{a@b.co,c@b.co,d@b.co,e@b.co,f@b.co}'"})).error);
ok("message limit", !!(await ins({message:`'${"x".repeat(4001)}'`})).error);
ok("staff reads", (await as(U.b,"select * from proposal_emails")).rows?.length===2);
ok("super admin reads", (await as(U.a,"select * from proposal_emails")).rows?.length===2);
ok("staff embeds from links", (await as(U.b,`select id from proposal_links where id='${L.id}'`)).rows?.length===1);
ok("staff can't insert", !!(await as(U.b,`insert into proposal_emails(proposal_link_id,recipient,status) values ('${L.id}','x@y.co','sent')`)).error);
ok("staff can't edit", !!(await as(U.b,`update proposal_emails set recipient='z@y.co'`)).error);
ok("staff can't delete", !!(await as(U.b,`delete from proposal_emails`)).error);
ok("sub sees nothing", (await as(U.x,"select * from proposal_emails")).rows?.length===0);
ok("anon can't read", !!(await anon("select * from proposal_emails")).error);
await db.exec(`delete from bids where id='${B}'`);
ok("cascade with bid", (await db.query("select count(*)::int n from proposal_emails")).rows[0].n===0);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
