// CSV exports for accounting (page /exportar). Pure: the page loads the data, these build the files.
//
// Two formats:
//   excel       headers in the app's language, dates YYYY-MM-DD, plain numbers, UTF-8 with BOM so
//               Excel shows accents; Google Sheets reads it as is.
//   quickbooks  QuickBooks Online imports: bank transactions (Date, Description, Amount, dates
//               MM/DD/YYYY, money out negative) and vendors. Only for movements and subcontractors.

import type { Dict } from "../i18n/es";
import {
  assignmentsWithChangeOrders,
  paidToAssignment,
  totalsOf,
  withChangeOrders,
  type ChangeOrderStatus,
  type MovementKind,
  type ProjectStatus,
} from "./projects.ts"; // .ts so the Node tests can import this file directly

export type ExportFormat = "excel" | "quickbooks";
export type ReportKey = "movements" | "projects" | "changeOrders" | "subcontractors";
export const REPORTS: ReportKey[] = ["movements", "projects", "changeOrders", "subcontractors"];
/** Reports with a QuickBooks layout. */
export const QUICKBOOKS_REPORTS: ReportKey[] = ["movements", "subcontractors"];
/** Reports filtered by the date range (movements by date, change orders by request date, subs' payments). */
export const DATED_REPORTS: ReportKey[] = ["movements", "changeOrders", "subcontractors"];

export type Range = { from: string | null; to: string | null };
export const inRange = (date: string | null, r: Range) => !!date && (!r.from || date >= r.from) && (!r.to || date <= r.to);

// ---------------------------------------------------------------- CSV

type Cell = string | number | null | undefined;

