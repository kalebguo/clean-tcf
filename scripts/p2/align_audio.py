"""Listening timeline (SPEC §5.B): line and word timestamps for every listening recording,
aligned to the transcript the site shows, plus an independent transcription to check it.

For each listening question, in one pass (results cached per question, so a run can stop and resume):
  1. Qwen3-ASR-1.7B transcribes the recording without seeing the transcript   -> data/p2/asr/<qid>.json
  2. the transcription is compared word by word with the transcript. The text given to the aligner
     follows the transcript, except where the two disagree on more than a few words: there the
     transcription's words stand in (they match the recording), and a long stretch of the transcript
     the recording does not contain at all (a hallucinated line) is left out
  3. Qwen3-ForcedAligner-0.6B times that text; transcript words get their own times, stand-in words
     only give their line a start and an end. The probability mass near each predicted timestamp is
     kept as the word's confidence                                            -> data/p2/align/<qid>.json
Then data/p2/asr-review.json lists every place where transcript and transcription differ.
Nothing here changes the transcript (SPEC §2, principle 4).

Usage:
  build/venv-align/bin/python scripts/p2/align_audio.py                  # all listening questions
  build/venv-align/bin/python scripts/p2/align_audio.py --only CO-1-01,CO-22-33
  build/venv-align/bin/python scripts/p2/align_audio.py --redo-align     # keep transcriptions, align again
Environment: build/venv-align (uv venv, Python 3.12, mlx-audio[stt]==0.5.7).
Models (mlx-community, 8-bit) in ../models/: Qwen3-ASR-1.7B-8bit, Qwen3-ForcedAligner-0.6B-8bit.
"""
import argparse
import difflib
import hashlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx_audio.stt.models.qwen3_asr.qwen3_forced_aligner import ForceAlignProcessor

ROOT = Path(__file__).resolve().parent.parent.parent
MODELS = ROOT.parent / "models"
ASR_MODEL = MODELS / "Qwen3-ASR-1.7B-8bit"
ALIGN_MODEL = MODELS / "Qwen3-ForcedAligner-0.6B-8bit"
BANK = ROOT / "public/data/listening.json"
MEDIA = ROOT / "public/media"
ASR_DIR = ROOT / "data/p2/asr"
ALIGN_DIR = ROOT / "data/p2/align"
REVIEW = ROOT / "data/p2/asr-review.json"
METHOD = "qwen3-forced-aligner-0.6b-8bit + qwen3-asr-1.7b-8bit (mlx-audio 0.5.7)"
SR = 16000
PROC = ForceAlignProcessor()

# disagreements up to this many words keep the transcript's words; longer ones use the transcription's
SMALL_DIFF = 3
# a word's confidence: probability that its timestamps fall within this many 80 ms bins of the chosen one
CONF_BINS = 3

NUMBER_WORDS = set("""zéro un une deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize
vingt vingts trente quarante cinquante soixante cent cents mille million millions milliard et virgule pour
euros euro heures heure h""".split())


# ---------------------------------------------------------------- words

def fold(w: str) -> str:
    """Comparison form of a word: lowercase, no accents, straight apostrophe."""
    w = unicodedata.normalize("NFD", w.lower().replace("’", "'"))
    return "".join(c for c in w if not unicodedata.combining(c))


def chunks(text: str) -> list[tuple[int, int, str]]:
    """Words as the aligner sees them: whitespace-separated chunks reduced to letters, digits and the
    ASCII apostrophe ("Allez-y," -> "Allezy"). Returns (start, end, token), the offsets without the
    chunk's surrounding punctuation, so the site can mark the word in the text."""
    out = []
    for m in re.finditer(r"\S+", text):
        chunk = m.group().replace("’", "'")
        kept = [j for j, ch in enumerate(chunk) if PROC.is_kept_char(ch)]
        # the aligner makes each Chinese character a word of its own (CO-18-06: "**（地名）")
        pos = 0
        for piece in PROC.split_segment_with_chinese("".join(chunk[j] for j in kept)):
            idx = kept[pos: pos + len(piece)]
            out.append((m.start() + idx[0], m.start() + idx[-1] + 1, piece))
            pos += len(piece)
    return out


def is_number_variant(written: str, heard: str) -> bool:
    """"11" written, "onze" heard: the same thing spelled two ways."""
    words = heard.lower().replace(",", " ").replace("-", " ").split()
    return bool(re.search(r"\d", written)) and bool(words) and all(w in NUMBER_WORDS or w.isdigit() for w in words)


