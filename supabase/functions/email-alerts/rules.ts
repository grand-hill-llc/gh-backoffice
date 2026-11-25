// Pure logic for the email-alerts function: what is due, for whom, and how it reads.
// No Supabase or Deno APIs here, so it can be tested on its own.

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: "super_admin" | "admin" | "subcontractor";
  subcontractor_id: string | null;
};

export type Doc = {
  id: string;
  subcontractor_id: string;
  company_name: string;
  sub_status: string;
  doc_type: string;
  expires_on: string | null;
  review_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  reviewed_at: string | null;
};

export type Lead = {
  id: string;
  name: string;
  company: string | null;
  status: string;
  owner_id: string | null;
  next_follow_up: string | null;
};

/** A change order with what the emails need: its project and, if it changes a sub's amount, that assignment. */
export type ChangeOrderRow = {
  id: string;
  project_id: string;
  project_name: string;
  number: number;
  title: string;
  status: "pending" | "approved" | "rejected";
  contract_delta: number;
  sub_delta: number | null;
  requested_on: string;
  decided_at: string | null;
  /** The assignment's company, when the order changes a sub's agreed amount. */
  subcontractor_id: string | null;
  /** That assignment's agreed amount including every approved change order. */
  current_agreed: number | null;
};

/** A client's answer to a proposal link (0013). */
export type ProposalDecision = {
  id: string;
  bid_id: string;
  bid_title: string;
  client_name: string | null;
  status: "accepted" | "rejected";
  decided_at: string;
  signer_name: string | null;
  signer_email: string | null;
  client_note: string | null;
  total: number | null;
  /** Staff profile who created the link. */
  created_by: string | null;
};

export type Email = { key: string; kind: "digest" | "reminder" | "review" | "change" | "proposal"; to: string; subject: string; html: string; text: string };

export type PlanInput = {
  profiles: Profile[];
  docs: Doc[];
  leads: Lead[];
  now: Date;
  appUrl: string;
  settings: AlertSettings;
  changeOrders?: ChangeOrderRow[];
  proposals?: ProposalDecision[];
  /** Ignores the morning window (dry runs and previews). */
  force?: boolean;
};

/** Edited by super admins in Configuración (public.app_settings). */
export type AlertSettings = {
  digestEnabled: boolean;
  /** Florida hour the morning window opens (6–11). */
  digestHour: number;
  /** Staff profile ids that don't get the digest. */
  digestMuted: string[];
  /** Days before expiry to remind, e.g. [30, 15, 7]. */
  expiryDays: number[];
  subsEnabled: boolean;
  /** Language of the emails to the team (digest, proposal answers). Subcontractor emails are always bilingual. */
  staffLang: StaffLang;
};

export type StaffLang = "es" | "en";

export const DEFAULT_SETTINGS: AlertSettings = {
  digestEnabled: true,
  digestHour: 8,
  digestMuted: [],
  expiryDays: [30, 15, 7],
  subsEnabled: false,
  staffLang: "es",
};

