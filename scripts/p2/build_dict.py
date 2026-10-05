"""Build the dictionary for the vocabulary book (SPEC-P2 §7) from Wiktionary dumps.

Sources (kaikki.org wiktextract JSONL, gzipped; download once into build/dict-raw/):
  zh-fr.jsonl.gz  Chinese Wiktionary, French words filed under 法语 (simplified)   -> Chinese glosses, IPA
  zh-fr-2.jsonl.gz                     … filed under 法語 (traditional; most words) -> Chinese glosses, IPA
  en-fr.jsonl.gz  English Wiktionary, French words   -> English glosses, IPA, audio, gender, phrases
  fr-fr.jsonl.gz  French Wiktionary, French words    -> French definitions, Chinese translations, synonyms, IPA, audio, gender, phrases
Only the lemmas of data/vocab.json are kept. Example sentences come from the question
bank (vocab.json), with the Chinese translation of that sentence from data/p2/gen.
Traditional characters are converted to simplified with the system ICU transform
(scripts/p2/hant2hans.swift, compiled into build/ on first use).

Output: data/p2/dict/entries.json (committed; frequency, level and forms stay in vocab.json)
Licence: Wiktionary content is CC BY-SA; the site's about text must credit it.

Usage: .venv/bin/python scripts/p2/build_dict.py
"""
import collections
import gzip
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RAW = ROOT / "build/dict-raw"
DUMPS = ("zh-fr", "zh-fr-2", "en-fr", "fr-fr")
HANT2HANS = ROOT / "build/hant2hans"
OUT = ROOT / "data/p2/dict/entries.json"
GEN = ROOT / "data/p2/gen"

# our part of speech (spaCy UPOS) -> Wiktionary pos names
POS = {
    "NOUN": {"noun"}, "VERB": {"verb"}, "ADJ": {"adj"}, "ADV": {"adv"}, "PRON": {"pron"},
    "ADP": {"prep"}, "DET": {"det", "article"}, "NUM": {"num"}, "SCONJ": {"conj"},
    "CCONJ": {"conj"}, "INTJ": {"intj"},
}
FIRST_WORD = re.compile(r'^\{"word": "((?:[^"\\]|\\.)*)"')
# leading part-of-speech labels in Chinese Wiktionary glosses, e.g. "n.f. 宣告" or "v.t. 宣布"
ZH_POS_LABEL = re.compile(r"^\s*((n|v|a|adj|adv|prép|prep|conj|pron|int|interj|loc|art|num)\.(\s*(m|f|t|i|pr|pl|inv)\.)*\s*)+")
CJK = re.compile(r"[一-鿿]")
WS = re.compile(r"\s+")


def squash(s):
    return WS.sub("", s)


def is_form_of(sense):
    tags = sense.get("tags") or []
    return "form-of" in tags or "alt-of" in tags or bool(sense.get("form_of"))


def entries_by_word(path, lemmas, prefilter):
    """{word: [entry, ...]} for the words in lemmas, streaming the gzipped JSONL."""
    out = collections.defaultdict(list)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if prefilter:
                m = FIRST_WORD.match(line)
                if not m or json.loads(f'"{m.group(1)}"') not in lemmas:
                    continue
            d = json.loads(line)
            w = d.get("word")
            if w in lemmas and any(not is_form_of(s) for s in d.get("senses") or []):
                out[w].append(d)
    return out


def pick(entries, pos):
    """Entries with our part of speech, or all of them when none matches."""
    want = POS.get(pos, set())
    same = [e for e in entries if e.get("pos") in want]
    return same or entries


def ipa_of(entries):
    for e in entries:
        for s in e.get("sounds") or []:
            ipa = s.get("ipa", "").strip()
            if ipa.startswith("\\") and ipa.endswith("\\"):  # French Wiktionary writes \a.nɔ̃s\
                return "/" + ipa[1:-1] + "/"
            if ipa.startswith("/"):
                return ipa
    return None


def audio_of(*groups):
    """mp3 of a recording, preferring ones from France (Canadian and regional ones are tagged)."""
    found = []
    for rank, entries in enumerate(groups):
        for e in entries:
            for s in e.get("sounds") or []:
                url = s.get("mp3_url")
                if not url:
                    continue
                tags = " ".join((s.get("tags") or []) + (s.get("raw_tags") or []))
                regional = bool(tags) and "France" not in tags or "(" in tags  # e.g. "Canada", "Vendée (France)"
                found.append((regional, rank, url))
    return min(found)[2] if found else None


