"""Merge the two OCR passes of each reading image into one checked text.

  data/ocr/<name>.json      macOS Vision: line boxes with confidence (good characters, weak layout)
  data/ocr_vlm/<name>.txt   PaddleOCR-VL: full text in reading order (good layout, drops some accents)

PaddleOCR-VL's text is the base because its reading order is right. Each Vision line
box is aligned to it and every disagreement is settled by local rules:
  0. a word Vision cut at a line break (chef - / d'œuvre)  -> PaddleOCR-VL's whole word
  1. same after normalising apostrophes / œ / spacing      -> keep
  2. only one side is a dictionary word                    -> that side
     (unless PaddleOCR-VL's word is Vision's cut short: Structure / Structurellement)
  3. both are words: Vision line confidence 1.0            -> Vision, else PaddleOCR-VL
     (spot check: Vision was right 11 of 12 times; PaddleOCR-VL drops accents and plural
      endings, and re-reading a cropped line with it repeats the same mistakes)
  4. a drop-cap fragment ("undi", "ous")                   -> add the capital that makes a word
  5. both capitalised non-words (names)                    -> as rule 3, no review (names are not in the word book)
Vision lines with confidence < 0.5 and disagreements longer than 4 tokens leave PaddleOCR-VL as is.
Anything still open is listed for review; fixes decided by hand go in data/ocr_fixes.json.

PaddleOCR-VL sometimes skips a whole block (a second column); clean Vision lines it lacks
are returned separately as "extra", to be placed at the end of the passage.

Output: data/ocr_merged.json  {name: {"text": str, "extra": str,
                                      "open": [{"vision", "paddle", "context", "suggest"}]}}
"""
import difflib
import json
import re
import string
from collections import Counter
from pathlib import Path

import simplemma

ROOT = Path(__file__).resolve().parent.parent
VISION_DIR = ROOT / "data/ocr"
VLM_DIR = ROOT / "data/ocr_vlm"
OUT = ROOT / "data/ocr_merged.json"
FIXES_IN = ROOT / "data/ocr_fixes.json"             # hand fixes for what the rules leave open
LOG_OUT = ROOT / "build/merge_ocr.log.json"        # every decision, for spot checks
WORDLIST = ROOT.parent / "提香法语（超大词汇）.txt"

WATERMARK = re.compile(r"^(t?cf|c?anada|canadä|anadä|tcf\s*canada|anada|canad)$", re.I)
WATERMARK_TOKEN = re.compile(r"^(CANADA|TCF|tcf)$")   # PaddleOCR-VL reads the background logo as text
URL = re.compile(r"\S*(reussir-tcf|tcf-canada)\S*", re.I)   # the watermark site; other URLs are content
L = "A-Za-zÀ-ÖØ-öø-ÿœŒæÆ"
TOKEN = re.compile(rf"https?://\S+|www\.\S+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|\w+(?:\.\w+)*\.(?:fr|com|net|org|ca|be|ch)\b|\d+(?:[.,]\d+)+|"
                   rf"[{L}]+(?:['’-][{L}]+)*|\d+|\n|[^\s{L}\d]")
LETTERS = re.compile(rf"[{L}]")
INVERSION = re.compile(r"-(t-)?(je|tu|il|elle|on|nous|vous|ils|elles|ce)$")   # trouve-t-on
ELISIONS = {"c", "d", "j", "l", "m", "n", "s", "t", "qu", "jusqu", "lorsqu", "puisqu", "quoiqu", "presqu", "quelqu"}
MAX_SPAN = 4                                       # longer disagreements are alignment failures

FORMS = None
BY_INITIAL = {}                                    # first letter -> dictionary forms, for suggestions
FIXES = {}
RULES = Counter()                                  # how many disagreements each rule settled
LOG = []


def norm(w):
    return w.lower().replace("’", "'").replace("œ", "oe").replace("æ", "ae")


def is_word(w):
    """Dictionary check on every alphabetic part (handles l'école, c'est-à-dire)."""
    elided, _, rest = w.rpartition("'") if "'" in w else w.rpartition("’")
    if elided and norm(elided) not in ELISIONS:
        rest = w
    parts = [p for p in re.split(r"['’-]", rest) if p]
    return bool(parts) and all(norm(p) in FORMS or simplemma.is_known(p.lower(), lang="fr") for p in parts)


