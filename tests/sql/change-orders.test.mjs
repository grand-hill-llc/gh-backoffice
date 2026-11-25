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
for (const f of ["0001_foundations.sql","0002_projects.sql","0003_leads.sql","0004_convert_lead.sql","0005_subcontractor_portal.sql","0006_email_alerts.sql","0007_settings.sql"]) await db.exec(readFileSync(M+f,"utf8").replace(/create extension[^;]+;/g,""));
await db.exec(`
insert into subcontractors(id,company_name) values ('10000000-0000-0000-0000-000000000001','X Co');
insert into profiles(id,email,role) values ('${U.a}','AdrianGerig@gmail.com','super_admin'),('${U.b}','b@t.co','admin') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=null;
insert into profiles(id,email,role,subcontractor_id) values ('${U.x}','x@t.co','subcontractor','10000000-0000-0000-0000-000000000001') on conflict (id) do update set email=excluded.email, role=excluded.role, subcontractor_id=excluded.subcontractor_id;`);

await db.exec(readFileSync(M+"0008_change_orders.sql","utf8"));
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const S2="10000000-0000-0000-0000-000000000002";
await db.exec(`
insert into subcontractors(id,company_name) values ('${S2}','Y Co');
insert into projects(id,name,contract_amount,budgeted_cost) values ('30000000-0000-0000-0000-000000000001','Obra',100000,70000),('30000000-0000-0000-0000-000000000002','Otra',5000,3000);
insert into project_subs(id,project_id,subcontractor_id,trade,agreed_amount) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Pintura',20000),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','${S2}','Stucco',9000),
 ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Pisos',1000);`);
const P1="30000000-0000-0000-0000-000000000001", P2="30000000-0000-0000-0000-000000000002", A1="40000000-0000-0000-0000-000000000001", A2="40000000-0000-0000-0000-000000000002", A3="40000000-0000-0000-0000-000000000003";
const ins=(vals)=>as(U.a,`insert into change_orders(project_id,number,title,contract_delta,cost_delta,project_sub_id,sub_delta) values ${vals} returning number`);
const r1=await ins(`('${P1}',0,'Cerca',5000,3000,'${A1}',2500)`);
const r2=await ins(`('${P1}',99,'Crédito',-1000,-800,null,null)`);
const r3=await ins(`('${P2}',0,'Otra obra',100,0,null,null)`);
ok("numbers per project", r1.rows?.[0]?.number===1 && r2.rows?.[0]?.number===2 && r3.rows?.[0]?.number===1);
ok("number can't be edited", (await as(U.a,`update change_orders set number=50 where project_id='${P1}' and number=1 returning number`)).rows?.[0]?.number===1);
ok("project can't be moved", (await as(U.a,`update change_orders set project_id='${P2}' where project_id='${P1}' and number=1 returning project_id`)).rows?.[0]?.project_id===P1);
ok("assignment from other project rejected", /no pertenece/.test((await ins(`('${P1}',0,'X',1,0,'${A3}',1)`)).error||""));
ok("sub without amount rejected", !!(await ins(`('${P1}',0,'X',1,0,'${A1}',null)`)).error);
ok("amount without sub rejected", !!(await ins(`('${P1}',0,'X',1,0,null,5)`)).error);
ok("all zero rejected", !!(await ins(`('${P1}',0,'X',0,0,null,null)`)).error);
ok("empty title rejected", !!(await ins(`('${P1}',0,'  ',1,0,null,null)`)).error);
ok("approved needs date", !!(await as(U.a,`update change_orders set status='approved' where project_id='${P1}' and number=1`)).error);
ok("pending can't have date", !!(await as(U.a,`update change_orders set decided_on=current_date where project_id='${P1}' and number=1`)).error);
ok("admin approves", !(await as(U.b,`update change_orders set status='approved', decided_on=current_date where project_id='${P1}' and number=1`)).error);
ok("sub reads nothing", (await as(U.x,"select * from change_orders")).rows?.length===0);
ok("sub can't insert", !!(await as(U.x,`insert into change_orders(project_id,number,title,contract_delta) values ('${P1}',0,'hack',1)`)).error);
await db.exec("set role anon"); let e=""; try{await db.query("select * from change_orders")}catch(x){e=x.message}; await db.exec("reset role"); ok("anon denied", !!e);
ok("assignment with orders can't be removed", /change_orders/.test((await as(U.a,`delete from project_subs where id='${A1}'`)).error||""));
const portal=await as(U.x,"select portal_assignments() j");
const jobs=portal.rows?.[0]?.j ?? [];
const j1=jobs.find(j=>j.id===A1), j3=jobs.find(j=>j.id===A3);
ok("portal current amount", Number(j1?.agreed_amount)===22500 && Number(j1?.base_amount)===20000);
ok("portal lists own approved change", j1?.change_orders?.length===1 && j1.change_orders[0].title==="Cerca" && Number(j1.change_orders[0].amount)===2500);
const txt=JSON.stringify(jobs);
ok("portal hides contract/cost/other sub/credit", !/5000|3000|Crédito|Stucco|9000/.test(txt.replace(/"amount":2500|"agreed_amount":22500|"base_amount":20000/g,"")));
ok("portal unaffected job", Number(j3?.agreed_amount)===1000 && j3?.change_orders?.length===0);
await as(U.a,`insert into change_orders(project_id,number,title,contract_delta,project_sub_id,sub_delta) values ('${P1}',0,'Pendiente',1,'${A1}',700)`);
ok("pending not in portal", Number((await as(U.x,"select portal_assignments() j")).rows[0].j.find(j=>j.id===A1).agreed_amount)===22500);
await db.exec(`delete from projects where id='${P2}'`);
ok("project delete cascades orders", (await db.query(`select count(*)::int n from change_orders where project_id='${P2}'`)).rows[0].n===0);

