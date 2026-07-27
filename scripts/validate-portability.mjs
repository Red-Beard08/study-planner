/* Scans the public source tree for private-build names, local paths, and release-only artifacts. */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const self = path.normalize("scripts/validate-portability.mjs");
const ignoredDirectories = new Set([".git", "node_modules"]);
const ignoredFiles = new Set(["main.js", self]);
const forbiddenText = [
  ["Men's", "Study", "Planner"].join(" "),
  ["mens", "study", "planner"].join("-"),
  ["Shepherd's", "Ledger"].join(" "),
  ["shepherds", "ledger"].join("-"),
  ["Collections", ""].join("/"),
  ["Red", "Beard"].join("-"),
  ["i", "Cloud"].join("")
];
const localUserPath = new RegExp(["C:", "Users"].join("\\\\"), "i");
const failures = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const relative = path.normalize(path.relative(root, absolute));
    if (entry.isDirectory()) {
      visit(absolute);
      continue;
    }
    if (ignoredFiles.has(relative) || ignoredFiles.has(entry.name)) continue;
    const content = fs.readFileSync(absolute, "utf8");
    for (const term of forbiddenText) {
      if (content.includes(term)) failures.push(`${relative} contains a private or former reference.`);
    }
    if (localUserPath.test(content)) failures.push(`${relative} contains a local Windows user path.`);
    if (content.includes(".vault.modify(")) failures.push(`${relative} uses Vault.modify instead of Vault.process.`);
  }
}

visit(root);
if (failures.length) throw new Error([...new Set(failures)].join("\n"));
console.log("Validated Study Planner portability.");