def whole_word(w):
    """Like is_word, but a hyphenated compound must be in the list as a whole (savoir-faire, not actives-et)."""
    w = INVERSION.sub("", w)
    return norm(w) in FORMS if "-" in w else is_word(w)


def spaced_tokens(text):
    """[[space before, token], ...]; the space is "" or " ", line breaks are their own token."""
    text, out, prev = URL.sub(" ", text), [], 0
    for m in TOKEN.finditer(text):
        out.append([" " if m.start() > prev else "", m.group()])   # anything between tokens is whitespace
        prev = m.end()
    return out


def tokens(text):
    return [t for _, t in spaced_tokens(text)]


def strip_latex(text):
    """PaddleOCR-VL sometimes writes decorated text as a formula: \\(\\underline{\\text{Nouveau !}}\\)."""
    text = re.sub(r"</?\w+>", "", text)                 # <sup>e</sup>
    text = re.sub(r"\\[()\[\]]|\$", " ", text)
    text = re.sub(r"\\(text|textbf|textit|mathrm|mathbf|underline|overline)\s*", "", text)
    text = re.sub(r"\\[A-Za-z]+", " ", text)          # \varepsilon, \circ, ... : unreadable, Vision fills in
    return re.sub(r"[{}^_]", "", text)


def vision_lines(name):
    lines = json.loads((VISION_DIR / f"{name}.json").read_text())
    return [l for l in lines if l["text"].strip() and not WATERMARK.match(l["text"].strip())
            and not URL.fullmatch(l["text"].strip())]


def dehyphenate(t):
    """A line-break hyphen PaddleOCR-VL kept inside a word: de-vant -> devant, franco-phones -> francophones."""
    if "-" not in t or whole_word(t) or re.fullmatch(r"t-(il|elle|on|ils|elles)", t) or INVERSION.search(t):
        return t                                   # demande-t-il: "t-il" is not "til"
    joined = t.replace("-", "")
    return joined if is_word(joined) else t


def drop_cap(fragment, hint):
    """'undi' -> 'Lundi'. hint: a letter one engine read for the drop cap, if any."""
    if not fragment[:1].islower() or is_word(fragment):
        return None
    fits = [c + fragment for c in string.ascii_uppercase + "ÀÉ" if is_word(c + fragment)]
    if hint and hint.upper() + fragment in fits:
        return hint.upper() + fragment
    return fits[0] if len(fits) == 1 else None


def fix_drop_cap(base):
    """A lone capital or nothing before a lowercase non-word near the start: 'I undi' -> 'Lundi'."""
    idx = [i for i, (_, t) in enumerate(base) if t != "\n"][:3]
    for n, i in enumerate(idx):
        prev = idx[n - 1] if n else None
        hint = base[prev][1] if prev is not None and len(base[prev][1]) == 1 and base[prev][1].isalpha() else None
        fixed = drop_cap(base[i][1], hint)
        if fixed:
            base[i][1] = fixed
            if hint:
                base[i][0] = base[prev][0]
                del base[prev]
            break
    return base


def settle(v, p, conf, at_start=False, at_end=False):
    """Pick between Vision words v and PaddleOCR-VL words p (lists). -> (pick or None, rule name)
    at_start / at_end: v begins / ends the Vision line, where hyphenated words are split."""
    jv, jp = "".join(v), "".join(p)
    if len(p) == 1 and jv and len(jp) >= len(jv) + 3 and whole_word(jp) and (
            (at_end and norm(jp).startswith(norm(jv))) or (at_start and norm(jp).endswith(norm(jv)))):
        return p, "word cut at a line break"       # sympa- / thisants  vs  sympathisants
    if re.fullmatch(r"er|e|ème|ère", jp) and not is_word(jv):
        return p, "ordinal"                        # 1 er, 7 e
    if re.fullmatch(r"[lI1]er", jv) and re.fullmatch(r"1(er)?", jp):
        return ["1er"], "1er"                      # Vision reads the 1 of "1er" as l
    if (any(t in ("-", "'", "’") or t.endswith("-") for t in v) and all(whole_word(t) for t in p if LETTERS.search(t))) \
            or any("-" in t and whole_word(t) and norm(t).endswith(norm(jv)) for t in p):
        return p, "word cut at a line break"       # chef - / d'œuvre  vs  chef-d'œuvre
    if norm(jv) == norm(jp):                       # spacing / apostrophe / œ differences
        for side in (v, p):                        # "elle voudra" beats "ellevoudra"
            if all(is_word(t) for t in side if LETTERS.search(t)):
                return side, "spacing"
        return ([jv] if is_word(jv) else p), "spacing"
    wv = [t for t in v if LETTERS.search(t)]
    wp = [t for t in p if LETTERS.search(t)]
    if conf >= 1 and len(wv) == len(wp) == 1 and len(wv[0]) > len(wp[0]) + 2 and norm(wv[0]).startswith(norm(wp[0])):
        return v, "paddle cut the word short"      # Structurellement vs Structure (not every word is in the list)
    ok_v = bool(wv) and all(is_word(t) for t in wv)
    ok_p = bool(wp) and all(is_word(t) for t in wp)
    if ok_v and not ok_p:
        return v, "only vision is a word"
    if ok_p and not ok_v:
        return p, "only paddle is a word"
    if ok_v and ok_p:
        return (v, "both words, vision conf 1") if conf >= 1 else (p, "both words, vision conf < 1")
    if not wv and not wp:
        return p, "punctuation"
    if wv and wp and all(re.sub(r"^\w['’]", "", t)[:1].isupper() for t in wv + wp):
        return (v if conf >= 1 else p), "names"    # not in the word book anyway
    return None, "open"


