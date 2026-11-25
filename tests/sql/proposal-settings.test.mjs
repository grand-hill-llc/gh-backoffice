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
for (const f of ["0001_foundations.sql","0002_projects.sql","0003_leads.sql","0004_convert_lead.sql","0005_subcontractor_portal.sql","0006_email_alerts.sql","0007_settings.sql","0008_change_orders.sql","0009_change_order_decisions.sql","0010_record_links.sql","0011_estimates.sql"]) await db.exec(readFileSync(M+f,"utf8").replace(/create extension[^;]+;/g,""));
await db.exec(`
insert into subcontractors(id,company_name) values ('10000000-0000-0000-0000-000000000001','X Co');
insert into profiles(id,email,role) values ('${U.a}','AdrianGerig@gmail.com','super_admin'),('${U.b}','b@t.co','admin') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=null;
insert into profiles(id,email,role,subcontractor_id) values ('${U.x}','x@t.co','subcontractor','10000000-0000-0000-0000-000000000001') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=excluded.subcontractor_id;`);



await db.exec(readFileSync(M+"0012_proposal_settings.sql","utf8"));
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const row=(await db.query("select proposal_show_lines, proposal_validity_days, proposal_terms from app_settings")).rows[0];
ok("defaults", row.proposal_show_lines===true && row.proposal_validity_days===30 && row.proposal_terms===null);
ok("admin reads", !!(await as(U.b,"select proposal_terms, company_license from app_settings")).rows?.length);
ok("sub reads nothing", (await as(U.x,"select proposal_terms from app_settings")).rows?.length===0);
ok("admin can't update", ((await as(U.b,"update app_settings set proposal_terms='x' returning 1")).rows?.length ?? 0)===0);
const up=await as(U.a,"update app_settings set proposal_show_lines=false, proposal_validity_days=45, proposal_terms='Deposit 30%', company_address='Orlando', company_phone='407', company_email='a@b.co', company_license='CGC1' returning proposal_validity_days");
ok("super admin updates all", up.rows?.[0]?.proposal_validity_days===45);
ok("validity 0 rejected", !!(await as(U.a,"update app_settings set proposal_validity_days=0")).error);
ok("validity 366 rejected", !!(await as(U.a,"update app_settings set proposal_validity_days=366")).error);
ok("terms too long rejected", !!(await as(U.a,`update app_settings set proposal_terms='${"x".repeat(5001)}'`)).error);
ok("phone too long rejected", !!(await as(U.a,`update app_settings set company_phone='${"1".repeat(51)}'`)).error);
ok("earlier settings untouched", Number((await db.query("select default_markup_pct from app_settings")).rows[0].default_markup_pct)===20);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
