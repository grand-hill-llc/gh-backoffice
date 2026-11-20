import { Tag, type TagTone } from "../../components/ui";
import {
  COMPLIANCE_LABEL,
  STATUS_LABEL,
  type ComplianceLevel,
  type SubStatus,
  type Validity,
} from "../../lib/subcontractors";

const STATUS_TONE: Record<SubStatus, TagTone> = {
  prospect: "neutral",
  prequalified: "neutral",
  active: "strong",
  inactive: "neutral",
};

export function StatusTag({ status }: { status: SubStatus }) {
  return <Tag tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Tag>;
}

const COMPLIANCE_TONE: Record<ComplianceLevel, TagTone> = {
  ok: "success",
  expiring: "warning",
  expired: "danger",
  missing: "danger",
};

export function ComplianceTag({ level }: { level: ComplianceLevel }) {
  return <Tag tone={COMPLIANCE_TONE[level]}>{COMPLIANCE_LABEL[level]}</Tag>;
}

const VALIDITY: Record<Validity, { tone: TagTone; label: string }> = {
  valid: { tone: "success", label: "Vigente" },
  expiring: { tone: "warning", label: "Por vencer" },
  expired: { tone: "danger", label: "Vencido" },
  no_expiry: { tone: "neutral", label: "Sin vencimiento" },
};

export function ValidityTag({ validity }: { validity: Validity }) {
  const v = VALIDITY[validity];
  return <Tag tone={v.tone}>{v.label}</Tag>;
}
