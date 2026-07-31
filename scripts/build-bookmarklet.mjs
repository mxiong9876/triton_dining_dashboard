/*
 * Minifies eaccounts-bookmarklet.src.js and rewrites the pasteable one-liner
 * inside eaccounts-bookmarklet.js. Run: npm run build:bookmarklet
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "eaccounts-bookmarklet.src.js");
const out = join(here, "eaccounts-bookmarklet.js");

// target=es5 matters: at newer targets esbuild rewrites "a\nb" into a template
// literal containing a REAL newline, and a bookmark URL is truncated at the first
// newline. ES5 has no template literals, so the escapes survive.
const min = execFileSync("npx", ["esbuild", src, "--minify", "--format=iife", "--target=es5"], {
  encoding: "utf8",
}).trim();

if (/[\r\n]/.test(min)) {
  console.error("refusing to write: minified output contains a newline, which breaks bookmark URLs");
  process.exit(1);
}

const line = "javascript:" + min;
const doc = readFileSync(out, "utf8");
const marker = "BOOKMARKLET — generated, do not edit by hand";
const head = doc.slice(0, doc.indexOf(marker) + marker.length);
writeFileSync(out, `${head}\n *\n${line}\n *\n */\n`);

console.log(`bookmarklet: ${line.length} chars written to ${out}`);
