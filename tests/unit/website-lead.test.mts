// Website form → lead (supabase/functions/website-lead/submission.ts): Netlify's signature and the mapping.
import { createHash, createHmac } from "node:crypto";
import { leadFromSubmission, verifyNetlifySignature } from "../../supabase/functions/website-lead/submission.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** A JWS like the one Netlify sends: HS256 over { iss, sha256(body) }. */
function sign(body: string, secret: string, claims: Record<string, unknown> = {}, alg = "HS256") {
  const header = b64url(JSON.stringify({ alg, typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: "netlify", sha256: createHash("sha256").update(body).digest("hex"), ...claims }));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

const SECRET = "test-secret";
const body = JSON.stringify({ form_name: "quote", data: { name: "Ana Torres", email: "ANA@Example.com", phone: "407 555 0101", service: "Exterior painting", details: "Two buildings.\nStucco repairs.", location: "Lake Mary" } });

ok("valid signature", await verifyNetlifySignature(sign(body, SECRET), body, SECRET));
ok("wrong secret", !(await verifyNetlifySignature(sign(body, "other"), body, SECRET)));
ok("body changed", !(await verifyNetlifySignature(sign(body, SECRET), body + " ", SECRET)));
ok("wrong issuer", !(await verifyNetlifySignature(sign(body, SECRET, { iss: "someone" }), body, SECRET)));
ok("alg none refused", !(await verifyNetlifySignature(sign(body, SECRET, {}, "none"), body, SECRET)));
ok("missing token", !(await verifyNetlifySignature(null, body, SECRET)));
ok("empty secret", !(await verifyNetlifySignature(sign(body, ""), body, "")));
ok("garbage token", !(await verifyNetlifySignature("a.b.c", body, SECRET)));
ok("two parts", !(await verifyNetlifySignature("a.b", body, SECRET)));

const lead = leadFromSubmission(JSON.parse(body));
ok("maps name", lead?.name === "Ana Torres");
ok("lowercases email", lead?.email === "ana@example.com");
ok("keeps phone and location", lead?.phone === "407 555 0101" && lead?.location === "Lake Mary");
ok("interest = service + details", lead?.interest?.startsWith("Exterior painting. Two buildings."));
ok("message for history", lead?.message.startsWith("Solicitud desde el sitio web (Exterior painting):") && lead.message.includes("Stucco repairs."));
ok("other form ignored", leadFromSubmission({ form_name: "newsletter", data: { name: "X" } }) === null);
ok("no name ignored", leadFromSubmission({ form_name: "quote", data: { email: "a@b.co" } }) === null);
ok("invalid email dropped", leadFromSubmission({ form_name: "quote", data: { name: "X", email: "nope" } })?.email === null);
ok("flat payload accepted", leadFromSubmission({ name: "Flat", email: "f@x.co" })?.name === "Flat");
ok("long name cut", (leadFromSubmission({ form_name: "quote", data: { name: "x".repeat(500) } })?.name.length ?? 0) === 200);
ok("no service", leadFromSubmission({ form_name: "quote", data: { name: "N" } })?.message.startsWith("Solicitud desde el sitio web:"));
ok("note in English", leadFromSubmission(JSON.parse(body), "quote", "en")?.message.startsWith("Request from the website (Exterior painting):"));
ok("note defaults to Spanish", leadFromSubmission(JSON.parse(body))?.message.startsWith("Solicitud desde el sitio web"));

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