def recovered(missing, base):
    """Clean Vision lines absent from PaddleOCR-VL's text, column by column."""
    seq = [norm(t) for _, t in base if LETTERS.search(t)]
    present, pairs = set(seq), set(zip(seq, seq[1:]))
    keep = []
    for line in missing:
        words = [t for t in tokens(line["text"]) if LETTERS.search(t)]
        checked = [INVERSION.sub("", t) for t in words if len(t) >= 3 and not t[:1].isupper()]
        unknown = sum(1 for t in checked if t and not is_word(t))
        source_line = re.match(r"D['’]après\b", line["text"].strip())     # D'après radiofrance.net
        if line["conf"] < 0.5 or len(words) < 2 or (
                unknown > (1 if len(words) >= 6 and line["conf"] >= 1 else 0) and not source_line):
            continue                               # garbled, or too short to place
        nw = [norm(t) for t in words]
        found = [p in pairs for p in zip(nw, nw[1:])] or [w in present for w in nw]
        if sum(found) >= 0.5 * len(found):
            continue                               # the phrase is in the text already
        keep.append(line)
    keep.sort(key=lambda l: (l["x"] > 0.45, l["y"]))
    return " ".join(l["text"].strip() for l in keep)


def suggest(w):
    """Closest dictionary form, for the review list (same first letter, similar length)."""
    pool = [f for f in BY_INITIAL.get(w[:1], ()) if abs(len(f) - len(w)) <= 2]
    guess = difflib.get_close_matches(w, pool, n=1, cutoff=0.8)
    return guess[0] if guess else None


