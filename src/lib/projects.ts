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