# ---------------------------------------------------------------- models

def load_models():
    from mlx_audio.stt.utils import load
    print("loading models…", flush=True)
    return load(str(ASR_MODEL)), load(str(ALIGN_MODEL))


def transcribe(asr, audio: np.ndarray) -> str:
    out = asr.generate(audio, language="French", max_tokens=2048)
    return out.text.strip()


def force_align(aligner, audio: np.ndarray, tokens: list[str]):
    """Same steps as ForcedAlignerModel.generate, plus the softmax probability of every timestamp."""
    proc = aligner.aligner_processor
    word_list, text = proc.encode_timestamp(" ".join(tokens), "French")
    if word_list != tokens:
        raise ValueError("aligner tokenization differs from ours")
    feats, mask, n_audio = aligner._preprocess_audio(audio)
    text = text.replace("<|audio_pad|>", "<|audio_pad|>" * n_audio)
    ids = mx.array(aligner._tokenizer.encode(text, return_tensors="np", add_special_tokens=False))
    logits = aligner(ids, input_features=feats, feature_attention_mask=mask)[0].astype(mx.float32)
    at = np.array(ids[0]) == aligner.config.timestamp_token_id
    probs = np.array(mx.softmax(logits, axis=-1))[at]
    mx.clear_cache()
    best = probs.argmax(axis=-1)
    # one 80 ms bin rarely holds most of the probability; what matters is how much lies close to it
    conf = np.array([p[max(0, b - CONF_BINS):b + CONF_BINS + 1].sum() for p, b in zip(probs, best)])
    raw = best * aligner.config.timestamp_segment_time
    fixed = proc.fix_timestamp(raw)
    return [
        {"start": fixed[2 * k] / 1000, "end": fixed[2 * k + 1] / 1000,
         "conf": float(min(conf[2 * k], conf[2 * k + 1])),
         "moved": bool(fixed[2 * k] != raw[2 * k] or fixed[2 * k + 1] != raw[2 * k + 1])}
        for k in range(len(tokens))
    ]


# ---------------------------------------------------------------- one question

def plan(lines: list[str], asr_text: str):
    """Compare transcript and transcription, and build the text for the aligner.

    Returns coverage (per line, share of its words the transcription confirms), diffs (for the review
    list) and stream: (token, line, s, e) for every word given to the aligner; s / e are None for a
    stand-in word of the transcription, line is None for words the transcript lacks altogether."""
    tr = [(i, s, e, tok) for i, line in enumerate(lines) for s, e, tok in chunks(line)]
    hy = chunks(asr_text)
    sm = difflib.SequenceMatcher(None, [fold(t[3]) for t in tr], [fold(t[2]) for t in hy], autojunk=False)
    matched = [False] * len(tr)
    stream, diffs = [], []
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        written, heard = tr[a0:a1], hy[b0:b1]
        if op == "equal":
            for k in range(a0, a1):
                matched[k] = True
            stream += [(t[3], t[0], t[1], t[2]) for t in written]
            continue
        heard_text = asr_text[heard[0][0]:heard[-1][1]] if heard else ""
        by_line: dict[int, list] = {}
        for t in written:
            by_line.setdefault(t[0], []).append(t)
        written_text = " ‖ ".join(lines[i][ts[0][1]:ts[-1][2]] for i, ts in by_line.items())
        line = written[0][0] if written else (tr[a0][0] if a0 < len(tr) else len(lines) - 1)
        kind = {"replace": "changed", "delete": "not_heard", "insert": "not_written"}[op]
        if op == "replace" and is_number_variant(written_text, heard_text):
            kind = "number"
        diffs.append({"line": line, "type": kind, "written": written_text, "heard": heard_text})

        if (op == "replace" and len(written) <= SMALL_DIFF and len(heard) <= SMALL_DIFF) or (op == "delete" and len(written) <= SMALL_DIFF):
            stream += [(t[3], t[0], t[1], t[2]) for t in written]  # a slip of the ear: keep the transcript
        else:
            owner = written[0][0] if written else None
            stream += [(t[2], owner, None, None) for t in heard]  # the recording's words stand in
    coverage = []
    for i in range(len(lines)):
        ks = [k for k, t in enumerate(tr) if t[0] == i]
        coverage.append(sum(matched[k] for k in ks) / len(ks) if ks else 1.0)
    return coverage, diffs, stream


