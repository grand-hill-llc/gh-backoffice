import { Tag, type TagTone } from "../../components/ui";
import { useT } from "../../i18n";
import type { MovementKind, ProjectStatus } from "../../lib/projects";

const STATUS_TONE: Record<ProjectStatus, TagTone> = {
  scheduled: "neutral",
  in_progress: "strong",
  completed: "success",
  closed: "neutral",
};

export function ProjectStatusTag({ status }: { status: ProjectStatus }) {
  const t = useT();
  return <Tag tone={STATUS_TONE[status]}>{t.projects.statuses[status]}</Tag>;
}

const KIND_TONE: Record<MovementKind, TagTone> = { receipt: "success", sub_payment: "strong", expense: "neutral" };

export function MovementKindTag({ kind }: { kind: MovementKind }) {
  const t = useT();
  return <Tag tone={KIND_TONE[kind]}>{t.projects.kinds[kind]}</Tag>;
}

/** Thin bar showing how much of the contract has been collected. */
export function CollectedBar({ share }: { share: number }) {
  return (
    <span className="progress" aria-hidden="true">
      <span className="progress-fill" style={{ width: `${Math.round(share * 100)}%` }} />
    </span>
  );
}
