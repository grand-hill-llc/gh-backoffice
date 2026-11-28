// Pure logic for the website-lead function: verifying Netlify's signature and turning a
// form submission into a lead. No Supabase or Deno APIs here, so it can be tested on its own.

const enc = new TextEncoder();

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison so the signature can't be guessed byte by byte. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Netlify signs outgoing webhooks with a JWS (HS256) in the X-Webhook-Signature header.
 * Its payload is { iss: "netlify", sha256: <hex sha256 of the raw body> }.
 * Valid only if the HMAC matches our secret AND the hash matches the body we received.
 */
export async function verifyNetlifySignature(token: string | null, rawBody: string, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [header, payload, signature] = parts;

  try {
    const head = JSON.parse(new TextDecoder().decode(base64UrlToBytes(header)));
    if (head.alg !== "HS256") return false;

    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${header}.${payload}`)));
    if (!sameBytes(expected, base64UrlToBytes(signature))) return false;

    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (claims.iss !== "netlify") return false;
    const bodyHash = bytesToHex(await crypto.subtle.digest("SHA-256", enc.encode(rawBody)));
    return typeof claims.sha256 === "string" && claims.sha256.toLowerCase() === bodyHash;
  } catch {
    return false;
  }
}

export type LeadInput = {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  interest: string | null;
  /** Full message for the lead's activity history. */
  message: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v: unknown, max = 2000) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+\n/g, "\n") : "";
  return s ? s.slice(0, max) : null;
};

/**
 * Maps a Netlify form submission (the "quote" form on grandhillcorp.com) to a lead.
 * Returns null when it isn't that form or lacks a name, so stray submissions are ignored.
 */
/** The note left in the lead's history, in the team's language (Configuración). */
const NOTE = {
  es: (service: string | null) => `Solicitud desde el sitio web${service ? ` (${service})` : ""}:`,
  en: (service: string | null) => `Request from the website${service ? ` (${service})` : ""}:`,
};

export function leadFromSubmission(body: unknown, formName = "quote", lang: "es" | "en" = "es"): LeadInput | null {
  const sub = (body ?? {}) as { form_name?: string; data?: Record<string, unknown> } & Record<string, unknown>;
  if (sub.form_name && sub.form_name !== formName) return null;
  const data = (sub.data ?? sub) as Record<string, unknown>;

  const name = clean(data.name, 200);
  if (!name) return null;
  const emailRaw = clean(data.email, 320)?.toLowerCase() ?? null;
  const email = emailRaw && EMAIL_RE.test(emailRaw) ? emailRaw : null;
  const service = clean(data.service, 200);
  const details = clean(data.details, 4000);

  const interest = [service, details].filter(Boolean).join(". ").slice(0, 1000) || null;
  const message = [NOTE[lang === "en" ? "en" : "es"](service), details ?? "—"].join("\n");

  return { name, email, phone: clean(data.phone, 50), location: clean(data.location, 200), interest, message };
}

