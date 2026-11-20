import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { EmptyState, PageHeader } from "../components/ui";

/** Placeholder for the subcontractor layer. RLS already limits what this login can read to its own company. */
export default function Portal() {
  const [company, setCompany] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase
      .from("subcontractors")
      .select("company_name")
      .maybeSingle()
      .then(({ data }) => {
        if (active) setCompany(data?.company_name ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <PageHeader eyebrow="Subcontratistas" title={company ?? "Mi empresa"} description="Tu empresa y tus documentos en Grand Hill." />
      <EmptyState title="Portal en construcción">
        Aquí podrás ver tus documentos vigentes y los trabajos asignados. Todavía no está habilitado.
      </EmptyState>
    </>
  );
}
