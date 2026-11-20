import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { Tag, type TagTone } from "../../components/ui";
import { useT } from "../../i18n";
import { followUpOf, type Lead, type LeadSource, type LeadStatus, type Owner } from "../../lib/leads";

const STATUS_TONE: Record<LeadStatus, TagTone> = {
  new: "warning",
  contacted: "neutral",
  qualified: "strong",
  converted: "success",
  lost: "neutral",
};

export function LeadStatusTag({ status }: { status: LeadStatus }) {
  const t = useT();
  return <Tag tone={STATUS_TONE[status]}>{t.leads.statuses[status]}</Tag>;
}

export function SourceLabel({ source }: { source: LeadSource }) {
  const t = useT();
  return <span className="source-label">{t.leads.sources[source]}</span>;
}

/** "Atrasado 2 días" / "Hoy" / "Mañana" under a follow-up date. Nothing when it isn't pressing. */
export function FollowUpNote({ lead, today }: { lead: Pick<Lead, "status" | "next_follow_up">; today: string }) {
  const t = useT();
  const { state, days } = followUpOf(lead, today);
  if (state === "overdue") return <span className="due-note is-danger">{t.leads.followUp.overdue(Math.abs(days!))}</span>;
  if (state === "today") return <span className="due-note is-danger">{t.leads.followUp.today}</span>;
  if (state === "soon") return <span className="due-note is-warning">{t.leads.followUp.soon(days!)}</span>;
  return null;
}

/** Staff who can own leads (super admins and admins). */
export function useOwners(): Owner[] {
  const [owners, setOwners] = useState<Owner[]>([]);
  useEffect(() => {
    let active = true;
    supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("role", ["super_admin", "admin"])
      .order("full_name")
      .then(({ data }) => {
        if (active) setOwners((data ?? []) as Owner[]);
      });
    return () => {
      active = false;
    };
  }, []);
  return owners;
}
