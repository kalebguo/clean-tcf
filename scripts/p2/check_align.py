"""Check line timestamps without listening: cut each timed line out of the recording, transcribe the
clip alone, and measure how much of the line's text the clip contains (SPEC §5.B, acceptance).
A well-cut clip contains its line; a clip cut in the wrong place contains a neighbouring line.

Writes data/p2/align-check.json: per line {qid, line, score, coverage, clip} where clip is the share
of the line's words heard in the clip, relative to the share heard in the whole recording.

Usage: build/venv-align/bin/python scripts/p2/check_align.py [--only CO-1-01,...] [--sample N]
"""
import argparse
import difflib
import json
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from align_audio import ALIGN_DIR, ASR_MODEL, BANK, MEDIA, ROOT, SR, chunks, fold, transcribe  # noqa: E402

OUT = ROOT / "data/p2/align-check.json"
PAD = 0.15  # seconds added on both sides of the clip


def share_heard(line: str, heard: str) -> float:
    a = [fold(t[2]) for t in chunks(line)]
    b = [fold(t[2]) for t in chunks(heard)]
    if not a:
        return 1.0
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return sum(m.size for m in sm.get_matching_blocks()) / len(a)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--sample", type=int, help="check this many questions picked at random")
    args = ap.parse_args()
    from mlx_audio.stt.utils import load, load_audio

    bank = {q["id"]: q for q in json.loads(BANK.read_text())["questions"]}
    ids = sorted(p.stem for p in ALIGN_DIR.glob("*.json"))
    if args.only:
        ids = [i for i in ids if i in set(args.only.split(","))]
    if args.sample:
        ids = random.Random(1).sample(ids, min(args.sample, len(ids)))
    asr = load(str(ASR_MODEL))
    rows = []
    for n, qid in enumerate(ids, 1):
        a = json.loads((ALIGN_DIR / f"{qid}.json").read_text())
        lines = bank[qid]["transcript"]
        audio = np.array(load_audio(str(MEDIA / a["audio"]), sr=SR))
        for i, (text, l) in enumerate(zip(lines, a["lines"])):
            if l["start"] is None or len(chunks(text)) < 3:
                continue
            s, e = max(0, int((l["start"] - PAD) * SR)), int((l["end"] + PAD) * SR)
            heard = transcribe(asr, audio[s:e]) if e - s > SR // 4 else ""
            clip = share_heard(text, heard) / max(l["coverage"], 0.2)
            rows.append({"qid": qid, "line": i, "score": l["score"], "coverage": l["coverage"],
                         "clip": round(min(1.0, clip), 2), "heard": heard, "text": text})
        print(f"{n}/{len(ids)} {qid}", flush=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1) + "\n")
    good = [r for r in rows if r["clip"] >= 0.8]
    print(f"{len(rows)} lines; clip contains its line (>= 80 %): {len(good)} ({len(good) / max(1, len(rows)):.0%})")
    for t in (0.2, 0.3, 0.4, 0.5, 0.6):
        above = [r for r in rows if r["score"] >= t]
        ok = [r for r in above if r["clip"] >= 0.8]
        print(f"  score >= {t}: {len(above)} lines, {len(ok) / max(1, len(above)):.0%} well cut")


if __name__ == "__main__":
    main()
