"""Validate P2 generated question files (format: scripts/p2/GEN_GUIDE.md).

Usage:
  .venv/bin/python scripts/p2/validate_gen.py FILE.json [FILE.json ...]
  .venv/bin/python scripts/p2/validate_gen.py DIR            # every *.json in DIR
  .venv/bin/python scripts/p2/validate_gen.py --mt DIR       # translation-only files (data/p2/mt, local model)

--mt checks only segments and options, and accepts the extra key "model". A sentence
whose translation has no Chinese (or no Latin letters in English) is a warning there,
not an error: a local model keeps names, labels and URLs ("Patrick ANAI", "www.geo.fr") as they are.

Each file is checked against the question with the same id in public/data/*.json.
Prints "OK <id>" or the errors for each file; exits 1 if any file has errors.
Warnings are printed but do not fail the file.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LETTERS = ["A", "B", "C", "D"]
ISSUE_KINDS = {"asr", "ocr", "typo", "hallucination", "missing", "other"}
CJK = re.compile(r"[一-鿿]")
LATIN = re.compile(r"[A-Za-z]")
WS = re.compile(r"\s+")


def load_bank():
    bank = {}
    for name in ("listening", "reading"):
        for q in json.loads((ROOT / f"public/data/{name}.json").read_text())["questions"]:
            bank[q["id"]] = q
    return bank


def fields_of(q):
    """Source text fields in reading order: [(field, [blocks])]."""
    if q["section"] == "CO":
        return [("transcript", q.get("transcript") or [])]
    out = []
    if q.get("question"):
        out.append(("question", [q["question"]]))
    out.append(("passage", q.get("passage") or []))
    return out


def is_picture(q):
    return q["section"] == "CO" and not any(q["options"])


def squash(s):
    return WS.sub("", s)


def nothing_to_translate(fr):
    """Numbers, symbols, a phone number, one name or URL: a translation may copy them as they are."""
    return sum(1 for t in fr.split() if LATIN.search(t)) <= 1


def first_diff(a, b):
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    return n


def find_in_blocks(fr, blocks):
    """Index of the block containing fr (whitespace-insensitive), or -1."""
    needle = WS.sub(" ", fr.strip())
    if not needle:
        return -1
    for i, b in enumerate(blocks):
        if needle in WS.sub(" ", b):
            return i
    return -1


def segment_spans(segs, blocks):
    """Map each segment onto (block, start, end) pieces of the original blocks.

    Assumes the whitespace-free concatenations are equal (checked by the caller).
    Returns a list (one per segment) of lists of (block, start, end).
    """
    # positions of every non-whitespace char in the blocks
    pos = [(bi, ci) for bi, b in enumerate(blocks) for ci, ch in enumerate(b) if not ch.isspace()]
    out, k = [], 0
    for s in segs:
        n = len(squash(s["fr"]))
        chars = pos[k:k + n]
        k += n
        pieces = []
        for bi, ci in chars:
            if pieces and pieces[-1][0] == bi:
                pieces[-1][2] = ci + 1
            else:
                pieces.append([bi, ci, ci + 1])
        out.append([tuple(p) for p in pieces])
    return out


def validate(gen, q, translation_only=False):
    errors, warnings = [], []
    E, W = errors.append, warnings.append

    if translation_only:
        allowed = {"id", "model", "segments", "options"}
    else:
        allowed = {"id", "segments", "options", "analysis", "evidence", "check", "issues"}
    for k in set(gen) - allowed:
        E(f"unknown top-level key {k!r}")
    for k in allowed - set(gen):
        E(f"missing top-level key {k!r}")
    if errors:
        return errors, warnings

    fields = fields_of(q)
    field_blocks = dict(fields)

    # ---- segments
    segs = gen["segments"]
    if not isinstance(segs, list) or not segs:
        E("segments must be a non-empty list")
        segs = []
    for i, s in enumerate(segs):
        if not isinstance(s, dict) or set(s) != {"field", "fr", "zh", "en"}:
            E(f"segments[{i}] must have exactly field, fr, zh, en")
            continue
        if s["field"] not in field_blocks:
            E(f"segments[{i}].field {s['field']!r} is not one of {list(field_blocks)}")
        if not s["fr"].strip():
            E(f"segments[{i}].fr is empty")
        if not s["zh"].strip() or not s["en"].strip():
            E(f"segments[{i}] has an empty translation")
            continue
        copy_ok = nothing_to_translate(s["fr"])
        if not (CJK.search(s["zh"]) or copy_ok):
            (W if translation_only else E)(f"segments[{i}].zh must be Chinese text: {s['zh'][:40]!r}")
        if CJK.search(s["en"]) or not (LATIN.search(s["en"]) or copy_ok):
            (W if translation_only else E)(f"segments[{i}].en must be English text: {s['en'][:40]!r}")
    if errors:
        return errors, warnings

    order = [f for f, _ in fields]
    seen_fields = []
    for s in segs:
        if not seen_fields or seen_fields[-1] != s["field"]:
            seen_fields.append(s["field"])
    if seen_fields != [f for f in order if field_blocks[f]]:
        E(f"segments must cover fields in this order, each once: {order} (got {seen_fields})")

    for field, blocks in fields:
        fsegs = [s for s in segs if s["field"] == field]
        src = squash("".join(blocks))
        got = squash("".join(s["fr"] for s in fsegs))
        if src != got:
            i = first_diff(src, got)
            E(
                f"{field}: segments' fr does not reproduce the source text exactly "
                f"(ignoring whitespace). First difference at char {i}: "
                f"source …{src[max(0, i - 25):i + 25]}… vs segments …{got[max(0, i - 25):i + 25]}…"
            )
            continue
        spans = segment_spans(fsegs, blocks)
        for s, pieces in zip(fsegs, spans):
            # boundary inside a word: segment ends/starts with no whitespace between two letters
            bi, _, end = pieces[-1]
            b = blocks[bi]
            if 0 < end < len(b) and b[end - 1].isalnum() and b[end].isalnum():
                W(f"{field}: segment {s['fr'][:40]!r} ends inside a word")
            if len(s["fr"]) > 600:
                W(f"{field}: segment {s['fr'][:40]!r} is {len(s['fr'])} chars; is it really one sentence?")

    # ---- options
    opts = gen["options"]
    if not isinstance(opts, list) or len(opts) != 4:
        E("options must be a list of 4")
    else:
        for i, (o, srco) in enumerate(zip(opts, q["options"])):
            if not srco:
                if o is not None:
                    E(f"options[{i}] must be null (the source option is empty)")
                continue
            if not isinstance(o, dict) or set(o) != {"zh", "en"}:
                E(f"options[{i}] must be {{zh, en}}")
                continue
            if not o["zh"].strip() or not o["en"].strip():
                E(f"options[{i}] has an empty translation")
                continue
            if not CJK.search(o["zh"]):
                (W if translation_only else E)(f"options[{i}].zh must be Chinese: {o['zh'][:40]!r}")
            if CJK.search(o["en"]) or not LATIN.search(o["en"]):
                (W if translation_only else E)(f"options[{i}].en must be English: {o['en'][:40]!r}")

    if translation_only:
        return errors, warnings

    # ---- analysis
    an = gen["analysis"]
    if not isinstance(an, dict) or set(an) != {"summary", "options"}:
        E("analysis must have exactly summary, options")
    else:
        if not CJK.search(an["summary"] or ""):
            E("analysis.summary must be Chinese")
        ao = an["options"]
        if not isinstance(ao, dict) or set(ao) != set(LETTERS):
            E("analysis.options must have keys A, B, C, D")
        else:
            for L in LETTERS:
                o = ao[L]
                if not isinstance(o, dict) or set(o) != {"correct", "why"}:
                    E(f"analysis.options.{L} must be {{correct, why}}")
                    continue
                if o["correct"] is not (L == q["answer"]):
                    E(f"analysis.options.{L}.correct must be {L == q['answer']} (official answer is {q['answer']})")
                if not CJK.search(o["why"] or ""):
                    E(f"analysis.options.{L}.why must be Chinese")

    # ---- evidence
    ev = gen["evidence"]
    if not isinstance(ev, list) or not ev:
        E("evidence must be a non-empty list")
    else:
        for i, e in enumerate(ev):
            if not isinstance(e, dict) or set(e) != {"letter", "field", "fr"}:
                E(f"evidence[{i}] must have exactly letter, field, fr")
                continue
            if e["letter"] not in LETTERS:
                E(f"evidence[{i}].letter must be A-D")
            if e["field"] not in field_blocks:
                E(f"evidence[{i}].field {e['field']!r} is not one of {list(field_blocks)}")
                continue
            bi = find_in_blocks(e["fr"], field_blocks[e["field"]])
            if bi < 0:
                E(f"evidence[{i}].fr is not an exact substring of one {e['field']} line/paragraph: {e['fr'][:80]!r}")
            elif len(e["fr"]) > 300:
                W(f"evidence[{i}] is {len(e['fr'])} chars; quote a shorter clause")
        if not any(isinstance(e, dict) and e.get("letter") == q["answer"] for e in ev):
            E(f"evidence needs at least one item for the official answer {q['answer']}")

    # ---- check
    ck = gen["check"]
    if not isinstance(ck, dict) or set(ck) != {"agree", "note"} or not isinstance(ck.get("agree"), bool):
        E("check must be {agree: bool, note: string}")
    elif not ck["agree"] and not CJK.search(ck["note"] or ""):
        E("check.note (Chinese) is required when agree is false")

    # ---- issues
    iss = gen["issues"]
    if not isinstance(iss, list):
        E("issues must be a list")
    else:
        for i, it in enumerate(iss):
            if not isinstance(it, dict) or set(it) != {"field", "fr", "fix", "kind", "note"}:
                E(f"issues[{i}] must have exactly field, fr, fix, kind, note")
                continue
            if it["kind"] not in ISSUE_KINDS:
                E(f"issues[{i}].kind must be one of {sorted(ISSUE_KINDS)}")
            if it["field"] not in field_blocks and it["field"] != "options":
                E(f"issues[{i}].field must be one of {list(field_blocks) + ['options']}")
                continue
            if it["kind"] != "missing":
                blocks = q["options"] if it["field"] == "options" else field_blocks[it["field"]]
                if find_in_blocks(it["fr"], blocks) < 0:
                    E(f"issues[{i}].fr is not an exact substring of the source: {it['fr'][:80]!r}")

    return errors, warnings


def main(argv):
    translation_only = "--mt" in argv
    argv = [a for a in argv if a != "--mt"]
    paths = []
    for a in argv:
        p = Path(a)
        paths += sorted(p.glob("*.json")) if p.is_dir() else [p]
    if not paths:
        print(__doc__)
        return 2
    bank = load_bank()
    bad = 0
    for p in paths:
        try:
            gen = json.loads(p.read_text())
        except Exception as e:  # noqa: BLE001
            print(f"ERROR {p.name}: not valid JSON: {e}")
            bad += 1
            continue
        qid = gen.get("id") if isinstance(gen, dict) else None
        if qid != p.stem or qid not in bank:
            print(f"ERROR {p.name}: id {qid!r} must equal the file name and exist in the bank")
            bad += 1
            continue
        errors, warnings = validate(gen, bank[qid], translation_only)
        for w in warnings:
            print(f"warn  {qid}: {w}")
        if errors:
            bad += 1
            for e in errors:
                print(f"ERROR {qid}: {e}")
        else:
            print(f"OK {qid}")
    print(f"{len(paths) - bad}/{len(paths)} files valid")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
