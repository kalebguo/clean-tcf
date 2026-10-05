"""Build the demo bank (demo/public/) from the invented questions in demo/src/.

The real pipeline runs unchanged on the demo questions, in a scratch copy of the project
(build/demo-root-*), so nothing of the real bank is read or overwritten:

  demo/src/co.json, ce.json       questions in the export_anki.py format ("speakers": a voice per transcript line)
  demo/src/gen/<id>.json          translations, analysis and evidence (scripts/p2/GEN_GUIDE.md format)
  demo/src/oral-writing.json      speaking / writing prompts, already in the site format

  1. data/questions.json from co.json + ce.json; sets "1" and "2" of each section
  2. listening audio: each transcript line read by its macOS voice (say), joined with pauses (ffmpeg)
  3. vocab_mapreduce.py, build_site_data.py           → public/data/{listening,reading,search-lemmas}.json
  4. build_dict.py (Wiktionary, build/dict-raw)        → dictionary of the demo words
  5. tts.py (reading aloud), align_audio.py (listening timeline), build_p2.py → public/data/p2, public/media-tts
  6. copy public/{data,media,media-tts} → demo/public/

--check stops after step 3 and validates demo/src/gen (for whoever writes demo content).

Needs the local tools of the full pipeline (README): .venv, build/dict-raw, build/tts-synth,
build/venv-align and the alignment models in ../models, ffmpeg.

Usage: .venv/bin/python scripts/demo/build.py [--check]
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
SRC = REPO / "demo/src"
OUT = REPO / "demo/public"
PY = str(REPO / ".venv/bin/python")
ALIGN_PY = str(REPO / "build/venv-align/bin/python")
LEVEL_POINTS = {"A1": 3, "A2": 9, "B1": 15, "B2": 21, "C1": 26, "C2": 33}
# scripts look for these next to the project root (ROOT.parent); the scratch roots live in build/
BESIDE_ROOT = ["提香法语（超大词汇）.txt", "models"]
LINKED = ["build/dict-raw", "build/hant2hans", "build/tts-synth"]
COPIED = ["data/lemma_map.json", "data/p2/dict/brief.json", "data/p2/dict/phrases.json", "data/p2/dict/conj.json"]
PAUSE, QUESTION_PAUSE = 0.7, 1.5  # seconds between lines; before the question read at the end


def run(root: Path, *args: str, ok_codes=(0,)) -> None:
    r = subprocess.run(list(args), cwd=root)
    if r.returncode not in ok_codes:
        sys.exit(f"failed ({r.returncode}): {' '.join(args)}")


def load_questions() -> list[dict]:
    qs = []
    for name in ("co.json", "ce.json"):
        p = SRC / name
        if p.exists():
            qs += json.loads(p.read_text())["questions"]
    for q in qs:
        q.setdefault("points", LEVEL_POINTS[q["level"]])
        q.setdefault("setLabel", f"示例第{q['set']}套")
        q.setdefault("series", q["set"])
        q.setdefault("image", None)
        q.setdefault("disputed", False)
        q.setdefault("deck", "demo")
    return qs


def make_root(tag: str) -> Path:
    root = REPO / "build" / f"demo-root-{tag}"
    shutil.rmtree(root, ignore_errors=True)
    shutil.copytree(REPO / "scripts", root / "scripts", ignore=shutil.ignore_patterns("__pycache__"))
    for rel in LINKED:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).symlink_to(REPO / rel)
    for rel in COPIED:
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, root / rel)
    for name in BESIDE_ROOT:
        link = root.parent / name
        if not link.exists():
            link.symlink_to(REPO.parent / name)
    (root / "public/media").mkdir(parents=True)
    (root / "data/p2/gen").mkdir(parents=True, exist_ok=True)
    for p in sorted((SRC / "gen").glob("*.json")) if (SRC / "gen").exists() else []:
        shutil.copy(p, root / "data/p2/gen" / p.name)
    return root


def write_bank(root: Path, qs: list[dict]) -> None:
    sets = []
    for section in ("CO", "CE"):
        for set_id in sorted({q["set"] for q in qs if q["section"] == section}):
            n = sum(1 for q in qs if q["section"] == section and q["set"] == set_id)
            sets.append({"section": section, "id": set_id, "label": f"示例第{set_id}套", "series": [], "count": n, "complete": False})
    (root / "data/questions.json").write_text(json.dumps({"sets": sets, "questions": qs}, ensure_ascii=False, indent=1))


def speak(root: Path, q: dict) -> None:
    """The recording of one listening question: each line in its speaker's voice, then the question."""
    lines = q["transcript"]
    voices = q.get("speakers") or ["Thomas"] * len(lines)
    with tempfile.TemporaryDirectory() as tmp:
        parts = []
        for i, (line, voice) in enumerate(zip(lines, voices)):
            aiff, wav = f"{tmp}/{i}.aiff", f"{tmp}/{i}.wav"
            subprocess.run(["say", "-v", voice, "-o", aiff, line], check=True)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-i", aiff, "-ar", "24000", "-ac", "1", wav], check=True)
            if i:
                gap = QUESTION_PAUSE if i == len(lines) - 1 else PAUSE
                sil = f"{tmp}/s{i}.wav"
                subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(gap), sil], check=True)
                parts.append(sil)
            parts.append(wav)
        listing = Path(tmp) / "list.txt"
        listing.write_text("".join(f"file '{p}'\n" for p in parts))
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
                        "-c:a", "libmp3lame", "-b:a", "64k", str(root / "public/media" / q["audio"])], check=True)


def main(argv: list[str]) -> int:
    check = "--check" in argv
    qs = load_questions()
    if not qs:
        sys.exit("demo/src/co.json and demo/src/ce.json are both missing")
    root = make_root(f"check-{os.getpid()}" if check else "full")
    write_bank(root, qs)

    if not check:
        for q in qs:
            if q["section"] == "CO":
                speak(root, q)
    run(root, PY, "scripts/vocab_mapreduce.py")
    # without the recordings (--check), build_site_data writes the bank, then exits 1 on the missing media
    run(root, PY, "scripts/build_site_data.py", ok_codes=(0, 1) if check else (0,))

    if check:
        gens = [p for p in sorted((root / "data/p2/gen").glob("*.json")) if p.stem in {q["id"] for q in qs}]
        code = subprocess.run([PY, "scripts/p2/validate_gen.py", *map(str, gens)], cwd=root).returncode if gens else 0
        shutil.rmtree(root)
        return code

    run(root, PY, "scripts/p2/build_dict.py")
    run(root, PY, "scripts/p2/tts.py")
    run(root, ALIGN_PY, "scripts/p2/align_audio.py")
    run(root, PY, "scripts/p2/build_p2.py")
    shutil.copy(SRC / "oral-writing.json", root / "public/data/oral-writing.json")

    shutil.rmtree(OUT, ignore_errors=True)
    for d in ("data", "media", "media-tts"):
        if (root / "public" / d).exists():
            shutil.copytree(root / "public" / d, OUT / d)
    (OUT / "media-tts/.gitignore").unlink(missing_ok=True)  # tts.py keeps its audio out of git; the demo audio is committed
    files = [p for p in OUT.rglob("*") if p.is_file()]
    print(f"demo/public: {len(files)} files, {sum(p.stat().st_size for p in files) / 1e6:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
