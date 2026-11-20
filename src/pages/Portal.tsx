import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { EmptyState, PageHeader } from "../components/ui";
import { useT } from "../i18n";

/** Placeholder for the subcontractor layer. RLS already limits what this login can read to its own company. */
export default function Portal() {
  const t = useT();
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
      <PageHeader eyebrow={t.portal.eyebrow} title={company ?? t.portal.fallbackTitle} description={t.portal.description} />
      <EmptyState title={t.portal.emptyTitle}>{t.portal.emptyBody}</EmptyState>
    </>
  );
}
