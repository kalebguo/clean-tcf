#!/usr/bin/env node
/*
 * `npm run demo`: copy the demo bank (demo/public/, built by scripts/demo/build.py) into public/,
 * then the dev server shows it. A bank of your own in public/ is never overwritten:
 * public/data/.demo marks a copy made here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "demo/public");
const PUBLIC = path.join(ROOT, "public");
const MARK = path.join(PUBLIC, "data/.demo");

const own = fs.existsSync(path.join(PUBLIC, "data/listening.json")) && !fs.existsSync(MARK);
const linked = ["media", "media-tts"].some((d) => fs.lstatSync(path.join(PUBLIC, d), { throwIfNoEntry: false })?.isSymbolicLink());
if (own || linked) {
  console.error("public/ 里已经有你自己的题库，示例数据不会覆盖它。要看示例，请在另一个目录里 clone 本仓库。");
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error("没有 demo/public/。请先拉取完整的仓库。");
  process.exit(1);
}
for (const d of ["data", "media", "media-tts"]) {
  fs.rmSync(path.join(PUBLIC, d), { recursive: true, force: true });
  if (fs.existsSync(path.join(SRC, d))) fs.cpSync(path.join(SRC, d), path.join(PUBLIC, d), { recursive: true });
}
fs.writeFileSync(MARK, "copied from demo/public by `npm run demo`\n");
console.log("示例题库已复制到 public/。");
