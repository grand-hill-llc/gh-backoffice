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
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
async function anon(sql){ await db.exec(`set test.uid=''; set role anon;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const B="50000000-0000-0000-0000-000000000001";
await db.exec(`insert into bids(id,title,status) values ('${B}','Bid','submitted')`);
const mk=(extra="")=>as(U.b,`insert into proposal_links(bid_id,lang,content,total,valid_until${extra?","+extra.split("=")[0]:""}) values ('${B}','en','{"title":"X","lines":[{"description":"Paint","amount":100}]}',100,current_date + 30${extra?","+extra.split("=")[1]:""}) returning id, token, status, created_by`);
const r=await mk(); const L=r.rows?.[0];
ok("staff creates link", L && L.token.length===64 && /^[0-9a-f]+$/.test(L.token) && L.status==="sent" && L.created_by===U.b);
ok("staff can't choose token", !!(await mk("token='aaa'")).error);
ok("staff can't create accepted", !!(await mk("status='accepted'")).error);
ok("staff can't fake decision", !!(await as(U.b,`update proposal_links set status='accepted' where id='${L.id}'`)).error);
ok("staff can't fake signer", !!(await as(U.b,`update proposal_links set signer_name='X' where id='${L.id}'`)).error);
ok("sub sees nothing", (await as(U.x,"select * from proposal_links")).rows?.length===0);
ok("sub can't create", !!(await as(U.x,`insert into proposal_links(bid_id,lang,content,valid_until) values ('${B}','en','{}',current_date)`)).error);
ok("anon can't read table", !!(await anon("select * from proposal_links")).error);
ok("anon can't read bids", !!(await anon("select * from bids")).error || (await anon("select * from bids")).rows?.length===0);
const view=await anon(`select public_proposal('${L.token}') j`);
ok("anon reads by token", view.rows?.[0]?.j?.content?.title==="X" && view.rows[0].j.status==="sent" && view.rows[0].j.expired===false);
ok("public view hides internals", !JSON.stringify(view.rows[0].j).match(/bid_id|token|created_by|decision_ip/));
ok("wrong token null", (await anon(`select public_proposal('${"0".repeat(64)}') j`)).rows?.[0]?.j===null);
ok("short token null", (await anon(`select public_proposal('abc') j`)).rows?.[0]?.j===null);
await anon(`select public_proposal('${L.token}')`);
const vc=(await db.query(`select view_count, first_viewed_at from proposal_links where id='${L.id}'`)).rows[0];
ok("views counted", vc.view_count===2 && vc.first_viewed_at!==null);
await anon(`select public_proposal('${L.token}', true)`);
ok("preview doesn't count", (await db.query(`select view_count from proposal_links where id='${L.id}'`)).rows[0].view_count===2);
ok("accept needs name", /name_required/.test((await anon(`select public_proposal_decide('${L.token}', true, ' ', null, null)`)).error||""));
ok("bad email rejected", /invalid_email/.test((await anon(`select public_proposal_decide('${L.token}', true, 'Ana Cliente', 'nope', null)`)).error||""));
await db.exec(`select set_config('request.headers','{"x-forwarded-for":"203.0.113.9, 10.0.0.1","user-agent":"Safari test"}', false)`);
const acc=await anon(`select public_proposal_decide('${L.token}', true, 'Ana Cliente', 'ANA@Client.com', 'Looks good') j`);
ok("anon accepts", acc.rows?.[0]?.j?.status==="accepted");
const row=(await db.query(`select status, signer_name, signer_email, decision_ip, decision_user_agent, decided_at from proposal_links where id='${L.id}'`)).rows[0];
ok("decision recorded", row.status==="accepted" && row.signer_name==="Ana Cliente" && row.signer_email==="ana@client.com" && row.decision_ip==="203.0.113.9" && row.decision_user_agent==="Safari test" && row.decided_at);
ok("bid marked won", (await db.query(`select status from bids where id='${B}'`)).rows[0].status==="won");
ok("can't decide twice", /not_open/.test((await anon(`select public_proposal_decide('${L.token}', false, null, null, null)`)).error||""));
ok("staff can't withdraw accepted", !!(await as(U.b,`update proposal_links set status='withdrawn' where id='${L.id}'`)).error);
const L2=(await mk()).rows[0]; const L3=(await mk()).rows[0];
ok("new link withdraws previous open", (await db.query(`select status from proposal_links where id='${L2.id}'`)).rows[0].status==="withdrawn" && (await db.query(`select status from proposal_links where id='${L.id}'`)).rows[0].status==="accepted");
ok("withdrawn can't be decided", /not_open/.test((await anon(`select public_proposal_decide('${L2.token}', true, 'Ana', null, null)`)).error||""));
ok("staff withdraws open", !(await as(U.b,`update proposal_links set status='withdrawn' where id='${L3.id}'`)).error);
const L4=(await as(U.b,`insert into proposal_links(bid_id,lang,content,valid_until) values ('${B}','es','{}',current_date - 3) returning token`)).rows[0];
ok("expired flagged", (await anon(`select public_proposal('${L4.token}') j`)).rows[0].j.expired===true);
ok("expired can't be decided", /expired/.test((await anon(`select public_proposal_decide('${L4.token}', true, 'Ana', null, null)`)).error||""));
const L5=(await mk()).rows[0];
const rej=await anon(`select public_proposal_decide('${L5.token}', false, null, null, 'Too high') j`);
ok("anon rejects without name", rej.rows?.[0]?.j?.status==="rejected");
ok("note too long rejected", /too_long/.test((await (async()=>{const L6=(await mk()).rows[0]; return anon(`select public_proposal_decide('${L6.token}', false, null, null, '${"x".repeat(2001)}')`)})()).error||""));
ok("anon can't call supersede", !!(await anon("select public.proposal_links_supersede()")).error);
await db.exec(`delete from bids where id='${B}'`);
ok("bid delete cascades links", (await db.query("select count(*)::int n from proposal_links")).rows[0].n===0);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
