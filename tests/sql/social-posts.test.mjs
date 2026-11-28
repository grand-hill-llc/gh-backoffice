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
let pass=0,fail=0; const ok=(l,c)=>{if(c)pass++;else{fail++;console.log("FAIL",l)}};
async function as(uid,sql){ await db.exec(`set test.uid='${uid}'; set role authenticated;`); try{return {rows:(await db.query(sql)).rows}}catch(e){return {error:e.message}} finally{await db.exec("reset role;")} }
const A=U.a,B=U.b,X=U.x;
const when="now() + interval '3 days'";
const setApproval=(on)=>db.exec(`update app_settings set posts_require_approval=${on}`);
const status=async(id)=>(await db.query(`select status from social_posts where id='${id}'`)).rows[0]?.status;

// access
ok("approval off by default", (await db.query("select posts_require_approval v from app_settings")).rows[0].v===false);
const d=await as(B,"insert into social_posts(title) values ('Idea') returning id, created_by, status");
ok("admin creates a draft", d.rows?.[0]?.status==="draft" && d.rows[0].created_by===B);
const draft=d.rows[0].id;
ok("subcontractor sees nothing", (await as(X,"select * from social_posts")).rows?.length===0);
ok("subcontractor can't insert", !!(await as(X,"insert into social_posts(title) values ('x')")).error);
await db.exec("set role anon"); let e=""; try{await db.query("select * from social_posts")}catch(x){e=x.message}; await db.exec("reset role"); ok("anon denied", !!e);
ok("created_by not forgeable", (await as(B,`insert into social_posts(title,created_by) values ('f','${A}') returning created_by`)).rows?.[0]?.created_by===B);

// rules
ok("blank title rejected", !!(await as(B,"insert into social_posts(title) values ('  ')")).error);
ok("unknown network rejected", !!(await as(B,"insert into social_posts(title,channels) values ('t','{tiktok}')")).error);
ok("scheduled needs networks", !!(await as(B,`insert into social_posts(title,status,scheduled_at) values ('t','scheduled',${when})`)).error);
ok("scheduled needs a date", !!(await as(B,"insert into social_posts(title,status,channels) values ('t','scheduled','{facebook}')")).error);
ok("bad url rejected", !!(await as(B,"insert into social_posts(title,status,channels,published_url) values ('t','published','{facebook}','javascript:x')")).error);

// approval off: admin schedules and publishes directly
const s=await as(B,`update social_posts set channels='{facebook,instagram}', body='Hola', status='scheduled', scheduled_at=${when} where id='${draft}' returning status`);
ok("approval off: admin schedules", s.rows?.[0]?.status==="scheduled");
const p=await as(B,`update social_posts set status='published', published_url='https://facebook.com/p/1' where id='${draft}' returning published_at, published_url`);
ok("published stamps the date", !!p.rows?.[0]?.published_at && p.rows[0].published_url==="https://facebook.com/p/1");
const back=await as(B,`update social_posts set status='draft' where id='${draft}' returning published_at, published_url`);
ok("leaving published clears date and url", back.rows?.[0]?.published_at===null && back.rows[0].published_url===null);

