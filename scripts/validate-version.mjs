/* Confirms a requested release version matches every Obsidian package metadata file. */
import fs from "node:fs";

const requested = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(requested ?? "")) throw new Error("Provide a semantic version such as 1.0.0.");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
if (manifest.version !== requested || packageJson.version !== requested) {
  throw new Error(`Requested ${requested}; package metadata contains ${packageJson.version} and ${manifest.version}.`);
}
if (versions[requested] !== manifest.minAppVersion) throw new Error("versions.json does not match the manifest.");
console.log(`Validated release version ${requested}.`);
