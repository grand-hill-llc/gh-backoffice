// Proposal email (supabase/functions/send-proposal/email.ts): request checks and the email itself.
import { buildProposalEmail, parseSendRequest } from "../../supabase/functions/send-proposal/email.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };

const LINK = "8f2b6a52-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const REQ = "1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const base = { link_id: LINK, request_id: REQ, to: " Ana@Client.com ", message: "Hola Ana,\r\n\r\nAquí va." };

const r = parseSendRequest(base);
ok("valid request", !("error" in r) && r.to === "ana@client.com" && r.cc.length === 0 && r.message === "Hola Ana,\n\nAquí va.");
ok("not an object", "error" in parseSendRequest(null));
ok("bad link id", (parseSendRequest({ ...base, link_id: "1; drop" }) as { error: string }).error === "bad_request");
ok("missing request id", (parseSendRequest({ ...base, request_id: undefined }) as { error: string }).error === "bad_request");
ok("bad to", (parseSendRequest({ ...base, to: "ana" }) as { error: string }).error === "invalid_email");
ok("header injection to", (parseSendRequest({ ...base, to: "a@b.co,c@d.co" }) as { error: string }).error === "invalid_email");
const cc = parseSendRequest({ ...base, cc: "Bob@x.co; carl@x.co, bob@x.co ana@client.com" });
ok("cc string parsed, deduped, without to", !("error" in cc) && JSON.stringify(cc.cc) === JSON.stringify(["bob@x.co", "carl@x.co"]));
ok("cc array", !("error" in (parseSendRequest({ ...base, cc: ["a@x.co"] }))));
ok("bad cc", (parseSendRequest({ ...base, cc: "a@x.co, nope" }) as { error: string }).error === "invalid_cc");
ok("too many cc", (parseSendRequest({ ...base, cc: "a@x.co b@x.co c@x.co d@x.co e@x.co f@x.co" }) as { error: string }).error === "too_many_cc");
ok("long message", (parseSendRequest({ ...base, message: "x".repeat(4001) }) as { error: string }).error === "message_too_long");
const empty = parseSendRequest({ ...base, message: "   " });
ok("blank message is null", !("error" in empty) && empty.message === null);

const input = {
  lang: "es" as const,
  title: "Pintura <Aldi>\nNarcoossee",
  total: 8998.75,
  validUntil: "2026-12-25",
  url: "https://app.grandhillcorp.com/p/abc",
  message: "Hola <b>Ana</b>,\n\nGracias.\nSaludos",
  company: { address: "Orlando, FL", phone: null, email: "info@grandhillcorp.com" },
};
const es = buildProposalEmail(input);
ok("subject one line", es.subject === "Propuesta de Grand Hill: Pintura <Aldi> Narcoossee");
ok("message escaped", es.html.includes("Hola &lt;b&gt;Ana&lt;/b&gt;,") && !es.html.includes("<b>Ana"));
ok("paragraphs and line breaks", es.html.includes("Gracias.<br>Saludos"));
ok("button with url", es.html.includes('href="https://app.grandhillcorp.com/p/abc"') && es.html.includes("Ver y aceptar la propuesta"));
ok("total and date in es", es.text.includes("$8,998.75") && es.text.includes("25 de diciembre de 2026"));
ok("footer skips blanks", es.text.includes("Grand Hill · Orlando, FL · info@grandhillcorp.com"));
const en = buildProposalEmail({ ...input, lang: "en", total: null, message: null, company: {} });
ok("english copy", en.subject.startsWith("Grand Hill proposal:") && en.html.includes("View and accept the proposal") && en.text.includes("December 25, 2026"));
ok("no total line when null", !en.text.includes("Total"));
ok("no footer when empty", !en.text.includes("Grand Hill ·"));
ok("date not shifted by timezone", buildProposalEmail({ ...input, validUntil: "2027-01-01" }).text.includes("1 de enero de 2027"));

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