def process(q, asr, aligner, redo_align: bool):
    from mlx_audio.stt.utils import load_audio
    qid, lines = q["id"], q.get("transcript") or []
    audio_path = MEDIA / q["audio"]
    audio = None

    asr_file = ASR_DIR / f"{qid}.json"
    if asr_file.exists():
        asr_text = json.loads(asr_file.read_text())["text"]
    else:
        audio = np.array(load_audio(str(audio_path), sr=SR))
        t0 = time.time()
        asr_text = transcribe(asr, audio)
        asr_file.write_text(json.dumps({"qid": qid, "audio": q["audio"], "text": asr_text,
                                        "seconds": round(time.time() - t0, 1)}, ensure_ascii=False) + "\n")

    align_file = ALIGN_DIR / f"{qid}.json"
    src = hashlib.sha1("\n".join(lines).encode()).hexdigest()[:12]
    if align_file.exists() and not redo_align and json.loads(align_file.read_text()).get("src") == src:
        return None
    if audio is None:
        audio = np.array(load_audio(str(audio_path), sr=SR))

    coverage, diffs, stream = plan(lines, asr_text)
    timed = force_align(aligner, audio, [t[0] for t in stream]) if stream else []

    words = [{"line": t[1], "s": t[2], "e": t[3], "start": round(w["start"], 2), "end": round(w["end"], 2),
              "conf": round(w["conf"], 3)} for t, w in zip(stream, timed) if t[2] is not None]
    out_lines = []
    for i in range(len(lines)):
        mine = [w for t, w in zip(stream, timed) if t[1] == i]
        if not mine:  # nothing of it in the recording
            out_lines.append({"start": None, "end": None, "score": 0, "coverage": round(coverage[i], 2)})
            continue
        conf = float(np.mean([w["conf"] for w in mine]))
        stand_in = sum(1 for t in stream if t[1] == i and t[2] is None)
        out_lines.append({"start": round(mine[0]["start"], 2), "end": round(mine[-1]["end"], 2),
                          "score": round(conf, 3), "coverage": round(coverage[i], 2),
                          **({"standIn": stand_in} if stand_in else {})})
    result = {"qid": qid, "audio": q["audio"], "duration": round(len(audio) / SR, 2), "method": METHOD, "src": src,
              "lines": out_lines, "words": words, "diffs": diffs,
              "dropped": [i for i, l in enumerate(out_lines) if l["start"] is None]}
    align_file.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n")
    return result


def write_review(questions):
    """Every difference between transcript and transcription, for checking by ear (type asr)."""
    items = []
    for q in questions:
        f = ALIGN_DIR / f"{q['id']}.json"
        if not f.exists():
            continue
        a = json.loads(f.read_text())
        asr_text = json.loads((ASR_DIR / f"{q['id']}.json").read_text())["text"]
        items.append({"qid": q["id"], "level": q["level"], "dropped": a["dropped"],
                      "lines": [{"text": t, **a["lines"][i]} for i, t in enumerate(q.get("transcript") or [])],
                      "asr": asr_text, "diffs": a["diffs"]})
    REVIEW.write_text(json.dumps({"generated": time.strftime("%Y-%m-%d %H:%M"), "method": METHOD, "items": items},
                                 ensure_ascii=False, indent=1) + "\n")
    print(f"{len(items)} questions -> {REVIEW.relative_to(ROOT)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated question ids")
    ap.add_argument("--redo-align", action="store_true", help="align again even when the transcript is unchanged")
    args = ap.parse_args()

    questions = [q for q in json.loads(BANK.read_text())["questions"] if q.get("audio")]
    todo = questions
    if args.only:
        wanted = set(args.only.split(","))
        todo = [q for q in questions if q["id"] in wanted]
    ASR_DIR.mkdir(parents=True, exist_ok=True)
    ALIGN_DIR.mkdir(parents=True, exist_ok=True)

    asr, aligner = load_models()
    t_start = time.time()
    for n, q in enumerate(todo, 1):
        t0 = time.time()
        try:
            r = process(q, asr, aligner, args.redo_align)
        except Exception as e:  # one bad file must not stop the run
            print(f"{n}/{len(todo)} {q['id']} FAILED: {e}", file=sys.stderr, flush=True)
            continue
        left = (time.time() - t_start) / n * (len(todo) - n) / 60
        status = "cached" if r is None else f"{len(r['words'])} words, dropped {r['dropped']}" if r["dropped"] else f"{len(r['words'])} words"
        print(f"{n}/{len(todo)} {q['id']} {time.time() - t0:.1f}s · {status} · {left:.0f} min left", flush=True)
    write_review(questions)


if __name__ == "__main__":
    main()