/** One CSV cell. Text that a spreadsheet would run as a formula is prefixed with ' (CSV injection). */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "") : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][], format: ExportFormat): string {
  const body = [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  // Excel needs the BOM to read UTF-8; QuickBooks reads the first header better without it.
  return format === "excel" ? `﻿${body}` : body;
}

/** YYYY-MM-DD → MM/DD/YYYY (QuickBooks, US). */
export const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const money = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
const join = (parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ");

export function fileName(report: ReportKey, format: ExportFormat, range: Range, today: string): string {
  const slug = { movements: "movimientos", projects: "proyectos", changeOrders: "ordenes-de-cambio", subcontractors: "subcontratistas" }[report];
  const period = DATED_REPORTS.includes(report) && (range.from || range.to) ? `_${range.from ?? "inicio"}_a_${range.to ?? today}` : `_${today}`;
  return `grandhill-${slug}${period}${format === "quickbooks" ? "-quickbooks" : ""}.csv`;
}

// ---------------------------------------------------------------- data shapes (what the page loads)

export type ExProject = {
  id: string;
  name: string;
  status: ProjectStatus;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  contract_amount: number | null;
  budgeted_cost: number | null;
  client: { name: string } | null;
};
export type ExAssignment = { id: string; project_id: string; subcontractor_id: string; agreed_amount: number | null };
export type ExMovement = {
  id: string;
  project_id: string;
  kind: MovementKind;
  project_sub_id: string | null;
  amount: number;
  occurred_on: string;
  reference: string | null;
  notes: string | null;
};
export type ExChangeOrder = {
  project_id: string;
  number: number;
  title: string;
  description: string | null;
  status: ChangeOrderStatus;
  contract_delta: number;
  cost_delta: number;
  project_sub_id: string | null;
  sub_delta: number | null;
  requested_on: string;
  decided_on: string | null;
  reference: string | null;
  decider: { full_name: string | null; email: string | null } | null;
};
export type ExSub = {
  id: string;
  company_name: string;
  legal_name: string | null;
  trades: string[];
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  status: string;
};
export type ExportData = {
  projects: ExProject[];
  assignments: ExAssignment[];
  movements: ExMovement[];
  orders: ExChangeOrder[];
  subs: ExSub[];
};

export type Built = { headers: string[]; rows: Cell[][] };

// ---------------------------------------------------------------- reports

export function movementsReport(d: ExportData, range: Range, format: ExportFormat, t: Dict): Built {
  const project = new Map(d.projects.map((p) => [p.id, p]));
  const subOfAssignment = new Map(d.assignments.map((a) => [a.id, a.subcontractor_id]));
  const subName = new Map(d.subs.map((s) => [s.id, s.company_name]));
  const list = d.movements
    .filter((m) => inRange(m.occurred_on, range))
    .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.id.localeCompare(b.id));
  const sub = (m: ExMovement) => (m.project_sub_id ? subName.get(subOfAssignment.get(m.project_sub_id) ?? "") ?? null : null);
  const h = t.exports.cols;

  if (format === "quickbooks") {
    return {
      headers: ["Date", "Description", "Amount"],
      rows: list.map((m) => {
        const p = project.get(m.project_id);
        const amount = money(m.amount) ?? 0;
        return [
          usDate(m.occurred_on),
          join([t.projects.kinds[m.kind], p?.name, sub(m), m.reference ? `${h.reference} ${m.reference}` : null]),
          m.kind === "receipt" ? amount : -amount,
        ];
      }),
    };
  }
  return {
    headers: [h.date, h.type, h.project, h.client, h.subcontractor, h.moneyIn, h.moneyOut, h.reference, h.notes],
    rows: list.map((m) => {
      const p = project.get(m.project_id);
      const amount = money(m.amount);
      return [
        m.occurred_on,
        t.projects.kinds[m.kind],
        p?.name ?? null,
        p?.client?.name ?? null,
        sub(m),
        m.kind === "receipt" ? amount : null,
        m.kind === "receipt" ? null : amount,
        m.reference,
        m.notes,
      ];
    }),
  };
}

/** Every project with its current amounts (approved change orders included), like the projects page. */
export function projectsReport(d: ExportData, t: Dict): Built {
  const h = t.exports.cols;
  const rows = [...d.projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const orders = d.orders.filter((o) => o.project_id === p.id);
      const current = withChangeOrders(p, orders);
      const assignments = assignmentsWithChangeOrders(
        d.assignments.filter((a) => a.project_id === p.id),
        orders,
      );
      const totals = totalsOf(current, assignments, d.movements.filter((m) => m.project_id === p.id));
      const change = (v: number | null) => (v === null ? null : money(v));
      return [
        p.name,
        p.client?.name ?? null,
        t.projects.statuses[p.status],
        p.location,
        p.start_date,
        p.end_date,
        money(p.contract_amount),
        change(current.contract_amount === null || p.contract_amount === null ? null : current.contract_amount - p.contract_amount),
        money(current.contract_amount),
        money(current.budgeted_cost),
        money(totals.received),
        money(totals.toCollect),
        money(totals.committed),
        money(totals.paidSubs),
        money(totals.expenses),
        totals.plannedMargin ? money(totals.plannedMargin.amount) : null,
        totals.plannedMargin?.pct === null || totals.plannedMargin === null ? null : Math.round(totals.plannedMargin.pct * 1000) / 10,
      ];
    });
  return {
    headers: [
      h.project,
      h.client,
      h.status,
      h.location,
      h.start,
      h.end,
      h.originalContract,
      h.approvedChanges,
      h.currentContract,
      h.budget,
      h.received,
      h.toCollect,
      h.committedSubs,
      h.paidSubs,
      h.expenses,
      h.plannedMargin,
      h.plannedMarginPct,
    ],
    rows,
  };
}