export const cleanLang = (v: unknown): StaffLang => (v === "en" ? "en" : "es");

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Wording of the emails to the team, in the language chosen in Configuración. */
const STAFF = {
  es: {
    locale: "es-US" as const,
    digestSubject: (n: number) => `Grand Hill · ${n} ${plural(n, "pendiente", "pendientes")} de hoy`,
    hello: (name: string | null) => (name ? `Hola ${name}, esto requiere atención` : "Esto requiere atención"),
    openDashboard: "Abrir el resumen",
    toApprove: "Órdenes de cambio por aprobar",
    toClient: (amount: string) => `Al cliente ${amount}`,
    requestedToday: "Solicitada hoy",
    waiting: (n: number) => `Pendiente hace ${n} ${plural(n, "día", "días")}`,
    toReview: "Documentos por revisar",
    fromPortal: "Enviado desde el portal",
    expiring: "Documentos vencidos o por vencer",
    expiredAgo: (n: number) => `Vencido hace ${n} ${plural(n, "día", "días")}`,
    expiresToday: "Vence hoy",
    expiresIn: (n: number) => `Vence en ${n} ${plural(n, "día", "días")}`,
    followUps: "Seguimientos de leads",
    dueToday: "Para hoy",
    late: (n: number) => `Atrasado ${n} ${plural(n, "día", "días")}`,
    noOwner: "Sin responsable",
    accepted: "Propuesta aceptada",
    rejected: "Propuesta rechazada",
    theClient: "El cliente",
    forAmount: (amount: string) => ` por ${amount}`,
    acceptedLead: (who: string, bid: string, rest: string) => `${who} aceptó la propuesta de ${bid}${rest}. El bid pasó a Ganado.`,
    rejectedLead: (who: string, bid: string, rest: string) => `${who} rechazó la propuesta de ${bid}${rest}.`,
    email: (v: string) => `Correo: ${v}`,
    comment: (v: string) => `Comentario: ${v}`,
    openBidCreate: "Abrir el bid y crear el proyecto",
    openBid: "Abrir el bid",
  },
  en: {
    locale: "en-US" as const,
    digestSubject: (n: number) => `Grand Hill · ${n} ${plural(n, "item", "items")} for today`,
    hello: (name: string | null) => (name ? `Hi ${name}, this needs attention` : "This needs attention"),
    openDashboard: "Open the overview",
    toApprove: "Change orders to approve",
    toClient: (amount: string) => `To the client ${amount}`,
    requestedToday: "Requested today",
    waiting: (n: number) => `Pending for ${n} ${plural(n, "day", "days")}`,
    toReview: "Documents to review",
    fromPortal: "Sent from the portal",
    expiring: "Expired or expiring documents",
    expiredAgo: (n: number) => `Expired ${n} ${plural(n, "day", "days")} ago`,
    expiresToday: "Expires today",
    expiresIn: (n: number) => `Expires in ${n} ${plural(n, "day", "days")}`,
    followUps: "Lead follow-ups",
    dueToday: "Due today",
    late: (n: number) => `${n} ${plural(n, "day", "days")} late`,
    noOwner: "No owner",
    accepted: "Proposal accepted",
    rejected: "Proposal declined",
    theClient: "The client",
    forAmount: (amount: string) => ` for ${amount}`,
    acceptedLead: (who: string, bid: string, rest: string) => `${who} accepted the proposal for ${bid}${rest}. The bid is now Won.`,
    rejectedLead: (who: string, bid: string, rest: string) => `${who} declined the proposal for ${bid}${rest}.`,
    email: (v: string) => `Email: ${v}`,
    comment: (v: string) => `Comment: ${v}`,
    openBidCreate: "Open the bid and create the project",
    openBid: "Open the bid",
  },
};

const TZ = "America/New_York";
const WINDOW_HOURS = 3; // opens at the chosen hour; later runs only retry what failed
const REVIEW_LOOKBACK_MS = 3 * 86_400_000;
const EXPIRING_TYPES = ["coi", "license"];

const DOC_LABELS: Record<string, { es: string; en: string }> = {
  coi: { es: "Seguro (COI)", en: "Insurance (COI)" },
  w9: { es: "W-9", en: "W-9" },
  license: { es: "Licencia", en: "License" },
  agreement: { es: "Acuerdo", en: "Agreement" },
  other: { es: "Documento", en: "Document" },
};
const docLabel = (type: string) => DOC_LABELS[type] ?? DOC_LABELS.other;

/** Date, weekday (0 = Sunday) and hour in Florida, including daylight saving. */
export function floridaClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { today: `${get("year")}-${get("month")}-${get("day")}`, weekday, hour: Number(get("hour")) };
}

export function isMorningWindow(now: Date, startHour = DEFAULT_SETTINGS.digestHour): boolean {
  const { weekday, hour } = floridaClock(now);
  return weekday >= 1 && weekday <= 5 && hour >= startHour && hour < startHour + WINDOW_HOURS;
}

/** Valid, distinct reminder days, largest first; the defaults if none are usable. */
export function cleanDays(days: unknown): number[] {
  const list = Array.isArray(days) ? days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 120) : [];
  const unique = [...new Set(list)].sort((a, b) => b - a);
  return unique.length ? unique : DEFAULT_SETTINGS.expiryDays;
}

