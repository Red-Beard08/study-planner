/* Verifies representative recurrence calculations against known calendar dates. */
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outfile = path.join(os.tmpdir(), `mens-study-recurrence-${process.pid}.mjs`);
await esbuild.build({ entryPoints: ["src/utils.ts"], outfile, bundle: true, format: "esm", platform: "node" });
const { cleanRootFolder, nextScheduledDate, scheduledDates } = await import(`${pathToFileURL(outfile).href}?v=${Date.now()}`);

const cases = [
  ["monthly-first-third", "2025-12-31", "2026-01-02"],
  ["monthly-first-third", "2026-01-02", "2026-01-16"],
  ["monthly-first-third", "2026-01-16", "2026-02-06"],
  ["monthly-second-fourth", "2025-12-31", "2026-01-09"],
  ["monthly-second-fourth", "2026-01-09", "2026-01-23"],
  ["monthly-last", "2025-12-31", "2026-01-30"],
  ["biweekly", "2026-01-02", "2026-01-16"]
];

for (const [recurrence, after, expected] of cases) {
  const actual = nextScheduledDate("2026-01-01", "2026-03-31", recurrence, 5, after);
  if (actual !== expected) throw new Error(`${recurrence} after ${after}: expected ${expected}, received ${actual}`);
}

const fallDates = scheduledDates("2026-09-04", "2026-12-04", "monthly-first-third", 5);
const expectedFallDates = ["2026-09-04", "2026-09-18", "2026-10-02", "2026-10-16", "2026-11-06", "2026-11-20", "2026-12-04"];
if (JSON.stringify(fallDates) !== JSON.stringify(expectedFallDates)) throw new Error(`Fall schedule mismatch: ${JSON.stringify(fallDates)}`);
if (cleanRootFolder(" /Ministry//Studies/ ") !== "Ministry/Studies") throw new Error("Root path normalization failed.");
if (cleanRootFolder("../Private") !== "Study Planner") throw new Error("Unsafe root path was not rejected.");

fs.rmSync(outfile, { force: true });
console.log("Validated recurrence calculations and root paths.");
