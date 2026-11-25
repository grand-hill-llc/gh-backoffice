// Runs every test file in tests/sql and tests/unit, one process each, and fails if any fails.
// Usage: npm test            (all)
//        npm test -- alerts  (only files whose name contains "alerts")
//
// SQL tests run the real migrations in an in-memory Postgres (PGlite): no Supabase, no network.
// Unit tests import the app's TypeScript directly (Node 22.6+ strips the types).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const filter = process.argv[2] ?? "";
const files = ["sql", "unit"].flatMap((group) =>
  readdirSync(`${dir}${group}`)
    .filter((f) => /\.test\.m[jt]s$/.test(f) && f.includes(filter))
    .sort()
    .map((f) => `${group}/${f}`),
);

if (!files.length) {
  console.error(`No test files match "${filter}".`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const args = file.endsWith(".mts") ? ["--experimental-strip-types", "--no-warnings", file] : [file];
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`.trim();
  const summary = out.split("\n").filter((l) => /passed/.test(l)).pop() ?? "(no summary)";
  const okRun = r.status === 0;
  if (!okRun) failed++;
  console.log(`${okRun ? "ok  " : "FAIL"}  ${file.padEnd(36)} ${summary}`);
  if (!okRun) console.log(out.split("\n").map((l) => `      ${l}`).join("\n"));
}

console.log(failed ? `\n${failed} of ${files.length} files failed.` : `\nAll ${files.length} files passed.`);
process.exit(failed ? 1 : 0);
