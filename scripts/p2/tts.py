"""Reading "listen to the text" (SPEC §5.A): read each reading question aloud with a macOS voice and keep
when each word is spoken, so the site can mark the word being read and play from a clicked word.

Reading order: the passage lines (0.6 s between lines, 0.15 s where a sentence goes on to the next line),
2 s, then the question. Options are not read. Synthesis runs on the CPU (scripts/p2/tts_synth.swift).

Writes:  public/media-tts/<qid>.m4a   AAC mono 48 kbps, not in git (rebuild with this script)
         data/p2/tts/<qid>.json       {qid, voice, src, duration, words: [[field, index, s, e, start, end]]}
                                      field "passage" | "question"; s / e are UTF-16 offsets in that block
A question is done again only when its text (src) or the voice changed, or its audio is missing.

Usage: .venv/bin/python scripts/p2/tts.py [--only CE-1-01,...] [--limit N] [--voice ID] [--jobs 4]
"""
import argparse
import bisect
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BANK = ROOT / "public/data/reading.json"
DATA = ROOT / "data/p2/tts"
MEDIA = ROOT / "public/media-tts"
SYNTH_SRC = Path(__file__).resolve().parent / "tts_synth.swift"
SYNTH = ROOT / "build/tts-synth"
VOICE = "com.apple.voice.compact.fr-FR.Thomas"
LINE_PAUSE, JOINED_PAUSE, QUESTION_PAUSE = 0.6, 0.15, 2.0
BITRATE = 48000


def text_src(q):
    """Fingerprint of the text read aloud; build_p2.py leaves a file out when it no longer matches."""
    return hashlib.sha1("\n".join([*q["passage"], "#q", q.get("question") or ""]).encode()).hexdigest()[:12]


# Thomas reads "15 %" digit by digit ("un cinq pour cent") but "15%" right. Checked by transcribing the
# voice's output with Qwen3-ASR: times (20h30), M., all-caps titles, 1er / 2e / XXIe, €, n°, km, kg, m²
# and list bullets are read right as written, so nothing else is changed.
RULES = [(re.compile(r"(?<=\d)[   ]+(?=%)"), "")]


def normalize(text):
    """The text to speak and, for each of its characters, the index of the character it comes from."""
    out, src, pos = [], [], 0
    spans = sorted((m.start(), m.end(), rep) for rx, rep in RULES for m in rx.finditer(text))
    for s, e, rep in spans:
        if s < pos:
            continue
        out.append(text[pos:s])
        src.extend(range(pos, s))
        out.append(rep)
        src.extend([s] * len(rep))
        pos = e
    out.append(text[pos:])
    src.extend(range(pos, len(text)))
    return "".join(out), src


def utf16_offsets(text):
    """offs[i] = UTF-16 offset of code point i (the browser counts text in UTF-16 units)."""
    offs = [0]
    for ch in text:
        offs.append(offs[-1] + (2 if ord(ch) > 0xFFFF else 1))
    return offs


def parts_of(q):
    """[(field, index, text, pause after)] in reading order."""
    lines = q["passage"]
    out = []
    for i, t in enumerate(lines):
        if i == len(lines) - 1:
            pause = QUESTION_PAUSE
        elif not re.search(r"[.!?:;»\"…)]\s*$", t) and lines[i + 1][:1].islower():
            pause = JOINED_PAUSE
        else:
            pause = LINE_PAUSE
        out.append(("passage", i, t, pause))
    if q.get("question"):
        out.append(("question", 0, q["question"], 0.0))
    return out


WORD_CHAR = re.compile(r"[\w%€$£°]")


