// Pure logic of the send-proposal function: check the request and build the email.
// No Deno or network here, so the tests run it in Node.

export const MAX_CC = 5;
export const MAX_MESSAGE = 4000;
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SendRequest = { linkId: string; to: string; cc: string[]; message: string | null; requestId: string };
export type RequestError = "bad_request" | "invalid_email" | "invalid_cc" | "too_many_cc" | "message_too_long";

const cleanEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Validates the browser's request. cc may be a list or a comma/semicolon separated string. */
export function parseSendRequest(body: unknown): SendRequest | { error: RequestError } {
  if (!body || typeof body !== "object") return { error: "bad_request" };
  const b = body as Record<string, unknown>;
  const linkId = String(b.link_id ?? "");
  const requestId = String(b.request_id ?? "");
  if (!UUID_RE.test(linkId) || !UUID_RE.test(requestId)) return { error: "bad_request" };

  const to = cleanEmail(b.to);
  if (!EMAIL_RE.test(to) || to.length > 320) return { error: "invalid_email" };

  const rawCc = Array.isArray(b.cc) ? b.cc : String(b.cc ?? "").split(/[,;\s]+/);
  const cc = [...new Set(rawCc.map(cleanEmail).filter(Boolean))].filter((e) => e !== to);
  if (cc.some((e) => !EMAIL_RE.test(e) || e.length > 320)) return { error: "invalid_cc" };
  if (cc.length > MAX_CC) return { error: "too_many_cc" };

  const message = String(b.message ?? "").replace(/\r\n/g, "\n").trim();
  if (message.length > MAX_MESSAGE) return { error: "message_too_long" };
  return { linkId, to, cc, message: message || null, requestId };
}

export type ProposalEmailInput = {
  lang: "es" | "en";
  /** Project title from the proposal snapshot. */
  title: string;
  total: number | null;
  validUntil: string; // YYYY-MM-DD
  url: string;
  message: string | null;
  company: { address?: string | null; phone?: string | null; email?: string | null };
};

const COPY = {
  es: {
    subject: (title: string) => `Propuesta de Grand Hill: ${title}`,
    button: "Ver y aceptar la propuesta",
    total: "Total",
    validUntil: "Válida hasta",
    fallback: "Si el botón no funciona, copie este enlace en su navegador:",
    locale: "es-US",
  },
  en: {
    subject: (title: string) => `Grand Hill proposal: ${title}`,
    button: "View and accept the proposal",
    total: "Total",
    validUntil: "Valid until",
    fallback: "If the button doesn't work, paste this link into your browser:",
    locale: "en-US",
  },
};

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function buildProposalEmail(p: ProposalEmailInput): { subject: string; html: string; text: string } {
  const c = COPY[p.lang];
  const money = p.total === null ? null : new Intl.NumberFormat(c.locale, { style: "currency", currency: "USD" }).format(p.total);
  const date = new Intl.DateTimeFormat(c.locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${p.validUntil}T00:00:00Z`),
  );
  const facts = [money ? `${c.total}: ${money}` : null, `${c.validUntil}: ${date}`].filter(Boolean) as string[];
  const footer = [p.company.address, p.company.phone, p.company.email].map((v) => v?.trim()).filter(Boolean) as string[];
  const subject = oneLine(c.subject(p.title)).slice(0, 200);

  const paragraphs = (p.message ?? "")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p style="margin:0 0 16px">${esc(para).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f3f0;font-family:Helvetica,Arial,sans-serif;color:#1f2328">
<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:32px;border:1px solid #e3e1dc">
<p style="margin:0 0 24px;font-size:13px;letter-spacing:2px;font-weight:bold">GRAND HILL</p>
<div style="font-size:15px;line-height:1.55">${paragraphs}</div>
<p style="margin:8px 0 24px"><a href="${esc(p.url)}" style="display:inline-block;background:#1f2328;color:#ffffff;text-decoration:none;padding:12px 20px;font-size:14px;font-weight:bold">${esc(c.button)}</a></p>
<p style="margin:0 0 24px;font-size:14px;color:#55595f">${facts.map(esc).join(" &middot; ")}</p>
<p style="margin:0;font-size:12px;color:#7a7e84">${esc(c.fallback)}<br><a href="${esc(p.url)}" style="color:#7a7e84;word-break:break-all">${esc(p.url)}</a></p>
</div>
${footer.length ? `<p style="max-width:560px;margin:16px auto 0;font-size:12px;color:#7a7e84;text-align:center">Grand Hill &middot; ${footer.map(esc).join(" &middot; ")}</p>` : ""}
</body></html>`;

  const text = [p.message ?? "", `${c.button}: ${p.url}`, facts.join(" · "), footer.length ? `Grand Hill · ${footer.join(" · ")}` : ""]
    .filter(Boolean)
    .join("\n\n");

  return { subject, html, text };
}
