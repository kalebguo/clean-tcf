"""Export the CO/CE TCF notes from the Anki collection into data/questions.json.

Reads a temporary copy of collection.anki2 (Anki can stay open), cleans the
fields, and adds the OCR text of the reading images: the checked merge of two OCR
passes in data/ocr_merged.json (scripts/merge_ocr.py), or Vision alone (data/ocr/)
for images that have not been through the second pass.
"""
import difflib
import html
import json
import os
import re
import shutil
import sqlite3
import tempfile
from pathlib import Path

ANKI = Path.home() / "Library/Application Support/Anki2/User 1"
ROOT = Path(__file__).resolve().parent.parent
OCR_DIR = ROOT / "data/ocr"
MERGED = ROOT / "data/ocr_merged.json"
OUT = ROOT / "data/questions.json"
OVERRIDES = ROOT / "data/overrides.json"
OVERRIDABLE = {"answer", "options", "question", "passage", "transcript", "analysis", "disputed"}
DISPUTE = re.compile(r"标答|标准答案|答案有误|答案错误|无正确答案|题目有误")

LEVEL_BY_POINTS = {3: "A1", 9: "A2", 15: "B1", 21: "B2", 26: "C1", 33: "C2"}
# Field order of the two Anki note types.
CO_FIELDS = ["Options", "Audio", "Image", "Transcription", "Answer", "Analyze", "Test", "Series", "Number", "Points"]
CE_FIELDS = ["Question", "Options", "Series", "Number", "Points", "Answer", "Analyze", "Test", "Qphrase"]
WATERMARK = re.compile(r"^(t?cf|c?anada|tcf\s*canada|anada|canad)$", re.I)
WORDLIST = ROOT.parent / "提香法语（超大词汇）.txt"
HYPHEN_PREFIX = {"ex", "vice", "demi", "semi", "mi"}   # always written with a hyphen
_forms = None


def join_hyphenated(left, right):
    """Join a line ending in '-' to the next: drop the hyphen of a word cut at the line
    break (gou-/vernement), keep the hyphen of a compound (au-/dessus, ex-/vieux)."""
    global _forms
    if _forms is None:
        _forms = {l.strip().lower() for l in WORDLIST.open(encoding="utf-8")} if WORDLIST.exists() else set()
    a = re.sub(r"^\w+['’]", "", left[:-1].rsplit(" ", 1)[-1]).lower()
    b = re.match(r"[\w'’-]*", right).group().lower()
    if f"{a}{b}" in _forms:
        return left[:-1] + right
    if f"{a}-{b}" in _forms or "-" in a or a in HYPHEN_PREFIX:
        return left + right
    return left[:-1] + right


