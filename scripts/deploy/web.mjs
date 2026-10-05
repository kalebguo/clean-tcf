#!/usr/bin/env node
/*
 * Build and deploy the web version behind Cloudflare Access (SPEC §K).
 *
 *   node scripts/deploy/web.mjs            build, stage, deploy to Cloudflare
 *   node scripts/deploy/web.mjs --stage    build and stage only (dist-web/)
 *   node scripts/deploy/web.mjs --dev      build, stage, run locally (wrangler dev, local D1, DEV_EMAIL from .dev.vars)
 *
 * Steps:
 *   1. vite build (vite.web.config.ts) → dist-web/
 *   2. stage public/data (all), public/media (only what the bank uses), public/media-tts;
 *      hard links, so no extra disk space; iCloud copies ("name 2.json") are left out
 *   3. data/offline.json: the media of each section and level, for the per-level downloads
 *   4. manifest and icons (web/)
 *   5. service worker (Workbox): app and text data precached; media cached on use or download
 *   6. wrangler deploy (only when the Access team domain and AUD are set in wrangler.jsonc)
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateSW } from "workbox-build";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "dist-web");
const mode = process.argv.includes("--dev") ? "dev" : process.argv.includes("--stage") ? "stage" : "deploy";

/** Workers static assets: at most 20 000 files and 25 MiB per file (free plan). */
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** "CE-1-01 2.json": a second copy made by iCloud. */
const ICLOUD_COPY = / \d+(\.[^.]+)?$/;

const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });

function link(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { force: true });
  try {
    fs.linkSync(fs.realpathSync(src), dst);
  } catch {
    fs.copyFileSync(src, dst); // another volume
  }
  return fs.statSync(dst).size;
}

function stageTree(src, dst) {
  let n = 0;
  let bytes = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || e.name.startsWith(".") || ICLOUD_COPY.test(e.name)) continue;
    const from = path.join(e.parentPath, e.name);
    bytes += link(from, path.join(dst, path.relative(src, from)));
    n++;
  }
  return { n, bytes };
}

function check(ok, message) {
  if (!ok) {
    console.error(message);
    process.exit(1);
  }
}

// 1. build
run("npx", ["vite", "build", "--config", "vite.web.config.ts", "--mode", "web"]);

// 2. stage
const report = { data: stageTree(path.join(PUBLIC, "data"), path.join(OUT, "data")) };
const bank = Object.fromEntries(
  ["listening", "reading"].map((name) => [name, JSON.parse(fs.readFileSync(path.join(PUBLIC, "data", `${name}.json`), "utf8")).questions]),
);
const groups = new Map(); // "CO A1" → { section, level, files: Set, bytes }
const missing = [];
let media = { n: 0, bytes: 0 };
let tts = { n: 0, bytes: 0 };
const staged = new Map(); // url → bytes
for (const q of [...bank.listening, ...bank.reading]) {
  const key = `${q.section} ${q.level}`;
  if (!groups.has(key)) groups.set(key, { section: q.section, level: q.level, files: new Set() });
  const urls = [];
  for (const f of [q.audio, q.image].filter(Boolean)) {
    const src = path.join(PUBLIC, "media", f);
    if (!fs.existsSync(src)) {
      missing.push(f);
      continue;
    }
    urls.push([`/media/${f}`, src]);
  }
  const read = path.join(PUBLIC, "media-tts", `${q.id}.m4a`);
  if (q.section === "CE" && fs.existsSync(read)) urls.push([`/media-tts/${q.id}.m4a`, read]);
  for (const [url, src] of urls) {
    groups.get(key).files.add(url);
    if (staged.has(url)) continue;
    const bytes = link(src, path.join(OUT, url));
    staged.set(url, bytes);
    const r = url.startsWith("/media-tts/") ? tts : media;
    r.n++;
    r.bytes += bytes;
  }
}
report.media = media;
report["media-tts"] = tts;
check(!missing.length, `missing from public/media: ${missing.length} files, e.g. ${missing.slice(0, 3).join(", ")}`);

// 3. per-level offline downloads
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const offline = [...groups.values()]
  .sort((a, b) => a.section.localeCompare(b.section) * -1 || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)) // CO first
  .map((g) => {
    const files = [...g.files].sort();
    return { section: g.section, level: g.level, files, bytes: files.reduce((s, f) => s + staged.get(f), 0) };
  });
fs.writeFileSync(path.join(OUT, "data", "offline.json"), JSON.stringify({ groups: offline }));

// 4. manifest and icons
report.web = stageTree(path.join(ROOT, "web"), OUT);

// 5. service worker
const sw = await generateSW({
  globDirectory: OUT,
  globPatterns: ["**/*.{html,js,css,woff2,webmanifest}", "icons/*.png", "data/**/*.json"],
  globIgnores: ["media/**", "media-tts/**", "sw.js", "workbox-*.js"],
  swDest: path.join(OUT, "sw.js"),
  maximumFileSizeToCacheInBytes: MAX_FILE_BYTES,
  dontCacheBustURLsMatching: /^assets\//,
  navigateFallback: "/index.html",
  navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//],
  clientsClaim: true,
  skipWaiting: false, // the page asks (SKIP_WAITING) when the learner chooses to update
  cleanupOutdatedCaches: true,
  runtimeCaching: [
    {
      urlPattern: ({ url }) => url.pathname.startsWith("/media/") || url.pathname.startsWith("/media-tts/"),
      handler: "CacheFirst",
      options: { cacheName: "media", rangeRequests: true, cacheableResponse: { statuses: [200] } },
    },
  ],
});
for (const w of sw.warnings) console.warn("workbox:", w);
report.precache = { n: sw.count, bytes: sw.size };

// report and limits
let files = 0;
let largest = { f: "", bytes: 0 };
for (const e of fs.readdirSync(OUT, { withFileTypes: true, recursive: true })) {
  if (!e.isFile()) continue;
  files++;
  const bytes = fs.statSync(path.join(e.parentPath, e.name)).size;
  if (bytes > largest.bytes) largest = { f: path.relative(OUT, path.join(e.parentPath, e.name)), bytes };
}
for (const [name, r] of Object.entries(report)) console.log(`${name.padEnd(10)} ${String(r.n).padStart(6)} files ${(r.bytes / 1e6).toFixed(0).padStart(7)} MB`);
console.log(`dist-web   ${String(files).padStart(6)} files; largest ${largest.f} ${(largest.bytes / 1e6).toFixed(1)} MB`);
check(files <= MAX_FILES, `too many files for Workers static assets: ${files} > ${MAX_FILES}`);
check(largest.bytes <= MAX_FILE_BYTES, `${largest.f} is larger than 25 MiB`);

// 6. run or deploy
if (mode === "dev") {
  run("npx", ["wrangler", "d1", "migrations", "apply", "tcf-sync", "--local"]);
  run("npx", ["wrangler", "dev", "--port", "8787"]);
} else if (mode === "deploy") {
  // without Access the whole question bank would be public: refuse
  const conf = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  check(/"ACCESS_TEAM_DOMAIN":\s*"[^"]+"/.test(conf) && /"ACCESS_AUD":\s*"[^"]+"/.test(conf), "set ACCESS_TEAM_DOMAIN and ACCESS_AUD in wrangler.jsonc first (SPEC §K)");
  run("npx", ["wrangler", "deploy"]);
}
