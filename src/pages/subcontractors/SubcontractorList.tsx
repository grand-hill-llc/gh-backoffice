import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  complianceOf,
  REQUIRED_DOCS,
  STATUSES,
  SUB_COLUMNS,
  type Compliance,
  type DocStatusRow,
  type SubStatus,
  type Subcontractor,
} from "../../lib/subcontractors";
import { EmptyState, PageHeader } from "../../components/ui";
import { AlertCircleIcon } from "../Icons";
import { ComplianceTag, StatusTag } from "./tags";
import { tradeLabel, useT } from "../../i18n";

type Loaded = { subs: Subcontractor[]; compliance: Map<string, Compliance> };

export default function SubcontractorList() {
  const navigate = useNavigate();
  const t = useT();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SubStatus | "all">("all");
  const [onlyAttention, setOnlyAttention] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const [subs, docs] = await Promise.all([
        supabase.from("subcontractors").select(SUB_COLUMNS).order("company_name"),
        supabase.from("v_sub_documents_status").select("id, subcontractor_id, doc_type, expires_on, days_left, validity"),
      ]);
      if (!active) return;
      if (subs.error || docs.error) {
        setError(true);
        return;
      }
      const bySub = new Map<string, DocStatusRow[]>();
      for (const d of (docs.data ?? []) as DocStatusRow[]) {
        const list = bySub.get(d.subcontractor_id) ?? [];
        list.push(d);
        bySub.set(d.subcontractor_id, list);
      }
      const rows = (subs.data ?? []) as Subcontractor[];
      const compliance = new Map(rows.map((s) => [s.id, complianceOf(bySub.get(s.id) ?? [])]));
      setData({ subs: rows, compliance });
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.subs.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (onlyAttention && data.compliance.get(s.id)?.level === "ok") return false;
      if (!q) return true;
      return [s.company_name, s.legal_name, s.contact_name, s.city, s.email, ...s.trades.map((tr) => tradeLabel(tr, t))]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [data, query, status, onlyAttention, t]);

  const attentionCount = data ? [...data.compliance.values()].filter((c) => c.level !== "ok").length : 0;

  return (
    <>
      <div className="page-header-row">
        <PageHeader eyebrow={t.subs.eyebrow} title={t.subs.title} description={t.subs.description} />
        <Link className="gh-btn gh-btn-primary" to="/subcontratistas/nuevo">
          {t.subs.newButton}
        </Link>
      </div>

      {error ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>{t.subs.loadFailed}</p>
        </div>
      ) : !data ? (
        <p className="gh-muted" role="status">{t.common.loading}</p>
      ) : data.subs.length === 0 ? (
        <EmptyState title={t.subs.emptyTitle}>{t.subs.emptyBody}</EmptyState>
      ) : (
        <>
          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="sub-search">{t.subs.search}</label>
              <input
                id="sub-search"
                className="gh-input"
                type="search"
                placeholder={t.subs.searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="sub-status">{t.subs.status}</label>
              <select
                id="sub-status"
                className="gh-input gh-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as SubStatus | "all")}
              >
                <option value="all">{t.subs.all}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{t.subs.statuses[s]}</option>
                ))}
              </select>
            </div>
            <label className="gh-check toolbar-check">
              <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
              <span>{t.subs.onlyAttention(attentionCount)}</span>
            </label>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">
            {filtered.length === data.subs.length
              ? t.subs.count(data.subs.length)
              : t.subs.countFiltered(filtered.length, data.subs.length)}
          </p>

          {filtered.length === 0 ? (
            <EmptyState title={t.subs.noMatchTitle}>{t.subs.noMatchBody}</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">{t.subs.colCompany}</th>
                    <th scope="col">{t.subs.colTrades}</th>
                    <th scope="col">{t.subs.colContact}</th>
                    <th scope="col">{t.subs.colStatus}</th>
                    <th scope="col">{t.subs.colDocs}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s) => {
                    const c = data.compliance.get(s.id)!;
                    return (
                      <tr key={s.id} onClick={() => navigate(`/subcontratistas/${s.id}`)}>
                        <td className="col-company">
                          <Link className="row-link" to={`/subcontratistas/${s.id}`} onClick={(e) => e.stopPropagation()}>
                            {s.company_name}
                          </Link>
                          {(s.city || s.state) && (
                            <span className="cell-sub">{[s.city, s.state].filter(Boolean).join(", ")}</span>
                          )}
                        </td>
                        <td className="cell-trades">{s.trades.length ? s.trades.map((tr) => tradeLabel(tr, t)).join(", ") : "—"}</td>
                        <td className="col-contact">
                          {s.contact_name ?? "—"}
                          {s.phone && <span className="cell-sub nowrap">{s.phone}</span>}
                        </td>
                        <td><StatusTag status={s.status} /></td>
                        <td>
                          <ComplianceTag level={c.level} />
                          {c.level !== "ok" && (
                            <span className="cell-sub">
                              {REQUIRED_DOCS.filter((d) => c.byType[d] !== "ok")
                                .map((d) => `${t.subs.docTypes[d]}: ${t.subs.docState[c.byType[d]]}`)
                                .join(" · ")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
