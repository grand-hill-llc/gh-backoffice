import { Tag, type TagTone } from "../../components/ui";
import { useT } from "../../i18n";
import { urgencyOf, type Bid, type BidStatus } from "../../lib/sales";

const STATUS_TONE: Record<BidStatus, TagTone> = {
  new: "neutral",
  estimating: "strong",
  submitted: "strong",
  won: "success",
  lost: "danger",
  declined: "neutral",
};

export function BidStatusTag({ status }: { status: BidStatus }) {
  const t = useT();
  return <Tag tone={STATUS_TONE[status]}>{t.sales.bidStatuses[status]}</Tag>;
}

/** Short note under a due date for bids not yet submitted: overdue, today, or within a week. */
export function DueNote({ bid, today }: { bid: Pick<Bid, "status" | "due_date">; today: string }) {
  const t = useT();
  const { urgency, days } = urgencyOf(bid, today);
  if (urgency === "overdue") return <span className="due-note is-danger">{t.sales.urgency.overdue(Math.abs(days!))}</span>;
  if (urgency === "today") return <span className="due-note is-danger">{t.sales.urgency.today}</span>;
  if (urgency === "soon") return <span className="due-note is-warning">{t.sales.urgency.soon(days!)}</span>;
  return null;
}
