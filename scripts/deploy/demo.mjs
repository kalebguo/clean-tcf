#!/usr/bin/env node
/*
 * The public demo: the demo bank as static files on Cloudflare Workers (wrangler.demo.jsonc).
 * No login, no database, no service worker; records stay in the visitor's browser.
 *
 *   node scripts/deploy/demo.mjs           build into dist-demo/, then wrangler deploy
 *   node scripts/deploy/demo.mjs --stage   build only
 *
 * It refuses unless public/data holds exactly the demo bank (copied by scripts/demo/use.mjs),
 * so a real bank is never published here. iCloud copies ("data 2") are left out.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "dist-demo");
const ICLOUD_COPY = / \d+(\.[^.]+)?$/;
const BANK = ["listening.json", "reading.json", "oral-writing.json"];

const same = (a, b) => fs.existsSync(a) && fs.existsSync(b) && fs.readFileSync(a).equals(fs.readFileSync(b));
const isDemo = (dir) => BANK.every((f) => same(path.join(dir, f), path.join(ROOT, "demo/public/data", f)));

if (!isDemo(path.join(ROOT, "public/data"))) {
  console.error("public/data 不是示例题库，拒绝发布。先运行 node scripts/demo/use.mjs。");
  process.exit(1);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

fs.rmSync(OUT, { recursive: true, force: true });
run("npx", ["vite", "build", "--mode", "demo", "--outDir", OUT]);

let dropped = 0;
(function prune(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (ICLOUD_COPY.test(e.name) || e.name === ".DS_Store") {
      fs.rmSync(p, { recursive: true, force: true });
      dropped++;
    } else if (e.isDirectory()) prune(p);
  }
})(OUT);
fs.rmSync(path.join(OUT, "data/.demo"), { force: true });

if (!isDemo(path.join(OUT, "data"))) {
  console.error("dist-demo/data 不是示例题库，拒绝发布。");
  process.exit(1);
}
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) (e.isDirectory() ? walk : (p) => files.push(p))(path.join(dir, e.name));
})(OUT);
const mb = files.reduce((n, f) => n + fs.statSync(f).size, 0) / 1e6;
console.log(`dist-demo: ${files.length} files, ${mb.toFixed(1)} MB` + (dropped ? `; left out ${dropped} iCloud copies` : ""));

if (!process.argv.includes("--stage")) run("npx", ["wrangler", "deploy", "--config", "wrangler.demo.jsonc"]);
