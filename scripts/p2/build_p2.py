"""Build the per-question P2 files the site reads (SPEC-P2 §8).

Inputs:  data/p2/gen/<qid>.json, data/p2/mt/<qid>.json, data/p2/reviewed.json, public/data/{listening,reading}.json,
         data/p2/dict/entries.json + data/vocab.json
Outputs: public/data/p2/q/<qid>.json   one file per question that has generated content
         public/data/p2/index.json     { qid: {gen, reviewed, stale} }
         public/data/p2/dict.json      dictionary entries merged with the word statistics (vocabulary book)
         public/data/p2/conj.json      conjugation tables of the verbs in the vocabulary (loaded on demand)
         public/data/p2/align/<qid>.json  listening timeline (SPEC §5.B), when it still matches the transcript
         public/data/p2/tts/<qid>.json    reading aloud (SPEC §5.A), when it still matches the text and its audio exists
         data/p2/stale.txt             questions whose generated file no longer matches the bank

Positions are computed here so the site never matches text itself:
  segments[].spans  where each sentence sits in the original lines / paragraphs
  evidence[]        field, block index and character range of each quote
A generated file that no longer validates against the bank is "stale": its translations
are kept (shown per field, not per line), its spans and evidence are dropped, and its
analysis is kept only if it still marks the current official answer as correct.

data/p2/mt holds translations only (local model, scripts/p2/local_mt.py). They are used for
questions without a Sonnet file, and instead of a stale Sonnet file's translations (whose
analysis is then kept on the same terms). The site does not tell the two sources apart.

Usage: .venv/bin/python scripts/p2/build_p2.py
"""
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tts import DATA as TTS, MEDIA as TTS_MEDIA, text_src  # noqa: E402
from validate_gen import LETTERS, fields_of, load_bank, segment_spans, validate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
GEN = ROOT / "data/p2/gen"
MT = ROOT / "data/p2/mt"
OUT = ROOT / "public/data/p2"
REVIEWED = ROOT / "data/p2/reviewed.json"
DICT = ROOT / "data/p2/dict/entries.json"
CONJ = ROOT / "data/p2/dict/conj.json"
BRIEF = ROOT / "data/p2/dict/brief.json"  # scripts/p2/dict_brief.py
PHRASES = ROOT / "data/p2/dict/phrases.json"  # scripts/p2/dict_brief.py phrases
VOCAB = ROOT / "data/vocab.json"
# word statistics the site needs from vocab.json (SPEC-P2 §7.2: kept there, not duplicated in entries.json)
VOCAB_KEYS = ("posLabel", "level", "band", "tf", "df", "rank", "forms", "function", "verified")
STALE = ROOT / "data/p2/stale.txt"
ALIGN = ROOT / "data/p2/align"


def source_hash(q):
    """FNV-1a (32 bit) over the UTF-16 code units of the question's source text.

    Must match sourceHash() in src/data/p2.ts, which re-checks it in the browser so a
    bank rebuilt without re-running this script cannot misplace sentences.
    """
    parts = [q["answer"], *q["options"], "#t", *(q.get("transcript") or []),
             "#q", q.get("question") or "", "#p", *(q.get("passage") or [])]
    h = 0x811C9DC5
    data = "\x1f".join(parts).encode("utf-16-le")
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def locate(fr, blocks):
    """(block, start, end) of quote fr in blocks, whitespace-insensitive; None if absent."""
    tokens = fr.split()
    if not tokens:
        return None
    pat = re.compile(r"\s+".join(map(re.escape, tokens)))
    for i, b in enumerate(blocks):
        m = pat.search(b)
        if m:
            return i, m.start(), m.end()
    return None


def analysis_of(gen, q):
    """The analysis (and its answer check) if it still marks the current official answer as correct."""
    an = gen.get("analysis") or {}
    marks_answer = all(an.get("options", {}).get(L, {}).get("correct") is (L == q["answer"]) for L in LETTERS)
    return {"analysis": an, "check": gen.get("check")} if an and marks_answer else {}


def build_one(gen, q, reviewed, translation_only=False):
    errors, _ = validate(gen, q, translation_only)
    stale = bool(errors)
    out = {"id": q["id"], "hash": source_hash(q)}
    if stale:
        out["stale"] = True
    if reviewed:
        out["reviewed"] = True

    segs = gen.get("segments") or []
    if stale:
        out["segments"] = [{"field": s["field"], "zh": s["zh"], "en": s["en"], "spans": []} for s in segs]
    else:
        out["segments"] = []
        for field, blocks in fields_of(q):
            fsegs = [s for s in segs if s["field"] == field]
            for s, pieces in zip(fsegs, segment_spans(fsegs, blocks)):
                out["segments"].append({
                    "field": field, "zh": s["zh"], "en": s["en"],
                    "spans": [{"index": b, "s": st, "e": en} for b, st, en in pieces],
                })

    out["options"] = gen.get("options")
    out.update(analysis_of(gen, q))

    if not stale:
        blocks = dict(fields_of(q))
        ev = []
        for e in gen.get("evidence") or []:
            hit = locate(e["fr"], blocks.get(e["field"], []))
            if hit:
                ev.append({"letter": e["letter"], "field": e["field"], "index": hit[0], "s": hit[1], "e": hit[2]})
        out["evidence"] = ev
    return out