// ---- 0009: who decided
await db.exec(`insert into change_orders(project_id,number,title,contract_delta,status,decided_on) values ('${P1}',0,'Previa',10,'rejected',current_date - 2)`);
await db.exec(readFileSync(M+"0009_change_order_decisions.sql","utf8"));
const prev=(await db.query(`select decided_by, decided_at::date::text d, (current_date-2)::text e from change_orders where title='Previa'`)).rows[0];
ok("backfill keeps date, no person", prev.decided_by===null && prev.d===prev.e);
const cur=(await db.query(`select decided_at from change_orders where title='Cerca'`)).rows[0];
ok("backfill approved earlier", cur.decided_at!==null);
await as(U.a,`insert into change_orders(project_id,number,title,contract_delta) values ('${P1}',0,'Nueva',100)`);
const ap=await as(U.b,`update change_orders set status='approved', decided_on=current_date, decided_by='${U.a}' where title='Nueva' returning decided_by, decided_at`);
ok("decided_by is the signed-in user (not forgeable)", ap.rows?.[0]?.decided_by===U.b && ap.rows[0].decided_at!==null);
const ed=await as(U.a,`update change_orders set title='Nueva 2' where title='Nueva' returning decided_by`);
ok("editing keeps who decided", ed.rows?.[0]?.decided_by===U.b);
const re=await as(U.a,`update change_orders set status='pending', decided_on=null where title='Nueva 2' returning decided_by, decided_at`);
ok("back to pending clears who and when", re.rows?.[0]?.decided_by===null && re.rows[0].decided_at===null);
const rj=await as(U.a,`update change_orders set status='rejected', decided_on=current_date where title='Nueva 2' returning decided_by`);
ok("reject records person", rj.rows?.[0]?.decided_by===U.a);
const fake=await as(U.a,`update change_orders set decided_at='2000-01-01' where title='Nueva 2' returning decided_at::date::text d`);
ok("decided_at not forgeable", fake.rows?.[0]?.d!=="2000-01-01");
ok("numbering still works", (await as(U.a,`insert into change_orders(project_id,number,title,contract_delta) values ('${P1}',0,'Otra',1) returning number`)).rows?.[0]?.number>=5);
ok("portal still works", Number((await as(U.x,"select portal_assignments() j")).rows[0].j.find(j=>j.id===A1).agreed_amount)===22500);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
