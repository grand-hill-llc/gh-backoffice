import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import {
  complianceOf,
  DOC_LABEL,
  DOC_STATE_LABEL,
  REQUIRED_DOCS,
  STATUS_LABEL,
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

type Loaded = { subs: Subcontractor[]; compliance: Map<string, Compliance> };

export default function SubcontractorList() {
  const navigate = useNavigate();
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
      return [s.company_name, s.legal_name, s.contact_name, s.city, s.email, ...s.trades]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q));
    });
  }, [data, query, status, onlyAttention]);

  const attentionCount = data ? [...data.compliance.values()].filter((c) => c.level !== "ok").length : 0;

  return (
    <>
      <div className="page-header-row">
        <PageHeader
          eyebrow="Operaciones"
          title="Subcontratistas"
          description="Directorio con seguro, W-9 y licencia vigentes, y alertas de vencimiento."
        />
        <Link className="gh-btn gh-btn-primary" to="/subcontratistas/nuevo">
          Nuevo subcontratista
        </Link>
      </div>

      {error ? (
        <div className="gh-notice is-error" role="alert">
          <AlertCircleIcon />
          <p>No pudimos cargar los subcontratistas. Revisa la conexión e inténtalo de nuevo.</p>
        </div>
      ) : !data ? (
        <p className="gh-muted" role="status">Cargando…</p>
      ) : data.subs.length === 0 ? (
        <EmptyState title="Todavía no hay subcontratistas registrados">
          Agrega el primero con el botón “Nuevo subcontratista”. Después podrás cargar su seguro, W-9 y licencia.
        </EmptyState>
      ) : (
        <>
          <div className="toolbar" role="search">
            <div className="gh-field toolbar-search">
              <label className="gh-field-label" htmlFor="sub-search">Buscar</label>
              <input
                id="sub-search"
                className="gh-input"
                type="search"
                placeholder="Empresa, contacto, ciudad u oficio"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="gh-field">
              <label className="gh-field-label" htmlFor="sub-status">Estado</label>
              <select
                id="sub-status"
                className="gh-input gh-select"
                value={status}
                onChange={(e) => setStatus(e.target.value as SubStatus | "all")}
              >
                <option value="all">Todos</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <label className="gh-check toolbar-check">
              <input type="checkbox" checked={onlyAttention} onChange={(e) => setOnlyAttention(e.target.checked)} />
              <span>Documentos por atender ({attentionCount})</span>
            </label>
          </div>

          <p className="gh-small gh-muted list-count" aria-live="polite">
            {filtered.length === data.subs.length
              ? `${data.subs.length} subcontratista${data.subs.length === 1 ? "" : "s"}`
              : `${filtered.length} de ${data.subs.length}`}
          </p>

          {filtered.length === 0 ? (
            <EmptyState title="Ningún subcontratista coincide">Cambia la búsqueda o los filtros.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="gh-table is-interactive">
                <thead>
                  <tr>
                    <th scope="col">Empresa</th>
                    <th scope="col">Oficios</th>
                    <th scope="col">Contacto</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Documentos</th>
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
                        <td className="cell-trades">{s.trades.length ? s.trades.join(", ") : "—"}</td>
                        <td className="col-contact">
                          {s.contact_name ?? "—"}
                          {s.phone && <span className="cell-sub nowrap">{s.phone}</span>}
                        </td>
                        <td><StatusTag status={s.status} /></td>
                        <td>
                          <ComplianceTag level={c.level} />
                          {c.level !== "ok" && (
                            <span className="cell-sub">
                              {REQUIRED_DOCS.filter((t) => c.byType[t] !== "ok")
                                .map((t) => `${DOC_LABEL[t]}: ${DOC_STATE_LABEL[c.byType[t]]}`)
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
