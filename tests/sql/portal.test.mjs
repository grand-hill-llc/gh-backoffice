import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const M=fileURLToPath(new URL("../../supabase/migrations/", import.meta.url));
const db=new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth; create schema storage;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
grant usage on schema auth, storage, public to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
create function storage.extension(name text) returns text language sql immutable as $$ select reverse(split_part(reverse(name),'.',1)) $$;
grant execute on all functions in schema storage to authenticated;
alter table storage.objects enable row level security; grant select,insert,update,delete on storage.objects to authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
for (const f of ["0001_foundations.sql","0002_projects.sql","0003_leads.sql","0004_convert_lead.sql","0005_subcontractor_portal.sql"]) await db.exec(readFileSync(M+f,"utf8"));
const U={a:"00000000-0000-0000-0000-00000000000a",x:"00000000-0000-0000-0000-000000000001",y:"00000000-0000-0000-0000-000000000002"};
const S={x:"10000000-0000-0000-0000-000000000001",y:"10000000-0000-0000-0000-000000000002"};
await db.exec(`
insert into auth.users values ('${U.a}','a@t.co'),('${U.x}','x@t.co'),('${U.y}','y@t.co');
insert into subcontractors(id,company_name,notes) values ('${S.x}','X Co','SECRET-X'),('${S.y}','Y Co','SECRET-Y');
insert into profiles(id,email,role) values ('${U.a}','a@t.co','super_admin');
insert into profiles(id,email,role,subcontractor_id) values ('${U.x}','x@t.co','subcontractor','${S.x}'),('${U.y}','y@t.co','subcontractor','${S.y}');
insert into subcontractor_documents(subcontractor_id,doc_type,file_path,expires_on,notes) values ('${S.y}','coi','${S.y}/u/y.pdf','2030-01-01','SECRET-DOC');
insert into storage.objects(bucket_id,name) values ('sub-documents','${S.x}/n/ok.pdf'),('sub-documents','${S.y}/u/y.pdf');
insert into clients(id,name) values ('20000000-0000-0000-0000-000000000001','SECRET-CLIENT');
insert into projects(id,name,client_id,contract_amount,budgeted_cost,notes) values ('30000000-0000-0000-0000-000000000001','Obra','20000000-0000-0000-0000-000000000001',99999,77777,'SECRET-PROJECT');
insert into project_subs(id,project_id,subcontractor_id,trade,agreed_amount,notes) values
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','${S.x}','Pintura',1000,'SECRET-A'),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','${S.y}','Stucco',2222,'SECRET-B');
insert into project_movements(project_id,kind,project_sub_id,amount,notes) values
 ('30000000-0000-0000-0000-000000000001','sub_payment','40000000-0000-0000-0000-000000000001',400,'SECRET-M'),
 ('30000000-0000-0000-0000-000000000001','sub_payment','40000000-0000-0000-0000-000000000002',555,null),
 ('30000000-0000-0000-0000-000000000001','receipt',null,88888,null);
`);
let pass=0,fail=0; const ok=(l,c)=>{console.log((c?"PASS  ":"FAIL  ")+l);c?pass++:fail++};
async function as(uid,sql,params=[]){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql,params)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const val=(r)=>r.rows?.[0] && Object.values(r.rows[0])[0];
for (const t of ["subcontractors","subcontractor_documents","v_sub_documents_status","clients","bids","projects","project_subs","project_movements","leads"]) {
  const r=await as(U.x,`select * from ${t}`); ok(`sub reads 0 rows from ${t}`, !r.error && r.rows.length===0);
}
const c=val(await as(U.x,"select portal_company()")); ok("portal_company own", c?.company_name==="X Co"); ok("company has no notes", !JSON.stringify(c).includes("SECRET"));
const j=JSON.stringify(val(await as(U.x,"select portal_assignments()")));
ok("sees own agreed + payment", j.includes("1000")&&j.includes("400"));
ok("no contract/cost/client/other sub/notes/receipts", !/99999|77777|SECRET|2222|555|88888/.test(j));
ok("docs hide other company", JSON.stringify(val(await as(U.x,"select portal_documents()")))==="[]");
await as(U.x,"select portal_update_contact('Ana','ANA@T.CO','407')");
const row=(await db.query(`select contact_name,email,notes,status from subcontractors where id='${S.x}'`)).rows[0];
ok("contact updated, notes/status intact", row.contact_name==="Ana"&&row.email==="ana@t.co"&&row.notes==="SECRET-X"&&row.status==="prospect");
ok("bad email rejected", /invalid_email/.test((await as(U.x,"select portal_update_contact('A','nope','1')")).error||""));
ok("direct update blocked", (await as(U.x,`update subcontractors set status='active' where id='${S.x}' returning id`)).rows?.length===0);
ok("cannot register other company file", /invalid_file/.test((await as(U.x,`select portal_submit_document('coi','${S.y}/u/y.pdf','2026-01-01','2030-01-01')`)).error||""));
ok("cannot register nonexistent file", /invalid_file/.test((await as(U.x,`select portal_submit_document('coi','${S.x}/n/no.pdf','2026-01-01','2030-01-01')`)).error||""));
ok("COI needs expiry", /expiry_required/.test((await as(U.x,`select portal_submit_document('coi','${S.x}/n/ok.pdf',null,null)`)).error||""));
ok("expired rejected", /already_expired/.test((await as(U.x,`select portal_submit_document('coi','${S.x}/n/ok.pdf',null,'2020-01-01')`)).error||""));
const sub=await as(U.x,`select portal_submit_document('coi','${S.x}/n/ok.pdf','2026-01-01','2030-01-01')`); ok("valid submit", !sub.error);
ok("pending not counted in compliance", (await db.query(`select 1 from v_sub_documents_status where subcontractor_id='${S.x}'`)).rows.length===0);
await db.exec(`insert into storage.objects(bucket_id,name) values ('sub-documents','${S.x}/n/2.pdf')`);
ok("one pending per type", /already_pending/.test((await as(U.x,`select portal_submit_document('coi','${S.x}/n/2.pdf',null,'2030-01-01')`)).error||""));
await as(U.a,`update subcontractor_documents set review_status='approved' where subcontractor_id='${S.x}'`);
ok("approved counts in compliance", (await db.query(`select 1 from v_sub_documents_status where subcontractor_id='${S.x}'`)).rows.length===1);
const files=await as(U.x,"select name from storage.objects"); ok("storage: only own folder", files.rows?.length>0&&files.rows.every(r=>r.name.startsWith(S.x)));
ok("storage: insert own pdf", !(await as(U.x,`insert into storage.objects(bucket_id,name) values ('sub-documents','${S.x}/z/a.pdf')`)).error);
ok("storage: other folder blocked", !!(await as(U.x,`insert into storage.objects(bucket_id,name) values ('sub-documents','${S.y}/z/a.pdf')`)).error);
ok("storage: html blocked", !!(await as(U.x,`insert into storage.objects(bucket_id,name) values ('sub-documents','${S.x}/z/a.html')`)).error);
ok("storage: delete does nothing", (await as(U.x,`delete from storage.objects where name like '${S.x}%' returning name`)).rows?.length===0);
ok("staff can't use portal", /not_allowed/.test((await as(U.a,"select portal_company()")).error||""));
ok("helper not callable", /permission denied/.test((await as(U.x,"select portal_sub_id()")).error||""));
await db.exec("set role anon;"); let e=""; try{await db.query("select portal_company()")}catch(x){e=x.message}; await db.exec("reset role;"); ok("anon denied", /permission denied/.test(e));
// Staff edit a document (DocumentsSection): type, dates, notes and file.
const D=(await db.query(`select id from subcontractor_documents where subcontractor_id='${S.x}' and doc_type='coi' limit 1`)).rows[0].id;
ok("staff edits document", (await as(U.a,`update subcontractor_documents set expires_on='2031-06-30', issued_on='2026-02-01', notes='Póliza GL-9', file_path='${S.x}/n/2.pdf' where id='${D}' returning id`)).rows?.length===1);
ok("edit keeps dates consistent", !!(await as(U.a,`update subcontractor_documents set issued_on='2032-01-01' where id='${D}'`)).error);
ok("sub can't edit document", (await as(U.x,`update subcontractor_documents set expires_on='2040-01-01' where id='${D}' returning id`)).rows?.length===0);
await db.exec(`insert into subcontractor_documents(subcontractor_id,doc_type,file_path,review_status) values ('${S.x}','w9','${S.x}/n/w9.pdf','pending'),('${S.x}','license','${S.x}/n/l.pdf','pending')`);
const L=(await db.query(`select id from subcontractor_documents where doc_type='license' and subcontractor_id='${S.x}'`)).rows[0].id;
ok("type change can collide with a pending one", /subcontractor_documents_one_pending/.test((await as(U.a,`update subcontractor_documents set doc_type='w9' where id='${L}'`)).error||""));
ok("staff still reads all subs", (await as(U.a,"select id from subcontractors")).rows?.length===2);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
