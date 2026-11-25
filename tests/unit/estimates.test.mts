import { assignmentsFromEstimate, cents, cheapestQuotes, estimateTotals, lineAmounts } from "../../src/lib/estimates.ts";
let pass = 0, fail = 0;
const ok = (n: string, c: unknown) => { if (c) pass++; else { fail++; console.log("FAIL", n); } };
ok("simple", JSON.stringify(lineAmounts(1, 12500, 20)) === JSON.stringify({ cost: 12500, price: 15000 }));
ok("rounding", lineAmounts(3, 0.335, 0).cost === 1.01);
ok("cents half up", cents(1.005) === 1.01 && cents(2.675) === 2.68);
ok("zero markup", lineAmounts(2, 10, 0).price === 20);
const t = estimateTotals([{ cost_amount: 100, price_amount: 120 }, { cost_amount: 50, price_amount: 75 }]);
ok("totals", t.cost === 150 && t.price === 195 && t.margin === 45 && Math.abs((t.marginPct ?? 0) - 45 / 195) < 1e-9);
ok("empty totals", estimateTotals([]).marginPct === null);
const ch = cheapestQuotes([
  { id: "a", trade: "painting", amount: 12000 },
  { id: "b", trade: " Painting ", amount: 9000 },
  { id: "c", trade: "stucco", amount: 5000 },
  { id: "d", trade: "drywall", amount: 7000 },
  { id: "e", trade: "drywall", amount: 7000 },
]);
ok("cheapest per trade", ch.has("b") && !ch.has("a"));
ok("single quote not flagged", !ch.has("c"));
ok("ties both flagged", ch.has("d") && ch.has("e"));
const quotes = [
  { id: "q1", subcontractor_id: "s1", trade: "painting", reference: "P-100" },
  { id: "q2", subcontractor_id: "s2", trade: "stucco", reference: null },
  { id: "q3", subcontractor_id: "s1", trade: " Painting ", reference: "P-101" },
  { id: "q4", subcontractor_id: "s1", trade: null, reference: null },
];
const as = assignmentsFromEstimate([
  { position: 3, trade: "stucco", sub_quote_id: "q2", cost_amount: 5000 },
  { position: 1, trade: "painting", sub_quote_id: "q1", cost_amount: 10000.1 },
  { position: 2, trade: null, sub_quote_id: null, cost_amount: 800 },
  { position: 4, trade: "painting", sub_quote_id: "q3", cost_amount: 2000.2 },
  { position: 5, trade: "drywall", sub_quote_id: "q4", cost_amount: 300 },
  { position: 6, trade: "roof", sub_quote_id: "gone", cost_amount: 999 },
], quotes);
ok("groups by sub and trade", as.length === 3);
ok("order by first line", as[0].subcontractor_id === "s1" && as[0].trade === "painting" && as[1].subcontractor_id === "s2");
ok("sums line cost", as[0].agreed_amount === 12000.3);
ok("collects references", JSON.stringify(as[0].references) === JSON.stringify(["P-100", "P-101"]));
ok("falls back to line trade", as[2].trade === "drywall" && as[2].agreed_amount === 300);
ok("skips lines without quote", !as.some((a) => a.agreed_amount === 800 || a.agreed_amount === 999));
ok("empty", assignmentsFromEstimate([], []).length === 0);
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