def strip_html(s):
    s = re.sub(r"<br\s*/?>|</div>|</p>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    return html.unescape(s).replace("\xa0", " ")


def clean_num(s):
    s = s.strip()
    return s[:-2] if s.endswith(".0") else s


def parse_options(raw):
    """'A. foo,B. bar, C. baz,D. qux' -> ['foo', 'bar', 'baz', 'qux'] (labels assigned by position)."""
    text = strip_html(raw).strip()
    parts = re.split(r"(?:^|,)\s*[A-D]\s*\.\s*", text)
    parts = [p.strip().rstrip(",").strip() for p in parts[1:]]
    if len(parts) != 4:
        return None
    return parts


def parse_transcript(raw):
    lines = [re.sub(r"\s+", " ", l).strip() for l in strip_html(raw).split("\n")]
    return [l for l in lines if l]


def sanitize_analysis(raw):
    s = re.sub(r"<(?!/?(b|i|u|br|div|strong|em)\b)[^>]*>", "", raw.strip(), flags=re.I)
    s = re.sub(r"<(div|b|i|u|strong|em)\s[^>]*>", r"<\1>", s, flags=re.I)
    return s.strip()


def set_label(test):
    if test.isdigit():
        return f"第{int(test)}套"
    m = re.fullmatch(r"GR0?(\d+)", test)
    if m:
        return f"免费套题{m.group(1)}"
    return f"补充 {test}"


def set_sort_key(test):
    if test.isdigit():
        return (0, int(test), "")
    if test.startswith("GR"):
        return (1, int(re.sub(r"\D", "", test) or 0), "")
    return (2, int(re.sub(r"\D", "", test) or 0), test)


def read_ocr(image):
    """Split OCR lines of a reading image into passage text and the question line."""
    p = OCR_DIR / (Path(image).stem + ".json")
    if not p.exists():
        return None, None
    lines = json.loads(p.read_text())
    lines = [l for l in lines if l["text"].strip()]
    lines = [l for l in lines if not WATERMARK.match(l["text"].strip())
             and not re.search(r"www\.|\.com\b|reussir-tcf", l["text"], re.I)]
    # The question number sits in a small box at the bottom-left; the question
    # sentence is on the same row to its right.
    numbox = [l for l in lines if re.fullmatch(r"\d{1,2}", l["text"].strip()) and l["x"] < 0.12 and l["y"] > 0.6]
    question = []
    if numbox:
        y0 = max(numbox, key=lambda l: l["y"])["y"]
        question = [l for l in lines if l["y"] >= y0 - 0.04 and l["x"] > 0.12]
        lines = [l for l in lines if l not in question and l not in numbox]
    else:
        # Number box not recognised: fall back to a question-like last row on the right.
        tail = [l for l in lines if l["y"] > 0.8 and l["x"] > 0.15]
        if tail and re.search(r"[?:]\s*$", tail[-1]["text"]):
            question = tail
            lines = [l for l in lines if l not in question]
    question.sort(key=lambda l: (l["y"], l["x"]))
    q = " ".join(l["text"].strip() for l in question) or None
    return paragraphs(lines), q


_merged = None
END = re.compile(r"[.!?:;»\"”…)]$")               # a line that can end a paragraph


def read_merged(image, num, qphrase):
    """Passage paragraphs and question line from the merged OCR text, or None if not available.

    The text ends with the question number and the question, in one of these shapes:
      "...\n22\nQuelle conduite ... ?"     "...\n14 Que pourra-t-on ... ?"
      "...\nSelon l'auteur, quelle est l'origine du\n33\nproblème de ... ?"
      "Question : 24\n...\nLes jardins du quartier accueillent :"   (F sets: no number at the end)
    """
    global _merged
    if _merged is None:
        _merged = json.loads(MERGED.read_text()) if MERGED.exists() else {}
    m = _merged.get(Path(image).stem)
    if not m:
        return None
    lines, gap = [], False                         # a blank line in PaddleOCR-VL's text is a paragraph break
    for l in m["text"].split("\n"):
        l = l.strip()
        if not l or re.fullmatch(r"Question\s*:?\s*\d+", l, re.I):
            gap = gap or not l
            continue
        lines.append(("\n" if gap else "") + l)
        gap = False
    extra = m["extra"]
    question = []
    for i in range(len(lines) - 1, max(len(lines) - 5, -1), -1):
        hit = re.fullmatch(rf"0?{num}(?:\s+(.+))?", lines[i].lstrip("\n"))
        if not hit:
            continue
        before, after = lines[:i], ([hit.group(1)] if hit.group(1) else []) + lines[i + 1:]
        if not after and re.search(r"[?:]$", extra):
            after, extra = [extra], ""             # PaddleOCR-VL skipped the question; Vision had it
        elif not after and before and re.search(r"[?:]$", before[-1]):
            after = [before.pop()]                 # the question came before its number
        elif before and after and not END.search(before[-1]) and after[0][:1].islower():
            after = [before.pop()] + after         # first half of a two-line question
        lines, question = before, after
        break
    else:
        last = lines[-1] if lines else ""
        last = last.lstrip("\n")
        if qphrase and difflib.SequenceMatcher(None, last.lower(), qphrase.lower()).ratio() > 0.8:
            lines = lines[:-1]                     # the image repeats the Anki question
        elif not qphrase and re.search(r"[?:]$", last):
            lines, question = lines[:-1], [last]
    paras = []
    for line in lines:
        if line.startswith("\n"):
            paras.append(line[1:])
        elif paras and paras[-1].endswith("-") and line[:1].islower():
            paras[-1] = join_hyphenated(paras[-1], line)
        elif paras and (line[:1].islower() or (not END.search(paras[-1]) and len(paras[-1]) >= 40)):
            paras[-1] += " " + line                # PaddleOCR-VL gives visual lines: rejoin paragraphs
        else:
            paras.append(line)
    if extra:
        paras.append(extra)
    if not paras:
        return None
    return paras, " ".join(q.lstrip("\n") for q in question) or None


def paragraphs(lines):
    """Merge OCR boxes into rows, then rows into paragraphs (break on a large gap or a short row)."""
    rows = []
    for l in sorted(lines, key=lambda l: (l["y"], l["x"])):
        if rows and abs(l["y"] - rows[-1]["y"]) < 0.5 * min(l["h"], rows[-1]["h"]):
            r = rows[-1]
            r["parts"].append(l)
            r["right"] = max(r["right"], l["x"] + l["w"])
        else:
            rows.append({"y": l["y"], "h": l["h"], "parts": [l], "right": l["x"] + l["w"]})
    if not rows:
        return []
    for r in rows:
        r["text"] = " ".join(p["text"].strip() for p in sorted(r["parts"], key=lambda p: p["x"]))
    gaps = sorted(b["y"] - a["y"] for a, b in zip(rows, rows[1:]))
    pitch = gaps[len(gaps) // 2] if gaps else 0
    widest = max(r["right"] for r in rows)
    paras, cur = [], [rows[0]["text"]]
    for prev, r in zip(rows, rows[1:]):
        gap = r["y"] - prev["y"]
        if gap > 1.45 * pitch or prev["right"] < 0.6 * widest:
            paras.append(cur)
            cur = []
        cur.append(r["text"])
    paras.append(cur)

    def join(ls):
        out = ls[0]
        for l in ls[1:]:
            out = join_hyphenated(out, l) if out.endswith("-") and l[:1].islower() else out + " " + l
        return out
    return [join(p) for p in paras]


def _shingles(text, k=5):
    t = re.sub(r"[^a-zà-ÿœ0-9]", "", text.lower())
    return {t[i:i + k] for i in range(max(1, len(t) - k + 1))}


def mark_duplicates(questions, split=(), merge=(), threshold=0.8):
    """The decks are already deduplicated by their author; catch the few repeats left.

    Two questions are the same item when their text (listening transcript, or reading
    passage + question) has shingle-Jaccard >= threshold and the option sets agree.
    The first one in set order is canonical; the others get duplicateOf.
    """
    ordered = sorted(questions, key=lambda q: (q["section"], set_sort_key(q["set"]), q["num"]))
    canon = []   # (question, shingles, options)
    for q in ordered:
        if q["id"] in split:
            continue
        if q["section"] == "CO":
            body = " ".join(re.sub(r"^[A-D]\.\s*", "", l) for l in q["transcript"])
        else:
            body = " ".join(q.get("passage") or []) + " " + (q.get("question") or "")
        sh = _shingles(body)
        opts = {re.sub(r"\W+", "", o.lower()) for o in q["options"] if o}
        for c, csh, copts in canon:
            if c["section"] != q["section"] or (opts and copts and opts != copts):
                continue
            if len(sh & csh) / len(sh | csh) >= threshold:
                q["duplicateOf"] = c["id"]
                break
        else:
            canon.append((q, sh, opts))
    by_id = {q["id"]: q for q in questions}
    for keep, dup in merge:
        if keep in by_id and dup in by_id:
            by_id[dup]["duplicateOf"] = by_id[keep].get("duplicateOf", keep)


def apply_overrides(questions):
    """Patch fields from data/overrides.json; return (split ids, merge pairs)."""
    if not OVERRIDES.exists():
        OVERRIDES.write_text(json.dumps({"questions": {}, "duplicates": {"merge": [], "split": []}},
                                        ensure_ascii=False, indent=2) + "\n")
    ov = json.loads(OVERRIDES.read_text())
    by_id = {q["id"]: q for q in questions}
    for qid, patch in ov.get("questions", {}).items():
        if qid not in by_id:
            print(f"  overrides: unknown question {qid}")
            continue
        for field, value in patch.items():
            if field == "why":
                continue
            if field not in OVERRIDABLE:
                print(f"  overrides: {qid}: field '{field}' cannot be overridden")
                continue
            by_id[qid][field] = value
            print(f"  overrides: {qid}.{field} applied")
    dup = ov.get("duplicates", {})
    for pair in dup.get("merge", []):
        for qid in pair:
            if qid not in by_id:
                print(f"  overrides: unknown question {qid} in duplicates.merge")
    return set(dup.get("split", [])), [tuple(p) for p in dup.get("merge", []) if len(p) == 2]


def main():
    tmp = Path(tempfile.mkdtemp()) / "col.anki2"
    shutil.copy(ANKI / "collection.anki2", tmp)
    db = sqlite3.connect(tmp)
    notetypes = {name: mid for mid, name in db.execute("select id, name from notetypes")}
    decks = {did: name for did, name in db.execute("select id, name from decks")}
    rows = db.execute("select n.id, n.mid, n.flds, c.did from notes n join cards c on c.nid = n.id").fetchall()

    questions, problems = [], []
    for nid, mid, flds, did in rows:
        if mid == notetypes["CO_TCFCA"]:
            section, names = "CO", CO_FIELDS
        elif mid == notetypes["CE_TCFCA"]:
            section, names = "CE", CE_FIELDS
        else:
            continue
        f = dict(zip(names, flds.split("\x1f")))
        test = clean_num(f["Test"])
        num = int(float(clean_num(f["Number"])))
        points = int(float(f["Points"]))
        answer = strip_html(f["Answer"]).strip().rstrip(".").strip()
        opts = parse_options(f["Options"])
        if opts is None:
            problems.append((section, test, num, "options", f["Options"][:80]))
            opts = ["", "", "", ""]
        if answer not in "ABCD" or not answer:
            problems.append((section, test, num, "answer", answer))
        q = {
            "id": f"{section}-{test}-{num:02d}",
            "noteId": nid,
            "section": section,
            "set": test,
            "setLabel": set_label(test),
            "series": clean_num(f["Series"]) or None,
            "num": num,
            "points": points,
            "level": LEVEL_BY_POINTS.get(points),
            "options": opts,
            "answer": answer,
            "analysis": sanitize_analysis(f["Analyze"]) or None,
            "deck": decks.get(did),
        }
        if section == "CO":
            q["audio"] = f["Audio"].strip() or None
            q["image"] = f["Image"].strip() or None
            q["transcript"] = parse_transcript(f["Transcription"])
        else:
            q["image"] = f["Question"].strip() or None
            qphrase = re.sub(r"\s+", " ", strip_html(f["Qphrase"])).strip()
            passage, ocr_q = read_ocr(q["image"]) if q["image"] else (None, None)
            merged = read_merged(q["image"], num, qphrase) if q["image"] else None
            if merged:
                passage, ocr_q = merged[0], merged[1] or ocr_q
            q["passage"] = passage
            q["question"] = qphrase or ocr_q
        questions.append(q)

    for q in questions:
        q["disputed"] = bool(q["analysis"] and DISPUTE.search(strip_html(q["analysis"])))
    split, merge = apply_overrides(questions)
    mark_duplicates(questions, split, merge)

    questions.sort(key=lambda q: (q["section"], set_sort_key(q["set"]), q["num"]))
    sets = {}
    for q in questions:
        s = sets.setdefault((q["section"], q["set"]), {"section": q["section"], "id": q["set"],
                                                       "label": q["setLabel"], "series": set(), "count": 0})
        s["count"] += 1
        if q["series"]:
            s["series"].add(q["series"])
    sets = [dict(s, series=sorted(s["series"]), complete=s["count"] == 39)
            for s in sorted(sets.values(), key=lambda s: (s["section"], set_sort_key(s["id"])))]

    OUT.write_text(json.dumps({"sets": sets, "questions": questions}, ensure_ascii=False, indent=1))
    print(f"wrote {len(questions)} questions, {len(sets)} sets -> {OUT.relative_to(ROOT)}")
    missing_ocr = sum(1 for q in questions if q["section"] == "CE" and not q.get("passage"))
    print(f"CE without OCR text: {missing_ocr}; CE without question line: "
          f"{sum(1 for q in questions if q['section'] == 'CE' and not q.get('question'))}")
    for p in problems:
        print("  check:", *p)
    os.remove(tmp)


if __name__ == "__main__":
    main()