def locate(words, vt):
    """The stretch of PaddleOCR-VL tokens that Vision line vt corresponds to -> (window, start) or (None, None).

    Anchored on the longest exact run of shared tokens, so that a stray "de" far away
    cannot stretch the window; a few tokens of slack on each side."""
    a, b = [norm(t) for t in words], [norm(t) for t in vt]
    m = difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    anchor_len = sum(len(t) for t in vt[m.b:m.b + m.size] if LETTERS.search(t))
    if m.size == 0 or (m.size < 2 and anchor_len < 4):
        return None, None                          # one short shared word is no evidence
    wlo = max(m.a - m.b - 3, 0)
    near = a[wlo:min(m.a + (len(vt) - m.b) + 3, len(a))]
    blocks = [x for x in difflib.SequenceMatcher(None, near, b, autojunk=False).get_matching_blocks() if x.size]
    if sum(x.size for x in blocks) < max(1, (len(vt) + 1) // 2):
        return None, None                          # half the line must match ("Où est Camilo ?" is not "Camilo est né")
    # trim the slack: the line starts where its first matched token says it does
    lo = wlo + max(blocks[0].a - blocks[0].b, 0)
    hi = wlo + min(blocks[-1].a + len(vt) - blocks[-1].b, len(near))
    return words[lo:hi], lo


def render(spaced):
    text = "".join(("" if t == "\n" else s) + t for s, t in spaced)
    text = re.sub(r"[ \t]*\n[ \t]*", "\n", text).strip()
    text = re.sub(r"(^|\n)Ie\b", r"\1Le", text)
    text = re.sub(r"\bIe\b", "le", text)               # PaddleOCR-VL reads l as I
    return re.sub(r"\b(\d+|[XVI]+) (er|ère|e|ème)\b", r"\1\2", text)    # 1 er -> 1er, XXI e -> XXIe


def merge(name):
    base = [[s, dehyphenate(t)] for s, t in spaced_tokens(strip_latex((VLM_DIR / f"{name}.txt").read_text()))
            if not WATERMARK_TOKEN.match(t)]
    base = fix_drop_cap(base)
    words = [t for _, t in base]
    edits = {}                                     # base index -> (end index, replacement [[space, token]])
    open_items = []
    missing = []                                   # Vision lines PaddleOCR-VL skipped (it drops whole blocks)
    for line in vision_lines(name):
        vs = spaced_tokens(line["text"])
        vt = [t for _, t in vs]
        if not vt:
            continue
        win, lo = locate(words, vt)
        if win is None:
            missing.append(line)                   # line not found in the PaddleOCR-VL text
            continue
        sm = difflib.SequenceMatcher(None, [norm(t) for t in win], [norm(t) for t in vt], autojunk=False)
        for op, a1, a2, b1, b2 in sm.get_opcodes():
            if op == "equal":
                continue
            p, v = win[a1:a2], vt[b1:b2]
            if line["conf"] < 0.5 or max(len(p), len(v)) > MAX_SPAN:
                RULES["skipped (garbled or too long)"] += 1
                continue                           # Vision is garbled here; keep PaddleOCR-VL
            pick, rule = settle(v, p, line["conf"], at_start=not any(LETTERS.search(t) for t in vt[:b1]),
                                at_end=not any(LETTERS.search(t) for t in vt[b2:]))
            RULES[rule] += 1
            LOG.append({"image": name, "rule": rule, "vision": " ".join(v), "paddle": " ".join(p)})
            if pick is None:
                ctx = " ".join(win[max(0, a1 - 4):a2 + 4])
                guess = suggest(norm("".join(p)))
                open_items.append({"vision": " ".join(v), "paddle": " ".join(p), "context": ctx,
                                   "suggest": guess[0] if guess else None})
            elif pick is not p:
                # keep the base spacing in front of the replaced stretch, Vision's spacing inside it
                rep = [list(x) for x in vs[b1:b2]] if pick is v else [[" ", t] for t in pick]
                if rep and (b1 == 0 or pick is not v):   # no Vision spacing before it: keep the text's
                    rep[0][0] = base[lo + a1][0] if a2 > a1 else " "
                edits[lo + a1] = (lo + a2, rep)
    out, i = [], 0
    while i <= len(base):
        if i in edits:
            end, rep = edits[i]
            out += rep
            if end > i:
                i = end
                continue
        if i < len(base):
            out.append(base[i])
        i += 1
    text, extra = render(out), recovered(missing, base)
    for wrong, right in FIXES.get(name, []):
        # whole words only ("es néo-nomades" must not hit "Les néo-nomades"); a space may be a line break
        pat = re.compile(r"(?<!\w)" + r"\s+".join(map(re.escape, wrong.split())) + r"(?!\w)")
        if pat.search(text) or pat.search(extra):
            text, extra = pat.sub(lambda _: right, text), pat.sub(lambda _: right, extra)
            open_items = [o for o in open_items if wrong not in o["context"]]
    return {"text": text, "extra": extra, "open": open_items}


def main():
    global FORMS
    FORMS = {norm(l.strip()) for l in WORDLIST.open(encoding="utf-8") if l.strip()}
    for f in FORMS:
        BY_INITIAL.setdefault(f[:1], []).append(f)
    FIXES.update(json.loads(FIXES_IN.read_text()))
    names = sorted(p.stem for p in VLM_DIR.glob("*.txt"))
    merged = {n: merge(n) for n in names if (VISION_DIR / f"{n}.json").exists()}
    OUT.write_text(json.dumps(merged, ensure_ascii=False, indent=1))
    LOG_OUT.parent.mkdir(exist_ok=True)
    LOG_OUT.write_text(json.dumps(LOG, ensure_ascii=False, indent=0))
    for rule, n in RULES.most_common():
        print(f"  {n:5}  {rule}")
    n_open = sum(len(m["open"]) for m in merged.values())
    print(f"{sum(1 for m in merged.values() if m['extra'])} images with lines PaddleOCR-VL skipped, added back from Vision")
    print(f"{len(merged)} images, {n_open} open disagreements in "
          f"{sum(1 for m in merged.values() if m['open'])} images -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
