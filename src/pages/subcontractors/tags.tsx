import { Tag, type TagTone } from "../../components/ui";
import { useT } from "../../i18n";
import type { ComplianceLevel, SubStatus, Validity } from "../../lib/subcontractors";

const STATUS_TONE: Record<SubStatus, TagTone> = {
  prospect: "neutral",
  prequalified: "neutral",
  active: "strong",
  inactive: "neutral",
};

export function StatusTag({ status }: { status: SubStatus }) {
  const t = useT();
  return <Tag tone={STATUS_TONE[status]}>{t.subs.statuses[status]}</Tag>;
}

const COMPLIANCE_TONE: Record<ComplianceLevel, TagTone> = {
  ok: "success",
  expiring: "warning",
  expired: "danger",
  missing: "danger",
};

export function ComplianceTag({ level }: { level: ComplianceLevel }) {
  const t = useT();
  return <Tag tone={COMPLIANCE_TONE[level]}>{t.subs.compliance[level]}</Tag>;
}

const VALIDITY_TONE: Record<Validity, TagTone> = {
  valid: "success",
  expiring: "warning",
  expired: "danger",
  no_expiry: "neutral",
};

export function ValidityTag({ validity }: { validity: Validity }) {
  const t = useT();
  return <Tag tone={VALIDITY_TONE[validity]}>{t.subs.validity[validity]}</Tag>;
}
