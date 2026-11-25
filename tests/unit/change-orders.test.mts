import { assignmentsWithChangeOrders, changeOrderSums, totalsOf, withChangeOrders } from "../../src/lib/projects.ts";
import { signedMoney } from "../../src/lib/sales.ts";
let pass = 0, fail = 0;
const ok = (n: string, c: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", n); } };
const co = (o: any) => ({ project_id: "p1", status: "approved", contract_delta: 0, cost_delta: 0, project_sub_id: null, sub_delta: null, ...o });
const orders = [
  co({ contract_delta: 5000, cost_delta: 3000, project_sub_id: "a1", sub_delta: 2500 }),
  co({ contract_delta: -1000, cost_delta: -800 }),
  co({ status: "pending", contract_delta: 999, project_sub_id: "a1", sub_delta: 111 }),
  co({ status: "rejected", contract_delta: 7777 }),
  co({ project_id: "p2", contract_delta: 100 }),
];
const p = withChangeOrders({ id: "p1", contract_amount: 100000, budgeted_cost: 70000 }, orders);
ok("contract approved only", p.contract_amount === 104000);
ok("cost approved only", p.budgeted_cost === 72200);
ok("other project untouched", withChangeOrders({ id: "p3", contract_amount: 10, budgeted_cost: null }, orders).contract_amount === 10);
ok("null stays null without changes", withChangeOrders({ id: "p3", contract_amount: null, budgeted_cost: null }, orders).budgeted_cost === null);
ok("null + change = change", withChangeOrders({ id: "p2", contract_amount: null, budgeted_cost: null }, orders).contract_amount === 100);
const as = assignmentsWithChangeOrders([{ id: "a1", agreed_amount: 20000 }, { id: "a2", agreed_amount: 9000 }, { id: "a3", agreed_amount: null }], orders);
ok("sub current", as[0].agreed_amount === 22500 && as[0].base_agreed === 20000);
ok("sub untouched", as[1].agreed_amount === 9000 && as[2].agreed_amount === null);
const pend = changeOrderSums(orders, "pending");
ok("pending sums", pend.contract === 999 && pend.bySub.get("a1") === 111);
const t = totalsOf(p, as, [{ kind: "sub_payment", amount: 21000, project_sub_id: "a1" }]);
ok("owed uses current agreed", t.owedToSubs === 1500 + 9000);
ok("margin uses current", t.plannedMargin?.amount === 104000 - 72200);
ok("committed uses current", t.committed === 31500);
ok("signed", signedMoney(1200, "en-US") === "+$1,200" && signedMoney(-300.5, "en-US") === "−$300.50");
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
