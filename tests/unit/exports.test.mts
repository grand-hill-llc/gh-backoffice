// CSV exports (src/lib/exports.ts): cells, formats and the four reports.
import { buildReport, csvCell, fileName, inRange, toCsv, usDate, type ExportData } from "../../src/lib/exports.ts";
import es from "../../src/i18n/es.ts";

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown) => { if (cond) pass++; else { fail++; console.log("FAIL", name); } };
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- cells and files
ok("plain", csvCell("Pintura") === "Pintura");
ok("comma quoted", csvCell("Lake Mary, FL") === '"Lake Mary, FL"');
ok("quote doubled", csvCell('5" trim') === '"5"" trim"');
ok("newline quoted", csvCell("a\nb") === '"a\nb"');
ok("null empty", csvCell(null) === "" && csvCell(undefined) === "");
ok("number plain", csvCell(1234.5) === "1234.5" && csvCell(-250) === "-250");
ok("number rounded", csvCell(0.1 + 0.2) === "0.3");
ok("formula neutralized", csvCell("=HYPERLINK(\"x\")") === `"'=HYPERLINK(""x"")"` && csvCell("+1 407") === "'+1 407" && csvCell("@x") === "'@x");
ok("negative number not neutralized", csvCell(-5) === "-5");
ok("excel has BOM and CRLF", toCsv(["A"], [[1]], "excel") === "﻿A\r\n1\r\n");
ok("quickbooks no BOM", toCsv(["A"], [[1]], "quickbooks") === "A\r\n1\r\n");
ok("us date", usDate("2026-03-07") === "03/07/2026");
ok("range", inRange("2026-05-01", { from: "2026-01-01", to: "2026-12-31" }) && !inRange("2025-12-31", { from: "2026-01-01", to: null }) && inRange("2020-01-01", { from: null, to: null }) && !inRange(null, { from: null, to: null }));
ok("file name dated", fileName("movements", "quickbooks", { from: "2026-01-01", to: "2026-11-25" }, "2026-11-25") === "grandhill-movimientos_2026-01-01_a_2026-11-25-quickbooks.csv");
ok("file name undated", fileName("projects", "excel", { from: "2026-01-01", to: null }, "2026-11-25") === "grandhill-proyectos_2026-11-25.csv");

// ---- data
const d: ExportData = {
  projects: [
    { id: "p1", name: "Oficinas Maitland", status: "in_progress", location: "Maitland, FL", start_date: "2026-10-01", end_date: null, contract_amount: 72000, budgeted_cost: 55400, client: { name: "Brasfield" } },
    { id: "p2", name: "Lobby", status: "completed", location: null, start_date: null, end_date: null, contract_amount: null, budgeted_cost: null, client: null },
  ],
  assignments: [
    { id: "a1", project_id: "p1", subcontractor_id: "s1", agreed_amount: 38000 },
    { id: "a2", project_id: "p1", subcontractor_id: "s2", agreed_amount: null },
  ],
  movements: [
    { id: "m1", project_id: "p1", kind: "receipt", project_sub_id: null, amount: 21600, occurred_on: "2026-10-05", reference: "Dep 30%", notes: null },
    { id: "m2", project_id: "p1", kind: "sub_payment", project_sub_id: "a1", amount: 15000, occurred_on: "2026-10-20", reference: "Chk 1042", notes: "Avance, 1" },
    { id: "m3", project_id: "p1", kind: "expense", project_sub_id: null, amount: 3120.75, occurred_on: "2026-11-02", reference: null, notes: null },
    { id: "m4", project_id: "p1", kind: "sub_payment", project_sub_id: "a1", amount: 5000, occurred_on: "2025-12-20", reference: null, notes: null },
  ],
  orders: [
    { project_id: "p1", number: 2, title: "Extra wall", description: null, status: "pending", contract_delta: 900, cost_delta: 700, project_sub_id: null, sub_delta: null, requested_on: "2026-11-10", decided_on: null, reference: null, decider: null },
    { project_id: "p1", number: 1, title: "Paint fence", description: "Two coats", status: "approved", contract_delta: 3000, cost_delta: 2000, project_sub_id: "a1", sub_delta: 2000, requested_on: "2026-10-15", decided_on: "2026-10-16", reference: "CO-1", decider: { full_name: "Adrian", email: "a@x.co" } },
  ],
  subs: [
    { id: "s2", company_name: "Zen Construction", legal_name: null, trades: ["stucco"], contact_name: null, email: null, phone: null, city: null, state: "FL", status: "active" },
    { id: "s1", company_name: "Ashton Painting", legal_name: "Ashton Painting LLC", trades: ["painting", "Wallpaper"], contact_name: "Ash", email: "a@ash.co", phone: "+1 407 555 0100", city: "Orlando", state: "FL", status: "active" },
  ],
};
const year = { from: "2026-01-01", to: "2026-12-31" };
const trade = (v: string) => (es.subs.trades as Record<string, string>)[v] ?? v;