def build_dict():
    """public/data/p2/dict.json: one entry per lemma of the current vocab, dictionary data where we have it."""
    if not VOCAB.exists():
        return 0
    entries = {e["lemma"]: e for e in json.loads(DICT.read_text())} if DICT.exists() else {}
    brief = json.loads(BRIEF.read_text()) if BRIEF.exists() else {}
    phrase_zh = json.loads(PHRASES.read_text()) if PHRASES.exists() else {}
    out = []
    for w in json.loads(VOCAB.read_text())["words"]:
        e = dict(entries.get(w["lemma"]) or {"lemma": w["lemma"], "pos": w["pos"], "zh": [], "examples": []})
        e.pop("source", None)
        if not e["examples"]:
            e["examples"] = [{"qid": x["q"], "fr": x["text"]} for x in w.get("examples") or []]
        e.update({k: w[k] for k in VOCAB_KEYS if k in w})
        if w["lemma"] in brief:
            e["brief"] = brief[w["lemma"]]["brief"]
            if brief[w["lemma"]].get("mt"):
                e["briefMt"] = True
        if e.get("phrases"):
            e["phrases"] = [{**p, **phrase_zh.get(p["fr"], {})} for p in e["phrases"]]  # + zh, mt
        out.append(e)
    (OUT / "dict.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    if CONJ.exists():
        conj = json.loads(CONJ.read_text())
        (OUT / "conj.json").write_text(json.dumps({e["lemma"]: conj[e["lemma"]] for e in out if e["lemma"] in conj},
                                                  ensure_ascii=False, separators=(",", ":")))
    return len(out)


def build_align(bank):
    """public/data/p2/align/<qid>.json from data/p2/align (scripts/p2/align_audio.py), compact:
    lines [start, end, score] or null, words [line, s, e, start, end]. A file made for an older
    transcript is left out (its offsets would point at the wrong words)."""
    out_dir = OUT / "align"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    written = outdated = 0
    for p in sorted(ALIGN.glob("*.json")) if ALIGN.exists() else []:
        a = json.loads(p.read_text())
        q = bank.get(p.stem)
        if q is None or hashlib.sha1("\n".join(q.get("transcript") or []).encode()).hexdigest()[:12] != a["src"]:
            outdated += 1
            continue
        compact = {
            "hash": source_hash(q),
            "lines": [None if l["start"] is None else [l["start"], l["end"], l["score"]] for l in a["lines"]],
            "words": [[w["line"], w["s"], w["e"], w["start"], w["end"]] for w in a["words"]],
        }
        (out_dir / f"{p.stem}.json").write_text(json.dumps(compact, separators=(",", ":")))
        written += 1
    return written, outdated


def build_tts(bank):
    """public/data/p2/tts/<qid>.json from data/p2/tts (scripts/p2/tts.py), compact: words
    [field 0 passage / 1 question, index, s, e, start, end]. Left out when the text changed since or
    the audio (public/media-tts, not in git) is missing."""
    out_dir = OUT / "tts"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)
    written = left_out = 0
    for p in sorted(TTS.glob("*.json")) if TTS.exists() else []:
        t = json.loads(p.read_text())
        q = bank.get(p.stem)
        if q is None or text_src(q) != t["src"] or not (TTS_MEDIA / f"{p.stem}.m4a").exists():
            left_out += 1
            continue
        compact = {
            "hash": source_hash(q), "voice": t["voice"], "dur": t["duration"],
            "words": [[0 if w[0] == "passage" else 1, *w[1:]] for w in t["words"]],
        }
        (out_dir / f"{p.stem}.json").write_text(json.dumps(compact, separators=(",", ":")))
        written += 1
    return written, left_out


def main():
    bank = load_bank()
    reviewed = json.loads(REVIEWED.read_text()) if REVIEWED.exists() else {}
    qdir = OUT / "q"
    if qdir.exists():
        shutil.rmtree(qdir)
    qdir.mkdir(parents=True)

    gens = {p.stem: json.loads(p.read_text()) for p in GEN.glob("*.json")}
    mts = {p.stem: json.loads(p.read_text()) for p in MT.glob("*.json")} if MT.exists() else {}
    index, stale, local = {}, [], 0
    for qid in sorted(set(gens) | set(mts)):
        q = bank.get(qid)
        if q is None:
            print(f"skip {qid}: not in the bank")
            continue
        gen, mt = gens.get(qid), mts.get(qid)
        out = build_one(gen, q, qid in reviewed) if gen else None
        if out and out.get("stale"):
            stale.append(qid)  # the Sonnet file needs regenerating for the current text
        if mt and (out is None or out.get("stale")):
            fresh = build_one(mt, q, False, translation_only=True)
            if out is None or not fresh.get("stale"):
                if gen:
                    fresh.update(analysis_of(gen, q))
                out = fresh
                local += 1
        (qdir / f"{qid}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        index[qid] = {"gen": True, "reviewed": bool(out.get("reviewed")), "stale": bool(out.get("stale"))}

    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    STALE.write_text("".join(f"{qid}\n" for qid in stale))
    shown_stale = sum(e["stale"] for e in index.values())
    print(f"{len(index)} questions written to {qdir.relative_to(ROOT)} ({local} with local translations), "
          f"{shown_stale} shown as stale; {len(stale)} Sonnet files need regenerating (listed in {STALE.relative_to(ROOT)})")
    print(f"{build_dict()} dictionary entries written to {(OUT / 'dict.json').relative_to(ROOT)}")
    written, outdated = build_align(bank)
    print(f"{written} listening timelines written to {(OUT / 'align').relative_to(ROOT)}" + (f", {outdated} left out (transcript changed since)" if outdated else ""))
    written, left_out = build_tts(bank)
    print(f"{written} read-alouds written to {(OUT / 'tts').relative_to(ROOT)}" + (f", {left_out} left out (text changed or audio missing)" if left_out else ""))


if __name__ == "__main__":
    main()