def gender_of(entries):
    g = set()
    for e in entries:
        tags = list(e.get("tags") or [])
        for s in e.get("senses") or []:
            tags += s.get("tags") or []
        for t in e.get("head_templates") or []:
            exp = t.get("expansion", "")
            if re.search(r"\bm\b", exp):
                g.add("m")
            if re.search(r"\bf\b", exp):
                g.add("f")
        if "masculine" in tags:
            g.add("m")
        if "feminine" in tags:
            g.add("f")
    return {frozenset("m"): "m", frozenset("f"): "f", frozenset("mf"): "m/f"}.get(frozenset(g))


def zh_glosses(zh_entries, fr_entries):
    items = []
    for e in zh_entries:
        for s in e.get("senses") or []:
            if is_form_of(s):
                continue
            for g in s.get("glosses") or []:
                for part in re.split(r"[；;]", ZH_POS_LABEL.sub("", g)):
                    part = part.strip(" 。.，,")
                    usage_note = part.startswith(("(", "（")) and part.endswith((")", "）"))
                    if part and CJK.search(part) and "~" not in part and not usage_note:
                        items.append(part)
    for e in fr_entries:
        for t in e.get("translations") or []:
            if t.get("lang_code") == "zh" and t.get("word") and CJK.search(t["word"]):
                items.append(t["word"])
    out = []
    for x in items:
        if x not in out:
            out.append(x)
    return out[:5]


def en_glosses(entries):
    out = []
    for e in entries:
        for s in e.get("senses") or []:
            if is_form_of(s) or {"obsolete", "archaic"} & set(s.get("tags") or []):
                continue
            for g in s.get("glosses") or []:
                g = g.strip()
                if g and g not in out:
                    out.append(g if len(g) <= 90 else g[:87] + "…")
    return out[:4]


OLD_FR = ("Vieilli", "Désuet", "Archaïsme", "Obsolète", "Rare")


def fr_definitions(entries):
    """First two current-usage definitions from the French Wiktionary (monolingual)."""
    out = []
    for e in entries:
        for s in e.get("senses") or []:
            tags = set(s.get("tags") or [])
            raw = " ".join(s.get("raw_tags") or [])
            if is_form_of(s) or {"obsolete", "archaic", "dated", "rare"} & tags or any(t in raw for t in OLD_FR):
                continue
            for g in s.get("glosses") or []:
                g = g.strip()
                if g and g not in out:
                    out.append(g if len(g) <= 140 else g[:137] + "…")
    return out[:2]


def synonyms_of(entries, lemma):
    out = []
    for e in entries:
        for s in e.get("synonyms") or []:
            w = s.get("word", "").strip()
            if w and w != lemma and w not in out:
                out.append(w)
    return out[:6]


def phrases_of(lemma, groups, bank_text):
    """Multi-word expressions with the lemma that actually occur in the question bank."""
    cands = []
    for entries in groups:
        for e in entries:
            derived = list(e.get("derived") or [])
            for s in e.get("senses") or []:
                derived += s.get("derived") or []
            for d in derived:
                w = d.get("word", "").strip()
                if " " in w and lemma in w.split() and w not in cands:
                    cands.append(w)
    return [{"fr": w} for w in cands if f" {w.lower()} " in bank_text][:5]


def gen_sentences():
    """{qid: [(squashed French, Chinese)]} from the generated files."""
    out = {}
    for p in GEN.glob("*.json"):
        g = json.loads(p.read_text())
        out[g["id"]] = [(squash(s["fr"]), s["zh"]) for s in g.get("segments") or []]
    return out


def example_zh(text, segs):
    """Chinese of an example sentence: the generated sentence(s) it consists of, or the one containing it."""
    t = squash(text)
    inside = [(fr, zh) for fr, zh in segs if fr and fr in t]
    if inside and "".join(fr for fr, _ in inside) == t:
        return "".join(zh for _, zh in inside)
    for fr, zh in segs:
        if t in fr:
            return zh
    return None


def to_simplified(strings):
    """{string: simplified} through the system ICU Hant-Hans transform."""
    if not HANT2HANS.exists():
        HANT2HANS.parent.mkdir(exist_ok=True)
        subprocess.run(["swiftc", "-O", str(ROOT / "scripts/p2/hant2hans.swift"), "-o", str(HANT2HANS)], check=True)
    items = sorted({x.replace("\n", " ") for x in strings})
    res = subprocess.run([str(HANT2HANS)], input="\n".join(items) + "\n", capture_output=True, text=True, check=True)
    out = res.stdout.split("\n")[: len(items)]
    assert len(out) == len(items), "hant2hans returned a different number of lines"
    return dict(zip(items, out))


