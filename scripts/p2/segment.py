"""Split a question's source text into sentences, the way GEN_GUIDE.md asks for segments.

split_field(blocks) -> list of sentences. Joined without whitespace they reproduce the
blocks exactly; a sentence that runs over a line break is joined with one space.

Rules (no model, so the result is the same on every run):
- a line that starts with "A. " … "D. " (picture items) is one segment, as GEN_GUIDE asks
- inside a block: split after . ! ? … (plus closing quotes / brackets) when the next
  word starts like a sentence (capital, digit, opening quote, dash); not after
  abbreviations (M., Mme., etc.) or single-letter initials ("J. Dupont", "A. …")
- between blocks: a line break ends the sentence unless the line ends with , ; or a
  dash, or the next line starts with a lowercase letter (OCR / transcript lines that
  break mid-sentence). A short line ending with a comma before a capital is a
  salutation or closing ("Cher Paul," / "Bises,") and does end the sentence

Usage: .venv/bin/python scripts/p2/segment.py eval   # agreement with the Sonnet segments in data/p2/gen
"""
import json
import re
import sys
from pathlib import Path

ABBREV = {
    "m", "mm", "mme", "mmes", "mlle", "mlles", "dr", "pr", "me", "st", "ste", "cf", "ex", "etc",
    "p", "pp", "av", "bd", "boul", "tél", "tel", "env", "min", "max", "h", "n", "no", "nº", "vol",
    "chap", "fig", "art", "réf", "ref", "cie", "inc", "ltd", "approx", "dept", "dépt", "sept",
    "janv", "févr", "fév", "avr", "juil", "oct", "nov", "déc", "lun", "mar", "mer", "jeu", "ven",
    "sam", "dim", "hab", "km", "kg", "cm", "mm", "ml", "cl", "fr", "angl", "c.-à-d", "j.-c",
}
END = r"(?:[.!?]+|…)[»\"”’')\]]*"
START = r"[A-ZÀ-ÖØ-Þ0-9«\"“‘'(\[–—-]"
BOUNDARY = re.compile(rf"({END})(\s+)(?={START})")
WORD_BEFORE = re.compile(r"([\w.-]+)$")
CHOICE_LINE = re.compile(r"^[A-D]\.\s")


def _splits_in_block(text):
    """Character offsets where a new sentence starts inside one block."""
    out = []
    for m in BOUNDARY.finditer(text):
        punct = m.group(1)
        if punct.startswith("."):
            w = WORD_BEFORE.search(text[:m.start()])
            word = (w.group(1) if w else "").lower().rstrip(".")
            if len(word) == 1 and word.isalpha():  # initials, "A. …" picture lines
                continue
            if word in ABBREV or word.split(".")[-1] in ABBREV:
                continue
        out.append(m.end())
    return out


def _line_breaks_sentence(prev, nxt):
    """prev is the whole previous line (block), nxt the next one."""
    prev, nxt = prev.rstrip(), nxt.lstrip()
    if not prev or not nxt:
        return True
    if prev[-1] == "," and len(prev) <= 40 and nxt[0].isupper():
        return True
    if prev[-1] in ",;-–—(":
        return False
    if nxt[0].islower():
        return False
    return True


def split_field(blocks):
    sents, cur, prev = [], "", ""
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        joined = cur and not _line_breaks_sentence(prev, block)
        prev = block
        if joined:
            text = cur + " " + block  # cur is the unfinished last sentence, so it has no cut inside
        else:
            if cur:
                sents.append(cur)
            text = block
        pieces, last = [], 0
        for c in ([] if CHOICE_LINE.match(text) else _splits_in_block(text)):
            pieces.append(text[last:c].strip())
            last = c
        pieces.append(text[last:].strip())
        pieces = [p for p in pieces if p]
        sents += pieces[:-1]
        cur = pieces[-1] if pieces else ""
    if cur:
        sents.append(cur)
    return sents


def _eval():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from validate_gen import fields_of, load_bank, squash

    root = Path(__file__).resolve().parent.parent.parent
    bank = load_bank()
    tp = fp = fn = 0
    exact = total = 0
    bad = []
    for p in sorted((root / "data/p2/gen").glob("*.json")):
        gen = json.loads(p.read_text())
        q = bank[p.stem]
        for field, blocks in fields_of(q):
            ref = [s["fr"] for s in gen["segments"] if s["field"] == field]
            hyp = split_field(blocks)
            assert squash("".join(hyp)) == squash("".join(blocks)), p.stem

            def cuts(xs):
                out, n = set(), 0
                for x in xs[:-1]:
                    n += len(squash(x))
                    out.add(n)
                return out
            r, h = cuts(ref), cuts(hyp)
            tp += len(r & h)
            fp += len(h - r)
            fn += len(r - h)
            total += 1
            exact += r == h
            if r != h:
                bad.append((p.stem, field, ref, hyp))
    prec, rec = tp / max(1, tp + fp), tp / max(1, tp + fn)
    print(f"boundaries: precision {prec:.3f} recall {rec:.3f}; fields identical {exact}/{total}")
    for qid, field, ref, hyp in bad[:int(sys.argv[2]) if len(sys.argv) > 2 else 8]:
        print(f"--- {qid} {field}")
        rs, hs = set(ref), set(hyp)
        for s in ref:
            if s not in hs:
                print("  sonnet:", s[:150])
        for s in hyp:
            if s not in rs:
                print("  rules: ", s[:150])


if __name__ == "__main__":
    if sys.argv[1:2] == ["eval"]:
        _eval()
    else:
        print(__doc__)
