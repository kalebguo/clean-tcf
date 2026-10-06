"""Copy the code (no exam content) into the public repository ../clean-tcf.

The public repo has its own history: this script replaces its files with the current code,
and you review and commit there. It never copies the bank, the generated content, the
specs with decision logs, or the iOS project.

Checks before it finishes:
  - leak scan: no 7-word sequence of any exam text (questions, options, transcripts,
    passages, prompts) appears in any copied text file, demo content included
  - the copy type-checks, its tests pass and the demo bank builds (`npm run build`)

Usage: python3 scripts/release/export_clean.py [--dest ../clean-tcf] [--no-verify]
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent

# what goes public (paths relative to the repo); directories are copied whole
INCLUDE = [
    "src", "worker", "migrations", "web", "docs", "demo",
    "index.html", "components.json", "tsconfig.json", "vite.config.ts", "vite.web.config.ts",
    "package.json", "package-lock.json", "wrangler.jsonc", "LICENSE",
    "scripts/data.sh", "scripts/export_anki.py", "scripts/build_site_data.py", "scripts/merge_ocr.py",
    "scripts/ocr.swift", "scripts/ocr_vlm.py", "scripts/vocab_mapreduce.py",
    "scripts/deploy", "scripts/demo", "scripts/release",
    "scripts/p2/build_p2.py", "scripts/p2/build_dict.py", "scripts/p2/build_forms.py", "scripts/p2/dict_brief.py",
    "scripts/p2/hant2hans.swift", "scripts/p2/local_mt.py", "scripts/p2/segment.py", "scripts/p2/tts.py",
    "scripts/p2/tts_synth.swift", "scripts/p2/align_audio.py", "scripts/p2/check_align.py", "scripts/p2/validate_gen.py",
]
READMES = {"README.public.md": "README.md", "README.public.zh-CN.md": "README.zh-CN.md"}
SKIP_PARTS = {"__pycache__", ".DS_Store"}
ICLOUD_COPY = re.compile(r" \d+(\.[^.]+)?$")  # "name 2.json": a copy made by iCloud

GITIGNORE = """node_modules
dist
dist-web
dist-ios
build
.venv
.wrangler
.dev.vars
*.tsbuildinfo
.DS_Store
# your own bank and everything built from it (root only: src/data and demo/public are code and demo)
/data/
/public/
"""


def copy(dest: Path) -> list[Path]:
    copied = []
    for rel in INCLUDE:
        src = REPO / rel
        files = [p for p in src.rglob("*") if p.is_file()] if src.is_dir() else [src]
        for p in files:
            r = p.relative_to(REPO)
            if SKIP_PARTS & set(r.parts) or ICLOUD_COPY.search(p.name):
                continue
            out = dest / r
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, out)
            copied.append(out)
    for src, out in READMES.items():
        shutil.copy2(REPO / src, dest / out)
    (dest / ".gitignore").write_text(GITIGNORE)
    return copied


def patch(dest: Path) -> None:
    pkg = json.loads((dest / "package.json").read_text())
    pkg["scripts"] = {k: v for k, v in pkg["scripts"].items() if not k.startswith("ios:")}
    pkg["scripts"]["demo"] = "node scripts/demo/use.mjs && vite"
    (dest / "package.json").write_text(json.dumps(pkg, indent=2, ensure_ascii=False) + "\n")
    w = (dest / "wrangler.jsonc").read_text()
    w = re.sub(r'"database_id":\s*"[^"]*"', '"database_id": "<npx wrangler d1 create tcf-sync 的输出>"', w)
    w = re.sub(r'"ACCESS_TEAM_DOMAIN":\s*"[^"]*"', '"ACCESS_TEAM_DOMAIN": ""', w)
    w = re.sub(r'"ACCESS_AUD":\s*"[^"]*"', '"ACCESS_AUD": ""', w)
    (dest / "wrangler.jsonc").write_text(w)


def words(text: str) -> list[str]:
    t = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return re.findall(r"[0-9a-zàâäçéèêëîïôöùûüÿœæ]+", t)


def exam_texts() -> list[str]:
    texts = []
    for p in [REPO / "data/questions.json"]:
        for q in json.loads(p.read_text())["questions"]:
            texts += [*(q.get("options") or []), *(q.get("transcript") or []), q.get("question") or "", *(q.get("passage") or [])]
    ow = REPO / "public/data/oral-writing.json"
    if ow.exists():
        d = json.loads(ow.read_text())
        for kind in ("speaking", "writing"):
            for s in d[kind]["subjects"]:
                texts += [s["text"], *(s.get("docs") or [])]
    return texts


# fixed exam instructions, the same in every prompt: not content
# everyday sentences that happen to occur in the bank too (checked by hand)
COMMON = {"mais il y a une différence entre"}
FORMULAS = ("posez des questions", "choisissez la bonne", "le document et la question", "extrait sonore et la question")


def leak_scan(files: list[Path], n: int = 7) -> list[str]:
    grams = set()
    for t in exam_texts():
        w = words(t)
        grams.update(" ".join(w[i:i + n]) for i in range(len(w) - n + 1))
    grams = {g for g in grams if not any(f in g for f in FORMULAS)} - COMMON
    hits = []
    for f in files:
        if f.suffix in {".mp3", ".m4a", ".png", ".jpg", ".jpeg", ".webp", ".woff2"}:
            continue
        try:
            w = words(f.read_text())
        except UnicodeDecodeError:
            continue
        found = {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)} & grams
        if found:
            hits.append(f"{f}: {len(found)} sequences, e.g. «{sorted(found)[0]}»")
    return hits


def verify(dest: Path) -> None:
    nm = dest / "node_modules"
    if not nm.exists():
        nm.symlink_to(REPO / "node_modules")  # ignored by git; saves an install
    for cmd in (["npx", "tsc", "-b", "--noEmit"], ["npx", "vitest", "run"], ["node", "scripts/demo/use.mjs"], ["npx", "vite", "build"]):
        print("$", " ".join(cmd))
        if subprocess.run(cmd, cwd=dest).returncode:
            sys.exit(f"failed in {dest}: {' '.join(cmd)}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", default=str(REPO.parent / "clean-tcf"))
    ap.add_argument("--no-verify", action="store_true")
    a = ap.parse_args()
    dest = Path(a.dest).resolve()
    dest.mkdir(parents=True, exist_ok=True)
    # replace everything except the public repo's own history and the local node_modules link
    for p in dest.iterdir():
        if p.name in {".git", "node_modules"}:
            continue
        shutil.rmtree(p) if p.is_dir() and not p.is_symlink() else p.unlink()
    files = copy(dest)
    patch(dest)
    hits = leak_scan([*files, *(dest / out for out in READMES.values())])
    if hits:
        print("exam text found in the copy:\n  " + "\n  ".join(hits))
        return 1
    print(f"copied {len(files)} files to {dest}; leak scan clean")
    if not a.no_verify:
        verify(dest)
    return 0


if __name__ == "__main__":
    sys.exit(main())