export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

/** The approved document that counts per company and type: a renewal replaces the older one. */
export function currentDocs(docs: Doc[]): Doc[] {
  const best = new Map<string, Doc>();
  for (const d of docs) {
    if (d.review_status !== "approved" || d.sub_status === "inactive" || !EXPIRING_TYPES.includes(d.doc_type)) continue;
    const key = `${d.subcontractor_id}:${d.doc_type}`;
    const top = best.get(key);
    if (!top || (top.expires_on !== null && (d.expires_on === null || d.expires_on > top.expires_on))) best.set(key, d);
  }
  return [...best.values()].filter((d) => d.expires_on !== null);
}

/** Staff see expired documents and those within the smallest reminder daily; the other reminders once, on their date. */
export function staffShouldSee(daysLeft: number, weekday: number, days = DEFAULT_SETTINGS.expiryDays): boolean {
  const list = cleanDays(days);
  if (daysLeft <= Math.min(...list)) return true;
  const gap = weekday === 1 ? 3 : 1; // Monday also covers the weekend
  return list.some((t) => daysLeft <= t && daysLeft > t - gap);
}

/** Tightest reminder reached by a document, or null if it's not due yet. */
export function reminderStage(daysLeft: number, days = DEFAULT_SETTINGS.expiryDays): string | null {
  if (daysLeft < 0) return "expired";
  const reached = cleanDays(days).filter((t) => daysLeft <= t);
  return reached.length ? String(Math.min(...reached)) : null;
}

export function planEmails(input: PlanInput): Email[] {
  const { profiles, docs, leads, now, appUrl, settings, force } = input;
  const changeOrders = input.changeOrders ?? [];
  const proposals = input.proposals ?? [];
  const { subsEnabled, digestEnabled, digestHour, digestMuted } = settings;
  const c = STAFF[cleanLang(settings.staffLang)];
  const expiryDays = cleanDays(settings.expiryDays);
  const { today, weekday } = floridaClock(now);
  const emails: Email[] = [];
  const logins = profiles.filter((p) => p.role === "subcontractor" && p.email && p.subcontractor_id);

  if (subsEnabled) {
    for (const d of docs) {
      if (d.review_status === "pending" || !d.reviewed_at) continue;
      if (now.getTime() - Date.parse(d.reviewed_at) > REVIEW_LOOKBACK_MS) continue;
      for (const p of logins.filter((l) => l.subcontractor_id === d.subcontractor_id)) {
        emails.push(reviewEmail(d, p, appUrl));
      }
    }
    // An approved change to a subcontractor's agreed amount, like a review result: soon after it happens.
    for (const co of changeOrders) {
      if (co.status !== "approved" || !co.decided_at || !co.subcontractor_id || !co.sub_delta) continue;
      if (now.getTime() - Date.parse(co.decided_at) > REVIEW_LOOKBACK_MS) continue;
      for (const p of logins.filter((l) => l.subcontractor_id === co.subcontractor_id)) {
        emails.push(changeEmail(co, p, appUrl));
      }
    }
  }

  // A client accepted or rejected a proposal: tell whoever sent it and the super admins, right away.
  const staffProfiles = profiles.filter((p) => p.role !== "subcontractor" && p.email);
  for (const pr of proposals) {
    if (now.getTime() - Date.parse(pr.decided_at) > REVIEW_LOOKBACK_MS) continue;
    const to = staffProfiles.filter((p) => p.id === pr.created_by || p.role === "super_admin");
    for (const p of to) emails.push(proposalEmail(pr, p, appUrl, c));
  }

  if (!force && !isMorningWindow(now, digestHour)) return emails;

  const current = currentDocs(docs);

  if (subsEnabled) {
    for (const d of current) {
      const left = daysUntil(d.expires_on as string, today);
      const stage = reminderStage(left, expiryDays);
      if (!stage) continue;
      const renewing = docs.some(
        (o) => o.subcontractor_id === d.subcontractor_id && o.doc_type === d.doc_type && o.review_status === "pending",
      );
      if (renewing) continue;
      for (const p of logins.filter((l) => l.subcontractor_id === d.subcontractor_id)) {
        emails.push(reminderEmail(d, p, stage, left, appUrl));
      }
    }
  }

  const staff = profiles.filter((p) => p.role !== "subcontractor" && p.email);
  const staffIds = new Set(staff.map((p) => p.id));
  const docAlerts = current
    .map((d) => ({ d, left: daysUntil(d.expires_on as string, today) }))
    .filter(({ left }) => staffShouldSee(left, weekday, expiryDays))
    .sort((a, b) => a.left - b.left);
  const toReview = docs.filter((d) => d.review_status === "pending");
  const toApprove = changeOrders
    .filter((co) => co.status === "pending")
    .sort((a, b) => a.requested_on.localeCompare(b.requested_on));
  const dueLeads = leads
    .filter((l) => !["converted", "lost"].includes(l.status) && l.next_follow_up && l.next_follow_up <= today)
    .sort((a, b) => (a.next_follow_up as string).localeCompare(b.next_follow_up as string));

  for (const p of staff) {
    if (!digestEnabled || digestMuted.includes(p.id)) continue;
    const mine = dueLeads.filter(
      (l) => l.owner_id === p.id || (p.role === "super_admin" && (!l.owner_id || !staffIds.has(l.owner_id))),
    );
    const total = docAlerts.length + toReview.length + toApprove.length + mine.length;
    if (!total) continue;
    emails.push({
      key: `digest:${today}:${p.id}`,
      kind: "digest",
      to: p.email as string,
      subject: c.digestSubject(total),
      ...digestBody({ p, today, docAlerts, toReview, toApprove, leads: mine, appUrl, c }),
    });
  }
  return emails;
}