// approval on
await setApproval(true);
const q=await as(B,`insert into social_posts(title,channels,status,scheduled_at) values ('Q','{instagram}','scheduled',${when}) returning id,status`);
ok("approval on: admin's schedule waits", q.rows?.[0]?.status==="pending");
const pend=q.rows[0].id;
ok("approval on: admin can't publish unapproved", !!(await as(B,`update social_posts set status='published' where id='${pend}'`)).error);
ok("approval on: admin can't fake a review", (await as(B,`update social_posts set reviewed_by='${A}', review_note='ok' where id='${pend}' returning reviewed_by, review_note`)).rows?.[0]?.reviewed_by===null);
const rej=await as(A,`update social_posts set status='draft', review_note='Cambia la foto' where id='${pend}' returning status, reviewed_by, review_note`);
ok("super admin sends it back with a note", rej.rows?.[0]?.status==="draft" && rej.rows[0].reviewed_by===A && rej.rows[0].review_note==="Cambia la foto");
await as(B,`update social_posts set status='scheduled' where id='${pend}'`);
ok("resubmitted goes to pending", await status(pend)==="pending");
ok("note kept while pending", (await db.query(`select review_note from social_posts where id='${pend}'`)).rows[0].review_note==="Cambia la foto");
const ap=await as(A,`update social_posts set status='scheduled' where id='${pend}' returning status, reviewed_by, reviewed_at, review_note`);
ok("super admin approves", ap.rows?.[0]?.status==="scheduled" && ap.rows[0].reviewed_by===A && !!ap.rows[0].reviewed_at && ap.rows[0].review_note===null);
ok("admin's title edit keeps it approved", (await as(B,`update social_posts set title='Q2' where id='${pend}' returning status`)).rows?.[0]?.status==="scheduled");
ok("admin's caption edit sends it back", (await as(B,`update social_posts set body='otro texto' where id='${pend}' returning status`)).rows?.[0]?.status==="pending");
await as(A,`update social_posts set status='scheduled' where id='${pend}'`);
ok("admin publishes an approved post", (await as(B,`update social_posts set status='published' where id='${pend}' returning status`)).rows?.[0]?.status==="published");
const sa=await as(A,`insert into social_posts(title,channels,status,scheduled_at) values ('S','{facebook}','scheduled',${when}) returning id,status`);
ok("super admin schedules directly", sa.rows?.[0]?.status==="scheduled");
const sched=sa.rows[0].id;

// media
const okMedia=await as(B,`insert into social_post_media(post_id,path,mime_type,size_bytes) values ('${sched}','${sched}/a/foto.jpg','image/jpeg',1000) returning id`);
ok("admin adds media", okMedia.rows?.length===1);
ok("new media on a scheduled post goes back to approval", await status(sched)==="pending");
ok("media path must be inside the post folder", !!(await as(B,`insert into social_post_media(post_id,path,mime_type) values ('${sched}','otro/foto.jpg','image/jpeg')`)).error);
ok("unsupported file type rejected", !!(await as(B,`insert into social_post_media(post_id,path,mime_type) values ('${sched}','${sched}/b/x.gif','image/gif')`)).error);
ok("over 50 MB rejected", !!(await as(B,`insert into social_post_media(post_id,path,mime_type,size_bytes) values ('${sched}','${sched}/c/v.mp4','video/mp4',60000000)`)).error);
ok("subcontractor can't add media", !!(await as(X,`insert into social_post_media(post_id,path,mime_type) values ('${sched}','${sched}/d/x.jpg','image/jpeg')`)).error);
await setApproval(false);
await as(A,`update social_posts set status='scheduled' where id='${sched}'`);
await as(B,`insert into social_post_media(post_id,path,mime_type) values ('${sched}','${sched}/e/y.png','image/png')`);
ok("approval off: media doesn't change status", await status(sched)==="scheduled");
ok("deleting a post deletes its media", (await as(B,`delete from social_posts where id='${sched}' returning id`)).rows?.length===1 && (await db.query(`select count(*)::int n from social_post_media where post_id='${sched}'`)).rows[0].n===0);

await setApproval(true);
const c=(await as(A,`insert into social_posts(title,channels,status,scheduled_at) values ('C','{facebook}','scheduled',${when}) returning id`)).rows[0].id;
await as(A,`insert into social_post_media(post_id,path,mime_type) values ('${c}','${c}/f/z.jpg','image/jpeg')`);
ok("approval on: admin deletes a scheduled post with media", (await as(B,`delete from social_posts where id='${c}' returning id`)).rows?.length===1);
await setApproval(false);

// setting
ok("admin can't change the approval rule", ((await as(B,"update app_settings set posts_require_approval=true returning 1")).rows?.length ?? 0)===0);
ok("super admin changes it", (await as(A,"update app_settings set posts_require_approval=true returning posts_require_approval")).rows?.[0]?.posts_require_approval===true);
ok("bucket is private", (await db.query("select public from storage.buckets where id='social-media'")).rows[0]?.public===false);
console.log(`${pass}/${pass+fail} passed`); process.exit(fail?1:0);