// ---- movements
const mx = buildReport("movements", d, year, "excel", es, trade);
ok("movements excel headers", eq(mx.headers, ["Fecha", "Tipo", "Proyecto", "Cliente", "Subcontratista", "Entrada", "Salida", "Referencia", "Notas"]));
ok("movements in range, by date", eq(mx.rows.map((r) => r[0]), ["2026-10-05", "2026-10-20", "2026-11-02"]));
ok("receipt in money in", eq(mx.rows[0].slice(1, 7), ["Cobro", "Oficinas Maitland", "Brasfield", null, 21600, null]));
ok("sub payment with sub, money out", mx.rows[1][4] === "Ashton Painting" && mx.rows[1][5] === null && mx.rows[1][6] === 15000);
const mq = buildReport("movements", d, year, "quickbooks", es, trade);
ok("qb headers", eq(mq.headers, ["Date", "Description", "Amount"]));
ok("qb receipt positive", eq(mq.rows[0], ["10/05/2026", "Cobro · Oficinas Maitland · Referencia Dep 30%", 21600]));
ok("qb payment negative", mq.rows[1][2] === -15000 && mq.rows[1][1] === "Pago a sub · Oficinas Maitland · Ashton Painting · Referencia Chk 1042");
ok("qb expense negative", mq.rows[2][2] === -3120.75);
ok("all time includes 2025", buildReport("movements", d, { from: null, to: null }, "excel", es, trade).rows.length === 4);

// ---- projects
const px = buildReport("projects", d, year, "quickbooks", es, trade);
ok("projects always excel", px.headers[0] === "Proyecto" && px.rows.length === 2);
const p1 = px.rows.find((r) => r[0] === "Oficinas Maitland")!;
const col = (name: string) => px.headers.indexOf(name);
ok("original and changes", p1[col("Contrato original")] === 72000 && p1[col("Cambios aprobados")] === 3000 && p1[col("Contrato actual")] === 75000);
ok("budget with approved cost", p1[col("Costo estimado")] === 57400);
ok("collected and to collect", p1[col("Cobrado")] === 21600 && p1[col("Por cobrar")] === 53400);
ok("committed with sub change", p1[col("Comprometido con subs")] === 40000);
ok("paid subs all time", p1[col("Pagado a subs")] === 20000 && p1[col("Gastos")] === 3120.75);
ok("margin", p1[col("Margen estimado")] === 17600 && p1[col("Margen estimado %")] === 23.5);
const p2 = px.rows.find((r) => r[0] === "Lobby")!;
ok("no contract → blanks", p2[col("Contrato original")] === null && p2[col("Cambios aprobados")] === null && p2[col("Margen estimado")] === null && p2[col("Margen estimado %")] === null);
ok("status label", p2[col("Estado")] === "Terminado");

// ---- change orders
const cx = buildReport("changeOrders", d, year, "excel", es, trade);
ok("orders by project and number", eq(cx.rows.map((r) => r[2]), ["CO 1", "CO 2"]));
const c1 = cx.rows[0];
ok("order fields", c1[4] === "Aprobada" && c1[7] === "Adrian" && c1[8] === 3000 && c1[10] === "Ashton Painting" && c1[11] === 2000 && c1[13] === "Two coats");
ok("orders filtered by request date", buildReport("changeOrders", d, { from: "2026-11-01", to: null }, "excel", es, trade).rows.length === 1);

// ---- subcontractors
const sx = buildReport("subcontractors", d, year, "excel", es, trade);
ok("subs sorted", sx.rows[0][0] === "Ashton Painting" && sx.rows[1][0] === "Zen Construction");
const s1 = sx.rows[0];
const sc = (name: string) => sx.headers.indexOf(name);
ok("trades labeled", s1[sc("Oficios")] === `${es.subs.trades.painting}, Wallpaper`);
ok("agreed with change order", s1[sc("Acordado")] === 40000 && s1[sc("Proyectos")] === 1);
ok("paid total vs period", s1[sc("Pagado (total)")] === 20000 && s1[sc("Pagado en el periodo")] === 15000);
ok("owed", s1[sc("Por pagar")] === 20000);
ok("sub without agreed amount", sx.rows[1][sc("Acordado")] === 0 && sx.rows[1][sc("Por pagar")] === 0 && sx.rows[1][sc("Proyectos")] === 1);
const sq = buildReport("subcontractors", d, year, "quickbooks", es, trade);
ok("qb vendors", eq(sq.headers, ["Name", "Company", "Email", "Phone", "City", "State", "Country"]) && eq(sq.rows[0], ["Ashton Painting", "Ashton Painting LLC", "a@ash.co", "+1 407 555 0100", "Orlando", "FL", "USA"]));
ok("qb company falls back to name", sq.rows[1][1] === "Zen Construction");
ok("csv of qb vendors", toCsv(sq.headers, sq.rows, "quickbooks").split("\r\n")[1] === "Ashton Painting,Ashton Painting LLC,a@ash.co,'+1 407 555 0100,Orlando,FL,USA");

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
