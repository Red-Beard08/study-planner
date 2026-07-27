/* Validates Study Planner's compiled release files and mobile-safe manifest contract. */
import fs from "node:fs";

for (const file of ["manifest.json", "main.js", "styles.css", "versions.json", "README.md"]) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
}

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const bundle = fs.readFileSync("main.js", "utf8");
const css = fs.readFileSync("styles.css", "utf8");
const failures = [];

if (manifest.id !== "study-planner") failures.push("Unexpected plugin id.");
if (manifest.name !== "Study Planner") failures.push("Unexpected plugin name.");
if (manifest.version !== packageJson.version) failures.push("package.json and manifest.json versions differ.");
if (versions[manifest.version] !== manifest.minAppVersion) failures.push("versions.json is inconsistent.");
if (manifest.isDesktopOnly !== false) failures.push("Manifest is not marked for mobile support.");
if (bundle.length < 5_000) failures.push("main.js appears unexpectedly small.");
if (/require\(["'](?:fs|path|electron|os|child_process)["']\)/.test(bundle)) {
  failures.push("main.js contains a desktop-only runtime import.");
}
if (!css.includes("100dvh") || !css.includes("safe-area-inset-bottom")) {
  failures.push("styles.css is missing mobile viewport or safe-area handling.");
}

for (const marker of [
  "Study Planner",
  "mens-study-season",
  "mens-study-meeting",
  "mens-study-goal",
  "Record attendance",
  "Plan next meeting",
  "monthly-first-third",
  "Create specific event/lesson",
  "study-planner:attendance:start",
  "study-planner:member:start"
]) {
  if (!bundle.includes(marker)) failures.push(`Bundle missing ${marker}`);
}

if (failures.length) throw new Error(failures.join("\n"));
console.log("Validated Study Planner release files.");