// ---------------------------------------------------------------- content

export function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function fmtDate(iso: string, locale: "es-US" | "en-US"): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function layout(title: string, body: string, cta: { href: string; label: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px 12px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1f2329">
<div style="max-width:600px;margin:0 auto;background:#fff;padding:28px">
<p style="margin:0 0 20px;font-size:12px;letter-spacing:3px;font-weight:700;color:#c8102e">GRAND HILL</p>
<h1 style="margin:0 0 16px;font-size:22px;font-weight:500">${esc(title)}</h1>
${body}
<p style="margin:24px 0 0"><a href="${esc(cta.href)}" style="display:inline-block;background:#1f2329;color:#fff;padding:11px 18px;text-decoration:none;font-size:14px">${esc(cta.label)}</a></p>
</div></body></html>`;
}

function section(title: string, rows: { href: string; main: string; meta: string }[]): string {
  if (!rows.length) return "";
  const items = rows
    .map((r) => `<tr><td style="padding:9px 0;border-top:1px solid #e7e7ea;font-size:14px"><a href="${esc(r.href)}" style="color:#1f2329">${esc(r.main)}</a><br><span style="color:#6b7078;font-size:13px">${esc(r.meta)}</span></td></tr>`)
    .join("");
  return `<h2 style="margin:22px 0 6px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#6b7078">${esc(title)} (${rows.length})</h2><table style="width:100%;border-collapse:collapse">${items}</table>`;
}

type StaffCopy = (typeof STAFF)[StaffLang];

function leftLabel(left: number, c: StaffCopy): string {
  if (left < 0) return c.expiredAgo(-left);
  if (left === 0) return c.expiresToday;
  return c.expiresIn(left);
}

function digestBody(args: {
  p: Profile;
  today: string;
  docAlerts: { d: Doc; left: number }[];
  toReview: Doc[];
  toApprove: ChangeOrderRow[];
  leads: Lead[];
  appUrl: string;
  c: StaffCopy;
}) {
  const { p, today, docAlerts, toReview, toApprove, leads, appUrl, c } = args;
  const lang = c.locale === "en-US" ? "en" : "es";
  const sections = [
    {
      title: c.toApprove,
      rows: toApprove.map((co) => {
        const waiting = daysUntil(today, co.requested_on);
        return {
          href: `${appUrl}/proyectos/${co.project_id}`,
          main: `${co.project_name} · CO ${co.number} · ${co.title}`,
          meta: [
            Number(co.contract_delta) ? c.toClient(signed(Number(co.contract_delta), c.locale)) : null,
            waiting <= 0 ? c.requestedToday : c.waiting(waiting),
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }),
    },
    {
      title: c.toReview,
      rows: toReview.map((d) => ({ href: `${appUrl}/subcontratistas/${d.subcontractor_id}`, main: `${d.company_name} · ${docLabel(d.doc_type)[lang]}`, meta: c.fromPortal })),
    },
    {
      title: c.expiring,
      rows: docAlerts.map(({ d, left }) => ({ href: `${appUrl}/subcontratistas/${d.subcontractor_id}`, main: `${d.company_name} · ${docLabel(d.doc_type)[lang]}`, meta: `${leftLabel(left, c)} · ${fmtDate(d.expires_on as string, c.locale)}` })),
    },
    {
      title: c.followUps,
      rows: leads.map((l) => {
        const late = daysUntil(today, l.next_follow_up as string);
        return {
          href: `${appUrl}/leads/${l.id}`,
          main: l.company ? `${l.name} · ${l.company}` : l.name,
          meta: `${late === 0 ? c.dueToday : c.late(late)}${l.owner_id ? "" : ` · ${c.noOwner}`}`,
        };
      }),
    },
  ];
  const first = p.full_name?.trim().split(/\s+/)[0];
  const title = c.hello(first ?? null);
  const html = layout(title, sections.map((s) => section(s.title, s.rows)).join(""), { href: `${appUrl}/dashboard`, label: c.openDashboard });
  const text = [title, ...sections.filter((s) => s.rows.length).map((s) => `\n${s.title}\n${s.rows.map((r) => `- ${r.main} (${r.meta}): ${r.href}`).join("\n")}`), `\n${appUrl}/dashboard`].join("\n");
  return { html, text };
}

function money(value: number, locale: "es-US" | "en-US"): string {
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(value);
}

function signed(value: number, locale: "es-US" | "en-US"): string {
  return `${value < 0 ? "−" : "+"}${money(Math.abs(value), locale)}`;
}

function proposalEmail(pr: ProposalDecision, p: Profile, appUrl: string, c: StaffCopy): Email {
  const accepted = pr.status === "accepted";
  const who = pr.signer_name || c.theClient;
  const amount = pr.total === null ? "" : c.forAmount(money(Number(pr.total), c.locale));
  const client = pr.client_name ? ` (${pr.client_name})` : "";
  const title = accepted ? c.accepted : c.rejected;
  const lead = accepted ? c.acceptedLead(who, pr.bid_title, `${client}${amount}`) : c.rejectedLead(who, pr.bid_title, `${client}${amount}`);
  const details = [pr.signer_email ? c.email(pr.signer_email) : null, pr.client_note ? c.comment(pr.client_note) : null].filter(Boolean) as string[];
  const href = `${appUrl}/bids/${pr.bid_id}`;
  return {
    key: `proposal:${pr.id}:${pr.decided_at}:${p.id}`,
    kind: "proposal",
    to: p.email as string,
    subject: oneLine(`Grand Hill · ${title} · ${pr.bid_title}`),
    html: layout(
      title,
      `<p style="font-size:15px;line-height:1.5">${esc(lead)}</p>${details.map((x) => `<p style="font-size:14px;line-height:1.5;color:#6b7078;margin:6px 0">${esc(x)}</p>`).join("")}`,
      { href, label: accepted ? c.openBidCreate : c.openBid },
    ),
    text: [lead, ...details, "", href].join("\n"),
  };
}

function changeEmail(co: ChangeOrderRow, p: Profile, appUrl: string): Email {
  const delta = Number(co.sub_delta);
  const total = co.current_agreed === null ? null : Number(co.current_agreed);
  const es = `Grand Hill aprobó la orden de cambio CO ${co.number} (${co.title}) en ${co.project_name}. Tu monto acordado cambia ${signed(delta, "es-US")}${total === null ? "" : ` y queda en ${money(total, "es-US")}`}.`;
  const en = `Grand Hill approved change order CO ${co.number} (${co.title}) on ${co.project_name}. Your agreed amount changes by ${signed(delta, "en-US")}${total === null ? "" : ` to ${money(total, "en-US")}`}.`;
  const title = "Cambio aprobado · Change approved";
  const href = `${appUrl}/portal`;
  return {
    key: `change:${co.id}:${co.decided_at}:${p.id}`,
    kind: "change",
    to: p.email as string,
    subject: oneLine(`Grand Hill · ${title} · ${co.project_name}`),
    html: layout(title, `<p style="font-size:15px;line-height:1.5">${esc(es)}</p><p style="font-size:15px;line-height:1.5;color:#6b7078">${esc(en)}</p>`, { href, label: "Abrir portal · Open portal" }),
    text: `${es}\n\n${en}\n\n${href}`,
  };
}

function reminderEmail(d: Doc, p: Profile, stage: string, left: number, appUrl: string): Email {
  const label = docLabel(d.doc_type);
  const date = d.expires_on as string;
  const expired = left < 0;
  const es = expired
    ? `Tu ${label.es} de ${d.company_name} venció el ${fmtDate(date, "es-US")}. Sube la versión vigente en el portal.`
    : `Tu ${label.es} de ${d.company_name} vence el ${fmtDate(date, "es-US")}. Sube la renovación en el portal.`;
  const en = expired
    ? `Your ${label.en} for ${d.company_name} expired on ${fmtDate(date, "en-US")}. Please upload the current version in the portal.`
    : `Your ${label.en} for ${d.company_name} expires on ${fmtDate(date, "en-US")}. Please upload the renewal in the portal.`;
  const title = expired ? `${label.es} vencido · ${label.en} expired` : `${label.es} por vencer · ${label.en} expiring`;
  const href = `${appUrl}/portal`;
  return {
    key: `reminder:${d.id}:${date}:${stage}:${p.id}`,
    kind: "reminder",
    to: p.email as string,
    subject: oneLine(`Grand Hill · ${title} · ${d.company_name}`),
    html: layout(title, `<p style="font-size:15px;line-height:1.5">${esc(es)}</p><p style="font-size:15px;line-height:1.5;color:#6b7078">${esc(en)}</p>`, { href, label: "Abrir portal · Open portal" }),
    text: `${es}\n\n${en}\n\n${href}`,
  };
}

function reviewEmail(d: Doc, p: Profile, appUrl: string): Email {
  const label = docLabel(d.doc_type);
  const approved = d.review_status === "approved";
  const title = approved ? `${label.es} aprobado · ${label.en} approved` : `${label.es} rechazado · ${label.en} rejected`;
  const es = approved
    ? `Aprobamos tu ${label.es} de ${d.company_name}.`
    : `No pudimos aprobar tu ${label.es} de ${d.company_name}. Corrígelo y súbelo de nuevo en el portal.`;
  const en = approved
    ? `We approved your ${label.en} for ${d.company_name}.`
    : `We couldn't approve your ${label.en} for ${d.company_name}. Please fix it and upload it again in the portal.`;
  const reason = !approved && d.rejection_reason ? d.rejection_reason : "";
  const reasonHtml = reason ? `<p style="font-size:15px;line-height:1.5;border-left:3px solid #c8102e;padding-left:12px"><strong>Motivo · Reason:</strong> ${esc(reason)}</p>` : "";
  const href = `${appUrl}/portal`;
  return {
    key: `review:${d.id}:${d.reviewed_at}:${p.id}`,
    kind: "review",
    to: p.email as string,
    subject: oneLine(`Grand Hill · ${title} · ${d.company_name}`),
    html: layout(title, `<p style="font-size:15px;line-height:1.5">${esc(es)}</p><p style="font-size:15px;line-height:1.5;color:#6b7078">${esc(en)}</p>${reasonHtml}`, { href, label: "Abrir portal · Open portal" }),
    text: `${es}\n\n${en}${reason ? `\n\nMotivo / Reason: ${reason}` : ""}\n\n${href}`,
  };
}