export function changeOrdersReport(d: ExportData, range: Range, t: Dict): Built {
  const h = t.exports.cols;
  const project = new Map(d.projects.map((p) => [p.id, p]));
  const subOfAssignment = new Map(d.assignments.map((a) => [a.id, a.subcontractor_id]));
  const subName = new Map(d.subs.map((s) => [s.id, s.company_name]));
  const rows = d.orders
    .filter((o) => inRange(o.requested_on, range))
    .sort((a, b) => (project.get(a.project_id)?.name ?? "").localeCompare(project.get(b.project_id)?.name ?? "") || a.number - b.number)
    .map((o) => {
      const p = project.get(o.project_id);
      return [
        p?.name ?? null,
        p?.client?.name ?? null,
        t.projects.co.number(o.number),
        o.title,
        t.projects.co.statuses[o.status],
        o.requested_on,
        o.decided_on,
        o.decider?.full_name || o.decider?.email || null,
        money(o.contract_delta),
        money(o.cost_delta),
        o.project_sub_id ? subName.get(subOfAssignment.get(o.project_sub_id) ?? "") ?? null : null,
        money(o.sub_delta),
        o.reference,
        o.description,
      ];
    });
  return {
    headers: [h.project, h.client, h.number, h.title, h.status, h.requested, h.decided, h.decidedBy, h.clientAmount, h.cost, h.subcontractor, h.subAmount, h.reference, h.description],
    rows,
  };
}

/**
 * The subcontractor directory with what each one was agreed and paid. "Paid in period" uses the
 * date range: what the accountant needs for each sub's 1099.
 */
export function subcontractorsReport(d: ExportData, range: Range, format: ExportFormat, t: Dict, trade: (v: string) => string): Built {
  const subs = [...d.subs].sort((a, b) => a.company_name.localeCompare(b.company_name));
  if (format === "quickbooks") {
    return {
      headers: ["Name", "Company", "Email", "Phone", "City", "State", "Country"],
      rows: subs.map((s) => [s.company_name, s.legal_name?.trim() || s.company_name, s.email, s.phone, s.city, s.state, "USA"]),
    };
  }
  const h = t.exports.cols;
  const current = assignmentsWithChangeOrders(d.assignments, d.orders);
  const dated = d.movements.filter((m) => inRange(m.occurred_on, range));
  return {
    headers: [
      h.company,
      h.legalName,
      h.trades,
      h.contact,
      h.email,
      h.phone,
      h.city,
      h.state,
      h.subStatus,
      h.projects,
      h.agreed,
      h.paidAll,
      h.owed,
      h.paidInPeriod,
    ],
    rows: subs.map((s) => {
      const mine = current.filter((a) => a.subcontractor_id === s.id);
      const agreed = mine.reduce((sum, a) => sum + Number(a.agreed_amount ?? 0), 0);
      const paid = mine.reduce((sum, a) => sum + paidToAssignment(a.id, d.movements), 0);
      const owed = mine.reduce(
        (sum, a) => sum + (a.agreed_amount === null ? 0 : Math.max(0, Number(a.agreed_amount) - paidToAssignment(a.id, d.movements))),
        0,
      );
      const paidInPeriod = mine.reduce((sum, a) => sum + paidToAssignment(a.id, dated), 0);
      return [
        s.company_name,
        s.legal_name,
        s.trades.map(trade).join(", "),
        s.contact_name,
        s.email,
        s.phone,
        s.city,
        s.state,
        t.subs.statuses[s.status as keyof Dict["subs"]["statuses"]] ?? s.status,
        new Set(mine.map((a) => a.project_id)).size,
        money(agreed),
        money(paid),
        money(owed),
        money(paidInPeriod),
      ];
    }),
  };
}

export function buildReport(
  report: ReportKey,
  d: ExportData,
  range: Range,
  format: ExportFormat,
  t: Dict,
  trade: (v: string) => string,
): Built {
  const f: ExportFormat = QUICKBOOKS_REPORTS.includes(report) ? format : "excel";
  if (report === "movements") return movementsReport(d, range, f, t);
  if (report === "projects") return projectsReport(d, t);
  if (report === "changeOrders") return changeOrdersReport(d, range, t);
  return subcontractorsReport(d, range, f, t, trade);
}
