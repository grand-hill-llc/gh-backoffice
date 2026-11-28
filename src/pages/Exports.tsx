import { useState } from "react";
import { supabase } from "../lib/supabase";
import { tradeLabel, useT } from "../i18n";
import { PageHeader } from "../components/ui";
import { Panel } from "../components/Panel";
import { todayISO } from "../lib/subcontractors";
import {
  buildReport,
  DATED_REPORTS,
  fileName,
  QUICKBOOKS_REPORTS,
  REPORTS,
  toCsv,
  type ExportData,
  type ExportFormat,
  type Range,
  type ReportKey,
} from "../lib/exports";

type Preset = "thisMonth" | "thisYear" | "lastYear" | "all";
const PRESETS: Preset[] = ["thisMonth", "thisYear", "lastYear", "all"];

function presetRange(p: Preset, today: string): Range {
  const y = Number(today.slice(0, 4));
  if (p === "thisMonth") return { from: `${today.slice(0, 7)}-01`, to: today };
  if (p === "thisYear") return { from: `${y}-01-01`, to: today };
  if (p === "lastYear") return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  return { from: null, to: null };
}

/** Every row of a table: the API returns at most 1000 per request. */
async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order("id").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function loadData(): Promise<ExportData> {
  const [projects, assignments, movements, orders, subs] = await Promise.all([
    fetchAll<ExportData["projects"][number]>(
      "projects",
      "id, name, status, location, start_date, end_date, contract_amount, budgeted_cost, client:clients(name)",
    ),
    fetchAll<ExportData["assignments"][number]>("project_subs", "id, project_id, subcontractor_id, agreed_amount"),
    fetchAll<ExportData["movements"][number]>("project_movements", "id, project_id, kind, project_sub_id, amount, occurred_on, reference, notes"),
    fetchAll<ExportData["orders"][number]>(
      "change_orders",
      "id, project_id, number, title, description, status, contract_delta, cost_delta, project_sub_id, sub_delta, requested_on, decided_on, reference, decider:profiles(full_name, email)",
    ),
    fetchAll<ExportData["subs"][number]>("subcontractors", "id, company_name, legal_name, trades, contact_name, email, phone, city, state, status"),
  ]);
  return { projects, assignments, movements, orders, subs };
}

function save(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Status = { report: ReportKey; kind: "busy" | "done" | "empty" | "failed"; rows?: number } | null;

/** CSV downloads for accounting. Staff only (the route and RLS both enforce it). */
export default function Exports() {
  const t = useT();
  const e = t.exports;
  const today = todayISO();
  const [preset, setPreset] = useState<Preset | null>("thisYear");
  const [range, setRange] = useState<Range>(() => presetRange("thisYear", today));
  const [formats, setFormats] = useState<Record<ReportKey, ExportFormat>>({
    movements: "excel",
    projects: "excel",
    changeOrders: "excel",
    subcontractors: "excel",
  });
  const [status, setStatus] = useState<Status>(null);

  const rangeError = range.from && range.to && range.to < range.from ? e.rangeInvalid : null;

  const pick = (p: Preset) => {
    setPreset(p);
    setRange(presetRange(p, today));
  };
  const setDate = (key: keyof Range, value: string) => {
    setPreset(null);
    setRange((r) => ({ ...r, [key]: value || null }));
  };

  const download = async (report: ReportKey) => {
    if (rangeError) return;
    setStatus({ report, kind: "busy" });
    try {
      const data = await loadData();
      const format = QUICKBOOKS_REPORTS.includes(report) ? formats[report] : "excel";
      const built = buildReport(report, data, range, format, t, (v) => tradeLabel(v, t));
      if (built.rows.length === 0) return setStatus({ report, kind: "empty" });
      save(fileName(report, format, range, today), toCsv(built.headers, built.rows, format));
      setStatus({ report, kind: "done", rows: built.rows.length });
    } catch {
      setStatus({ report, kind: "failed" });
    }
  };

  return (
    <>
      <PageHeader title={e.title} description={e.intro} />
      <div className="exports">
        <Panel title={e.period}>
          <div className="exports-period">
            <div className="segmented" role="group" aria-label={e.period}>
              {PRESETS.map((p) => (
                <button key={p} type="button" aria-pressed={preset === p} onClick={() => pick(p)}>
                  {e.presets[p]}
                </button>
              ))}
            </div>
            <div className="exports-dates">
              <div className="gh-field">
                <label className="gh-field-label" htmlFor="export-from">{e.from}</label>
                <input id="export-from" className="gh-input" type="date" value={range.from ?? ""} onChange={(ev) => setDate("from", ev.target.value)} />
              </div>
              <div className={`gh-field${rangeError ? " is-error" : ""}`}>
                <label className="gh-field-label" htmlFor="export-to">{e.to}</label>
                <input
                  id="export-to"
                  className="gh-input"
                  type="date"
                  value={range.to ?? ""}
                  min={range.from ?? undefined}
                  onChange={(ev) => setDate("to", ev.target.value)}
                  aria-invalid={!!rangeError}
                  aria-describedby={rangeError ? "export-range-error" : undefined}
                />
              </div>
            </div>
            {rangeError ? <p className="gh-error" id="export-range-error">{rangeError}</p> : <p className="gh-help">{e.periodHelp}</p>}
          </div>
        </Panel>

        {REPORTS.map((report) => {
          const r = e.reports[report];
          const qb = QUICKBOOKS_REPORTS.includes(report);
          const format = qb ? formats[report] : "excel";
          const s = status?.report === report ? status : null;
          const busy = s?.kind === "busy";
          return (
            <Panel
              key={report}
              title={r.title}
              action={
                <button
                  className="gh-btn gh-btn-secondary gh-btn-sm"
                  type="button"
                  onClick={() => download(report)}
                  disabled={busy || !!rangeError || status?.kind === "busy"}
                >
                  {busy ? e.preparing : e.download}
                </button>
              }
            >
              <div className="exports-report">
                <p>{r.help}</p>
                {qb ? (
                  <div className="exports-format">
                    <div className="segmented" role="group" aria-label={`${e.format}: ${r.title}`}>
                      {(["excel", "quickbooks"] as ExportFormat[]).map((f) => (
                        <button key={f} type="button" aria-pressed={format === f} onClick={() => setFormats((x) => ({ ...x, [report]: f }))}>
                          {e.formats[f]}
                        </button>
                      ))}
                    </div>
                    {format === "quickbooks" && <p className="gh-small gh-muted">{r.qbHelp}</p>}
                  </div>
                ) : (
                  <p className="gh-small gh-muted">{[e.excelOnly, DATED_REPORTS.includes(report) ? null : e.noPeriod].filter(Boolean).join(" ")}</p>
                )}
                {s && s.kind !== "busy" && (
                  <p className={`gh-small exports-status is-${s.kind}`} role="status">
                    {s.kind === "done" ? e.done(s.rows ?? 0) : s.kind === "empty" ? e.empty : e.failed}
                  </p>
                )}
              </div>
            </Panel>
          );
        })}
      </div>
    </>
  );
}
