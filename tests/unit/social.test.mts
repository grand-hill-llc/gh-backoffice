import { dayOf, isoToLocal, localToIso, mediaPathFor, monthGrid, postDate, postWarnings, shiftMonth } from "../../src/lib/social.ts";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => { if (cond) pass++; else { fail++; console.log("FAIL", label); } };

// Florida time, both sides of daylight saving
ok("winter is UTC-5", localToIso("2026-01-15T10:30") === "2026-01-15T15:30:00.000Z");
ok("summer is UTC-4", localToIso("2026-07-04T09:00") === "2026-07-04T13:00:00.000Z");
ok("day DST starts", localToIso("2026-03-08T12:00") === "2026-03-08T16:00:00.000Z");
ok("day DST ends", localToIso("2026-11-01T12:00") === "2026-11-01T17:00:00.000Z");
ok("round trip", isoToLocal(localToIso("2026-11-28T18:45")) === "2026-11-28T18:45");
ok("round trip summer", isoToLocal("2026-07-04T13:00:00.000Z") === "2026-07-04T09:00");
ok("late evening stays on its Florida day", dayOf("2026-12-01T03:30:00Z") === "2026-11-30");

// calendar
const nov = monthGrid("2026-11");
ok("weeks start Monday", nov[0].day === "2026-10-26" && !nov[0].inMonth);
ok("whole weeks", nov.length % 7 === 0 && nov.length === 42);
ok("month days flagged", nov.filter((d) => d.inMonth).length === 30);
ok("month starting Monday has no padding", monthGrid("2026-06")[0].day === "2026-06-01");
ok("shift across years", shiftMonth("2026-12", 1) === "2027-01" && shiftMonth("2026-01", -1) === "2025-12");
ok("published posts sit on their publish date", postDate({ status: "published", published_at: "b", scheduled_at: "a" }) === "b");
ok("others on the planned date", postDate({ status: "scheduled", published_at: null, scheduled_at: "a" }) === "a");

// warnings
const base = { body: "Hola", channels: ["facebook" as const], scheduled_at: "2030-01-01T00:00:00Z", status: "scheduled" as const };
ok("clean post has no warnings", postWarnings(base, []).length === 0);
const ig = postWarnings({ ...base, channels: ["instagram"] }, []);
ok("instagram needs an image or video", ig.some((w) => w.kind === "instagramNeedsMedia"));
ok("instagram caption limit", postWarnings({ ...base, channels: ["instagram", "facebook"], body: "x".repeat(2201) }, [{ mime_type: "image/jpeg" }]).map((w) => w.kind).join() === "tooLong");
ok("google limit", postWarnings({ ...base, channels: ["google"], body: "x".repeat(1501) }, []).some((w) => w.kind === "tooLong" && w.channel === "google"));
ok("emoji counted as one", postWarnings({ ...base, channels: ["google"], body: "🏠".repeat(1500) }, []).length === 0);
ok("instagram wants jpeg", postWarnings({ ...base, channels: ["instagram"] }, [{ mime_type: "image/png" }]).some((w) => w.kind === "instagramFormat"));
ok("instagram max 10", postWarnings({ ...base, channels: ["instagram"] }, Array(11).fill({ mime_type: "image/jpeg" })).some((w) => w.kind === "instagramTooMany"));
ok("past date warned", postWarnings({ ...base, scheduled_at: "2020-01-01T00:00:00Z" }, []).some((w) => w.kind === "inPast"));
ok("published in the past is fine", postWarnings({ ...base, status: "published", scheduled_at: "2020-01-01T00:00:00Z" }, []).length === 0);

// storage path
const path = mediaPathFor("p1", "Fotó final (1).JPG");
ok("path inside post folder, safe name", path.startsWith("p1/") && path.endsWith("/Foto_final_1_.JPG"));

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
