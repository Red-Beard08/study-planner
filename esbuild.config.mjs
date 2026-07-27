/* Builds the plugin entry point into the main.js file loaded by Obsidian. */
import esbuild from "esbuild";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  banner: { js: "/* Study Planner: Markdown-first Bible-study administration for Obsidian. */" },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js"
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
