"""Inflection data from the English Wiktionary dump (build/dict-raw/en-fr.jsonl.gz).

Outputs (both committed, so the pipeline runs without the dump):
  data/lemma_map.json        {form: lemma} for words of the question bank that are not dictionary
                             headwords but an inflected form of one ("cherche" -> "chercher",
                             "courriels" -> "courriel"). vocab_mapreduce.py applies it to spaCy's lemmas.
  data/p2/dict/conj.json     conjugation of every verb of data/vocab.json:
                             {lemma: {aux, pp, ppr, t: {pres|impf|ps|fut|cond|subj: [je, tu, il, nous, vous, ils],
                                                         imp: [tu, nous, vous]}}}
                             compound tenses are built on the site from aux + pp.

Usage: .venv/bin/python scripts/p2/build_forms.py   (after build_dict's download; run again when the dump changes)
"""
import gzip
import json
import re
from pathlib import Path

import simplemma

ROOT = Path(__file__).resolve().parent.parent.parent
DUMP = ROOT / "build/dict-raw/en-fr.jsonl.gz"
LEMMA_MAP = ROOT / "data/lemma_map.json"
CONJ = ROOT / "data/p2/dict/conj.json"

TENSES = {  # tense key -> tags that identify it (all must be present, "reflexive" aside)
    "pres": {"indicative", "present"},
    "impf": {"indicative", "imperfect"},
    "ps": {"indicative", "historic"},
    "fut": {"indicative", "future"},
    "cond": {"conditional"},
    "subj": {"subjunctive", "present"},
    "imp": {"imperative"},
}
PERSONS = [("first-person", "singular"), ("second-person", "singular"), ("third-person", "singular"),
           ("first-person", "plural"), ("second-person", "plural"), ("third-person", "plural")]
IMP_PERSONS = [("second-person", "singular"), ("first-person", "plural"), ("second-person", "plural")]
SKIP_FORM_OF = {"comparative", "superlative", "obsolete", "misspelling", "archaic"}
REFLEXIVE_PRONOUN = re.compile(r"^(?:me |te |se |nous |vous |m'|t'|s')", re.I)


def form_of_senses(senses):
    """True when every sense is an inflection of another word."""
    return bool(senses) and all("form-of" in (s.get("tags") or []) or s.get("form_of") for s in senses)


def conjugation(forms):
    """Table of one verb from its wiktextract forms; reflexive forms are used only when there are no others."""
    def table(reflexive):
        t, out = {k: [None] * (3 if k == "imp" else 6) for k in TENSES}, {}
        for f in forms:
            tags = set(f.get("tags") or [])
            word = f.get("form", "")
            if "multiword-construction" in tags or ("reflexive" in tags) != reflexive or word in ("", "-") or " + " in word:
                continue
            if tags >= {"participle", "past"}:
                out.setdefault("pp", word)
            elif tags >= {"participle", "present"}:
                out.setdefault("ppr", word)
            for key, need in TENSES.items():
                if not need <= tags:
                    continue
                persons = IMP_PERSONS if key == "imp" else PERSONS
                for i, p in enumerate(persons):
                    if set(p) <= tags and t[key][i] is None:
                        t[key][i] = word
        if not any(any(v) for v in t.values()):
            return None
        out["t"] = {k: v for k, v in t.items() if any(v)}
        return out
    conj = table(False) or table(True)
    if not conj:
        return None
    for f in forms:
        tags = set(f.get("tags") or [])
        if {"infinitive", "multiword-construction"} <= tags:
            conj["aux"] = "être" if f.get("form", "").startswith("être") else "avoir"
            break
    return conj


def main():
    questions = json.loads((ROOT / "data/questions.json").read_text())
    questions = questions["questions"] if isinstance(questions, dict) else questions
    text = " ".join(" ".join([*(q.get("transcript") or []), q.get("question") or "", *(q.get("passage") or []),
                              *q["options"]]) for q in questions)
    bank_words = set(re.findall(r"[a-zàâäæçéèêëîïôœùûüÿ-]+", text.lower().replace("’", "'")))
    words = json.loads((ROOT / "data/vocab.json").read_text())["words"]
    verbs = {w["lemma"] for w in words if w["pos"] == "VERB"}
    known = {w["lemma"] for w in words}
    pronominal = {f"se {v}": v for v in verbs} | {f"s'{v}": v for v in verbs if v[:1] in "aeéèêiîoôuh"}

    heads, targets, tables = set(), {}, {}
    with gzip.open(DUMP, "rt", encoding="utf-8") as f:
        for line in f:
            d = json.loads(line)
            w, senses = d.get("word"), d.get("senses") or []
            if not form_of_senses(senses):
                heads.add(w)
            if w in bank_words:
                for s in senses:
                    if SKIP_FORM_OF & set(s.get("tags") or []):
                        continue
                    for fo in s.get("form_of") or []:
                        if fo.get("word") and fo["word"] not in targets.setdefault(w, []):
                            targets[w].append(fo["word"])
            if d.get("pos") == "verb" and d.get("forms") and (w in verbs or w in pronominal):
                lemma = pronominal.get(w, w)
                conj = conjugation(d["forms"])
                if conj and (lemma not in tables or w == lemma and tables[lemma].get("refl")):
                    if w != lemma:
                        conj["refl"] = True        # only "se souvenir" has a table: forms carry the pronoun
                    tables[lemma] = conj

    lemma_map = {}
    for form, cands in sorted(targets.items()):
        cands = [c for c in cands if c in heads and c != form]
        if form in heads or not cands:
            continue
        guess = simplemma.lemmatize(form, lang="fr")
        in_vocab = [c for c in cands if c in known]
        lemma_map[form] = guess if guess in cands else (in_vocab or cands)[0]
    LEMMA_MAP.write_text(json.dumps(lemma_map, ensure_ascii=False, indent=0, sort_keys=True) + "\n")
    CONJ.write_text("{\n" + ",\n".join(f"{json.dumps(k, ensure_ascii=False)}:{json.dumps(v, ensure_ascii=False, separators=(',', ':'))}"
                                        for k, v in sorted(tables.items())) + "\n}\n")
    print(f"{len(lemma_map)} forms -> {LEMMA_MAP.relative_to(ROOT)}")
    print(f"{len(tables)} / {len(verbs)} verbs conjugated -> {CONJ.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
