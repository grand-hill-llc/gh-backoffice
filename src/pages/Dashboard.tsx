import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { PageHeader } from "../components/ui";
import { AlertCircleIcon } from "./Icons";

type Counts = { openBids: number; activeSubs: number; docsAttention: number };

export default function Dashboard() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const head = { count: "exact" as const, head: true };
      const [bids, subs, docs] = await Promise.all([
        supabase.from("bids").select("id", head).in("status", ["new", "estimating", "submitted"]),
        supabase.from("subcontractors").select("id", head).eq("status", "active"),
        supabase.from("v_sub_documents_status").select("id", head).in("validity", ["expiring", "expired"]),
      ]);
      if (!active) return;
      const err = bids.error ?? subs.error ?? docs.error;
      if (err) {
        setError(err.message);
        return;
      }
      setCounts({ openBids: bids.count ?? 0, activeSubs: subs.count ?? 0, docsAttention: docs.count ?? 0 });
    })();
    return () => {
      active = false;
    };
  }, []);

  const missingMigration = !!error && /schema cache|does not exist|relation/i.test(error);
  const cards: { label: string; value: number | undefined; note: string }[] = [
    { label: "Bids abiertos", value: counts?.openBids, note: "Nuevos, en cotización o enviados" },
    { label: "Subcontratistas activos", value: counts?.activeSubs, note: "Con estado activo en el directorio" },
    { label: "Documentos por atender", value: counts?.docsAttention, note: "Vencidos o por vencer en 30 días" },
  ];

  return (
    <>
      <PageHeader eyebrow="Back Office" title="Resumen" description="Estado general del negocio de un vistazo." />

      {error && (
        <div className="gh-notice is-error" role="alert" style={{ marginBottom: "var(--space-4)" }}>
          <AlertCircleIcon />
          <p>
            {missingMigration
              ? "Faltan las tablas en Supabase. Aplica la migración supabase/migrations/0001_foundations.sql en el SQL Editor."
              : "No pudimos cargar los datos. Inténtalo de nuevo."}
          </p>
        </div>
      )}

      <div className="stat-grid">
        {cards.map((c) => (
          <section key={c.label} className="stat">
            <p className="gh-label">{c.label}</p>
            <p className="stat-value" aria-live="polite">
              {c.value ?? "—"}
            </p>
            <p className="gh-small gh-muted">{c.note}</p>
          </section>
        ))}
      </div>
    </>
  );
}
