// Projects: types mirroring supabase/migrations/0002_projects.sql, plus the money roll-ups. Labels in src/i18n (projects.*).

export type ProjectStatus = "scheduled" | "in_progress" | "completed" | "closed";
export type MovementKind = "receipt" | "sub_payment" | "expense";

export const PROJECT_STATUSES: ProjectStatus[] = ["scheduled", "in_progress", "completed", "closed"];
export const ACTIVE_STATUSES: ProjectStatus[] = ["scheduled", "in_progress"];
export const MOVEMENT_KINDS: MovementKind[] = ["receipt", "sub_payment", "expense"];

export type Project = {
  id: string;
  name: string;
  client_id: string | null;
  bid_id: string | null;
  status: ProjectStatus;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  /** What the client pays Grand Hill. */
  contract_amount: number | null;
  /** Estimated cost to deliver (copied from the bid's estimated cost). */
  budgeted_cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ProjectSub = {
  id: string;
  project_id: string;
  subcontractor_id: string;
  trade: string | null;
  agreed_amount: number | null;
  notes: string | null;
  created_at: string;
};

export type Movement = {
  id: string;
  project_id: string;
  kind: MovementKind;
  project_sub_id: string | null;
  amount: number;
  occurred_on: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
};

export const PROJECT_COLUMNS =
  "id, name, client_id, bid_id, status, location, start_date, end_date, contract_amount, budgeted_cost, notes, created_at, updated_at";
export const PROJECT_SUB_COLUMNS = "id, project_id, subcontractor_id, trade, agreed_amount, notes, created_at";
export const MOVEMENT_COLUMNS = "id, project_id, kind, project_sub_id, amount, occurred_on, reference, notes, created_at";

const n = (v: number | null | undefined) => Number(v ?? 0);

export type ProjectTotals = {
  contract: number | null;
  budget: number | null;
  received: number;
  /** Contract minus received; null without a contract amount. Negative means billed above the contract. */
  toCollect: number | null;
  /** 0–1 share of the contract collected; null without a contract amount. */
  collectedShare: number | null;
  paidSubs: number;
  expenses: number;
  /** Everything paid out so far: subs and other expenses. */
  spent: number;
  /** Sum of agreed amounts with the assigned subs. */
  committed: number;
  /** Still owed to subs: agreed minus paid, over assignments with an agreed amount. */
  owedToSubs: number;
  /** Contract minus budgeted cost: the margin the job was sold at. */
  plannedMargin: { amount: number; pct: number | null } | null;
};

export function totalsOf(
  project: Pick<Project, "contract_amount" | "budgeted_cost">,
  assignments: Pick<ProjectSub, "id" | "agreed_amount">[],
  movements: Pick<Movement, "kind" | "amount" | "project_sub_id">[]
): ProjectTotals {
  const sum = (kind: MovementKind) => movements.filter((m) => m.kind === kind).reduce((s, m) => s + n(m.amount), 0);
  const received = sum("receipt");
  const paidSubs = sum("sub_payment");
  const expenses = sum("expense");
  const contract = project.contract_amount === null ? null : n(project.contract_amount);
  const budget = project.budgeted_cost === null ? null : n(project.budgeted_cost);

  let owedToSubs = 0;
  for (const a of assignments) {
    if (a.agreed_amount === null) continue;
    owedToSubs += Math.max(0, n(a.agreed_amount) - paidToAssignment(a.id, movements));
  }

  return {
    contract,
    budget,
    received,
    toCollect: contract === null ? null : contract - received,
    collectedShare: contract ? Math.min(1, received / contract) : null,
    paidSubs,
    expenses,
    spent: paidSubs + expenses,
    committed: assignments.reduce((s, a) => s + n(a.agreed_amount), 0),
    owedToSubs,
    plannedMargin:
      contract === null || budget === null ? null : { amount: contract - budget, pct: contract > 0 ? (contract - budget) / contract : null },
  };
}

export function paidToAssignment(assignmentId: string, movements: Pick<Movement, "kind" | "amount" | "project_sub_id">[]): number {
  return movements
    .filter((m) => m.kind === "sub_payment" && m.project_sub_id === assignmentId)
    .reduce((s, m) => s + n(m.amount), 0);
}

// ---------------------------------------------------------------- change orders (0008_change_orders.sql)

export type ChangeOrderStatus = "pending" | "approved" | "rejected";
export const CHANGE_ORDER_STATUSES: ChangeOrderStatus[] = ["pending", "approved", "rejected"];

export type ChangeOrder = {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string | null;
  status: ChangeOrderStatus;
  /** + more for the client to pay, − credit. */
  contract_delta: number;
  /** + more cost to deliver, − savings. */
  cost_delta: number;
  project_sub_id: string | null;
  /** Change to that assignment's agreed amount. */
  sub_delta: number | null;
  requested_on: string;
  decided_on: string | null;
  /** Who approved or rejected it, and exactly when (set by the database, 0009). */
  decided_by: string | null;
  decided_at: string | null;
  decider?: { full_name: string | null; email: string | null } | null;
  reference: string | null;
  created_at: string;
};

export const CHANGE_ORDER_COLUMNS =
  "id, project_id, number, title, description, status, contract_delta, cost_delta, project_sub_id, sub_delta, requested_on, decided_on, decided_by, decided_at, reference, created_at, decider:profiles(full_name, email)";

type CoAmounts = Pick<ChangeOrder, "project_id" | "status" | "contract_delta" | "cost_delta" | "project_sub_id" | "sub_delta">;

/** Base + delta, keeping "no amount" when there is nothing to add. */
function plus(base: number | null, delta: number): number | null {
  return delta === 0 ? base : n(base) + delta;
}

/** Sum of approved (or pending) change orders: to the contract, to the cost, and per assignment. */
export function changeOrderSums(orders: CoAmounts[], status: ChangeOrderStatus = "approved") {
  const bySub = new Map<string, number>();
  let contract = 0;
  let cost = 0;
  for (const o of orders) {
    if (o.status !== status) continue;
    contract += n(o.contract_delta);
    cost += n(o.cost_delta);
    if (o.project_sub_id && o.sub_delta !== null) bySub.set(o.project_sub_id, (bySub.get(o.project_sub_id) ?? 0) + n(o.sub_delta));
  }
  return { contract, cost, bySub };
}

/** The project's current contract and budget: original amounts plus its approved change orders. */
export function withChangeOrders<P extends Pick<Project, "id" | "contract_amount" | "budgeted_cost">>(project: P, orders: CoAmounts[]): P {
  const s = changeOrderSums(orders.filter((o) => o.project_id === project.id));
  return { ...project, contract_amount: plus(project.contract_amount, s.contract), budgeted_cost: plus(project.budgeted_cost, s.cost) };
}

/** Each assignment's current agreed amount (original plus approved change orders), keeping the original. */
export function assignmentsWithChangeOrders<A extends Pick<ProjectSub, "id" | "agreed_amount">>(
  assignments: A[],
  orders: CoAmounts[]
): (A & { base_agreed: number | null })[] {
  const { bySub } = changeOrderSums(orders);
  return assignments.map((a) => ({ ...a, base_agreed: a.agreed_amount, agreed_amount: plus(a.agreed_amount, bySub.get(a.id) ?? 0) }));
}