def bank_text():
    parts = []
    for name in ("listening", "reading"):
        for q in json.loads((ROOT / f"public/data/{name}.json").read_text())["questions"]:
            parts += [*(q.get("transcript") or []), q.get("question") or "", *(q.get("passage") or []), *q["options"]]
    text = " ".join(parts).lower().replace("’", "'")
    return " " + re.sub(r"[^\w'-]+", " ", text) + " "


def main():
    words = json.loads((ROOT / "data/vocab.json").read_text())["words"]
    lemmas = {w["lemma"] for w in words}
    for name in DUMPS:
        if not (RAW / f"{name}.jsonl.gz").exists():
            sys.exit(f"missing {RAW / name}.jsonl.gz — see SPEC-P2 §7.1 for the download links")

    print("reading Chinese Wiktionary…", flush=True)
    zh = entries_by_word(RAW / "zh-fr.jsonl.gz", lemmas, prefilter=True)
    for w, es in entries_by_word(RAW / "zh-fr-2.jsonl.gz", lemmas, prefilter=True).items():
        zh[w] += es
    print("reading English Wiktionary…", flush=True)
    en = entries_by_word(RAW / "en-fr.jsonl.gz", lemmas, prefilter=False)
    print("reading French Wiktionary…", flush=True)
    fr = entries_by_word(RAW / "fr-fr.jsonl.gz", lemmas, prefilter=True)
    sents = gen_sentences()
    text = bank_text()

    out = []
    for w in words:
        lemma, pos = w["lemma"], w["pos"]
        z, e, f = pick(zh.get(lemma, []), pos), pick(en.get(lemma, []), pos), pick(fr.get(lemma, []), pos)
        entry = {"lemma": lemma, "pos": pos}
        ipa = ipa_of(f) or ipa_of(e) or ipa_of(z)
        if ipa:
            entry["ipa"] = ipa
        if pos == "NOUN":
            g = gender_of(f) or gender_of(e)
            if g:
                entry["gender"] = g
        entry["zh"] = zh_glosses(z, f)
        eng = en_glosses(e)
        if eng:
            entry["en"] = eng
        frd = fr_definitions(f)
        if frd:
            entry["fr"] = frd
        ph = phrases_of(lemma, (f, e), text)
        if ph:
            entry["phrases"] = ph
        syn = synonyms_of(f, lemma)
        if syn:
            entry["synonyms"] = syn
        audio = audio_of(f, e, z)
        if audio:
            entry["audio"] = audio
        entry["examples"] = []
        for ex in w.get("examples") or []:
            item = {"qid": ex["q"], "fr": ex["text"]}
            t = example_zh(ex["text"], sents.get(ex["q"], []))
            if t:
                item["zh"] = t
            entry["examples"].append(item)
        entry["source"] = [s for s, got in (("zh.wiktionary", z), ("fr.wiktionary", f), ("en.wiktionary", e)) if got]
        out.append(entry)

    simple = to_simplified(z for x in out for z in x["zh"])
    for x in out:
        zh_items = []
        for z in x["zh"]:
            z = simple.get(z, z)
            if z not in zh_items:
                zh_items.append(z)
        x["zh"] = zh_items

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("[\n" + ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in out) + "\n]\n")

    # coverage report, overall and by frequency band
    bands = collections.defaultdict(lambda: collections.Counter())
    band_of = {w["lemma"]: w["band"] for w in words}
    for x in out:
        b = bands[band_of[x["lemma"]]]
        b["n"] += 1
        b["zh"] += bool(x["zh"])
        b["zh_or_en"] += bool(x["zh"] or x.get("en"))
        b["fr"] += "fr" in x
        b["ipa"] += "ipa" in x
        b["audio"] += "audio" in x
        b["ex_zh"] += any("zh" in ex for ex in x["examples"])
    print(f"{len(out)} entries -> {OUT.relative_to(ROOT)}")
    keys = ("zh", "zh_or_en", "fr", "ipa", "audio", "ex_zh")
    print(f"{'band':10} {'n':>5} " + " ".join(f"{k:>8}" for k in keys))
    total = collections.Counter()
    for band in ("function", "high", "mid", "low", "rare"):
        b = bands[band]
        total.update(b)
        print(f"{band:10} {b['n']:5} " + " ".join(f"{b[k] / max(1, b['n']):8.0%}" for k in keys))
    print(f"{'all':10} {total['n']:5} " + " ".join(f"{total[k] / max(1, total['n']):8.0%}" for k in keys))


if __name__ == "__main__":
    main()