def words_of(q, meta):
    """Map the synthesizer's word markers back to the original text: [[field, index, s, e, start, end]]."""
    sr = meta["sr"]
    words = []
    for (field, index, text, _), part in zip(parts_of(q), meta["parts"]):
        spoken, src = normalize(text)
        sp16 = utf16_offsets(spoken)
        org16 = utf16_offsets(text)
        marks = part["words"]
        speech_end = (part["at"] + part["frames"]) / sr
        for k, (loc, length, frame) in enumerate(marks):
            a = bisect.bisect_left(sp16, loc)
            b = bisect.bisect_left(sp16, loc + length)
            # trim spaces and punctuation the marker may include ("20h30," → "20h30")
            while a < b and not WORD_CHAR.match(spoken[a]):
                a += 1
            while b > a and not WORD_CHAR.match(spoken[b - 1]):
                b -= 1
            if a >= b or b > len(src):
                continue
            s, e = src[a], src[b - 1] + 1
            start = frame / sr
            end = marks[k + 1][2] / sr if k + 1 < len(marks) else speech_end
            words.append([field, index, org16[s], org16[e], round(start, 3), round(max(start, end), 3)])
    return words


def compile_synth():
    if SYNTH.exists() and SYNTH.stat().st_mtime >= SYNTH_SRC.stat().st_mtime:
        return
    SYNTH.parent.mkdir(exist_ok=True)
    subprocess.run(["swiftc", "-O", "-suppress-warnings", str(SYNTH_SRC), "-o", str(SYNTH)], check=True)


def run_batch(batch, voice, tmp):
    """Synthesize one batch in its own process; returns {qid: meta}."""
    job = Path(tmp) / f"job-{batch[0]['id']}.json"
    items = [{"id": q["id"], "parts": [{"text": normalize(t)[0], "pause": p} for _, _, t, p in parts_of(q)]} for q in batch]
    job.write_text(json.dumps({"voice": voice, "items": items}, ensure_ascii=False))
    subprocess.run([str(SYNTH), str(job), tmp], check=True, stdout=subprocess.DEVNULL)
    out = {}
    for q in batch:
        wav = Path(tmp) / f"{q['id']}.wav"
        m4a = MEDIA / f"{q['id']}.m4a"
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(BITRATE), str(wav), str(m4a)], check=True)
        wav.unlink()
        out[q["id"]] = json.loads((Path(tmp) / f"{q['id']}.json").read_text())
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--voice", default=VOICE)
    ap.add_argument("--jobs", type=int, default=4, help="synthesizer processes run at once")
    ap.add_argument("--batch", type=int, default=10)
    args = ap.parse_args()

    qs = json.loads(BANK.read_text())["questions"]
    if args.only:
        only = set(args.only.split(","))
        qs = [q for q in qs if q["id"] in only]
    todo = []
    for q in qs:
        p = DATA / f"{q['id']}.json"
        if p.exists() and (MEDIA / f"{q['id']}.m4a").exists():
            old = json.loads(p.read_text())
            if old["src"] == text_src(q) and old["voice"] == args.voice:
                continue
        todo.append(q)
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(todo)} of {len(qs)} questions to read aloud", flush=True)
    if not todo:
        return
    compile_synth()
    DATA.mkdir(parents=True, exist_ok=True)
    MEDIA.mkdir(parents=True, exist_ok=True)
    (MEDIA / ".gitignore").write_text("# generated by scripts/p2/tts.py\n*\n!.gitignore\n")

    batches = [todo[i: i + args.batch] for i in range(0, len(todo), args.batch)]
    t0, done, seconds = time.time(), 0, 0.0
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(args.jobs) as pool:
        for metas in pool.map(lambda b: run_batch(b, args.voice, tmp), batches):
            for qid, meta in metas.items():
                q = next(x for x in todo if x["id"] == qid)
                duration = round(meta["frames"] / meta["sr"], 2)
                rec = {"qid": qid, "voice": args.voice, "src": text_src(q), "duration": duration, "words": words_of(q, meta)}
                (DATA / f"{qid}.json").write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
                done += 1
                seconds += duration
            el = time.time() - t0
            print(f"{done}/{len(todo)} · {seconds / 60:.0f} min of audio · {el:.0f} s · {el / done * (len(todo) - done) / 60:.0f} min left", flush=True)


if __name__ == "__main__":
    sys.exit(main())
