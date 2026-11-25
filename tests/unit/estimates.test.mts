import { cents, cheapestQuotes, estimateTotals, lineAmounts } from "../../src/lib/estimates.ts";
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
console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
