"""Word-frequency statistics over the TCF question bank, written as MapReduce.

  map     : one question -> [(lemma, occurrence)]        (parallel, spaCy per worker)
  shuffle : hash-partition pairs by lemma into R buckets
  reduce  : one lemma + its occurrences -> vocabulary entry (parallel per bucket)

Input  data/questions.json   (scripts/export_anki.py)
Output data/vocab.json, data/vocab_report.md
"""
import json
import math
import re
import zlib
from collections import Counter, defaultdict
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORDLIST = ROOT.parent / "提香法语（超大词汇）.txt"   # 336k French word forms, used to validate lemmas
LEMMA_MAP = ROOT / "data/lemma_map.json"          # inflected form -> Wiktionary headword (scripts/p2/build_forms.py)
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
POS_LABEL = {"VERB": "v.", "NOUN": "n.", "ADJ": "adj.", "ADV": "adv.", "PRON": "pron.", "DET": "det.",
             "ADP": "prép.", "CCONJ": "conj.", "SCONJ": "conj.", "NUM": "num.", "INTJ": "interj."}
FUNCTION_POS = {"DET", "PRON", "ADP", "CCONJ", "SCONJ"}
FUNCTION_WORDS = {"ne", "pas", "y", "en", "plus", "très", "bien", "aussi", "donc", "alors", "si", "oui", "non",
                  "même", "tout", "comme", "où", "quand", "comment", "pourquoi", "là", "ici", "ça", "cela"}
WORD = re.compile(r"^[a-zàâäæçéèêëîïôœùûüÿ]+(?:[-'][a-zàâäæçéèêëîïôœùûüÿ]+)*$")
N_REDUCERS = 8

ELISION_FIX = {"qu": "que", "jusqu": "jusque", "lorsqu": "lorsque", "puisqu": "puisque", "quelqu": "quelque",
               "presqu": "presque", "week": "week-end"}
INVERSION = re.compile(r"^(.+?)-(?:t-)?(je|tu|il|elle|on|nous|vous|ils|elles|ce|moi|toi|le|la|les|lui|leur|en|y)$")

_nlp = None
_forms = None
_lemma_map = {}


def norm(w):
    return w.lower().replace("œ", "oe").replace("æ", "ae").replace("’", "'")


def load_forms():
    # optional: without the word list, simplemma alone decides which lemmas are real words
    if not WORDLIST.exists():
        return set()
    return {norm(l.strip()) for l in WORDLIST.open(encoding="utf-8") if l.strip()}


def is_valid(w, forms):
    import simplemma
    return norm(w) in forms or simplemma.is_known(w, lang="fr")


def _init_worker():
    global _nlp, _forms, _lemma_map
    import spacy
    _nlp = spacy.load("fr_core_news_md", disable=["ner"])
    _forms = load_forms()
    _lemma_map = json.loads(LEMMA_MAP.read_text()) if LEMMA_MAP.exists() else {}


# ---------------------------------------------------------------- map

def segments(q):
    """(kind, text) pieces of a question, in display order. kind: text | question | option"""
    if q["section"] == "CO":
        lines = q["transcript"]
        # the last transcript line is normally the spoken question
        for i, line in enumerate(lines):
            kind = "question" if i == len(lines) - 1 and line.rstrip().endswith("?") else "text"
            yield kind, re.sub(r"^[A-D]\.\s*", "", line)  # picture items read options as "A. ..."
    else:
        if q.get("passage"):
            yield "text", " ".join(q["passage"])
        if q.get("question"):
            yield "question", q["question"]
    for opt in q["options"]:
        if opt:
            yield "option", opt


def fix_token(tok, nxt):
    """spaCy lemma, corrected with the word list + simplemma when it is not a real word."""
    import simplemma
    low = tok.text.lower().lstrip("-")
    pos = "VERB" if tok.pos_ == "AUX" else tok.pos_
    if low == "est" and nxt is not None and nxt.text.lower().startswith("-ce"):
        return "être", "VERB"
    m = INVERSION.match(low)            # "est-elle", "viens-tu" → the verb part
    if m and is_valid(m.group(1), _forms):
        return simplemma.lemmatize(m.group(1), lang="fr"), "VERB"
    lemma = tok.lemma_.lower().lstrip("-")
    if tok.text.startswith("-") or not is_valid(lemma, _forms):
        alt = simplemma.lemmatize(low, lang="fr")
        lemma = alt if is_valid(alt, _forms) else low
    # spaCy often returns the form itself ("cherche", "courriels"): use its dictionary headword
    return _lemma_map.get(lemma, lemma), pos


def map_question(q):
    """-> (pairs, sentences). pairs: [(lemma, (qid, sentence_idx, pos, surface))]."""
    pairs, sentences = [], []
    for kind, seg in segments(q):
        for sent in _nlp(seg).sents:
            text = sent.text.strip()
            if not text:
                continue
            sid = len(sentences)
            sentences.append((text, kind))
            toks = list(sent)
            for i, tok in enumerate(toks):
                if tok.pos_ in ("PROPN", "PUNCT", "SPACE", "X", "SYM") or tok.like_num:
                    continue
                if tok.text.isupper() and len(tok.text) > 1:  # OCR watermark noise / acronyms
                    continue
                if not re.search(r"[a-zA-Zà-ÿœ]", tok.text):        # "%", "€" …
                    continue
                lemma, pos = fix_token(tok, toks[i + 1] if i + 1 < len(toks) else None)
                lemma = lemma.strip("-'’")
                if lemma == "end" and i and toks[i - 1].text.lower() in ("week", "-"):
                    continue                                       # second half of "week-end"
                lemma = ELISION_FIX.get(lemma, lemma)
                if not WORD.match(lemma) or (len(lemma) == 1 and lemma not in ("à", "a", "y")):
                    continue
                pairs.append((lemma, (q["id"], sid, pos, tok.text.lower())))
    return pairs, sentences


def map_chunk(chunk):
    out = []
    for q in chunk:
        pairs, sentences = map_question(q)
        out.append((q["id"], pairs, sentences))
    return out


# ---------------------------------------------------------------- reduce

_qmeta = None
_sentences = None


def _init_reducer(qmeta, sentences):
    global _qmeta, _sentences
    _qmeta, _sentences = qmeta, sentences


def pick_examples(occ, k=3):
    """Up to k example sentences from different questions, easiest level first, readable length."""
    by_q = {}
    for qid, sid, _, _ in occ:
        text, kind = _sentences[qid][sid]
        n = len(text.split())
        score = (kind != "text", not 6 <= n <= 25, LEVELS.index(_qmeta[qid]["level"]), abs(n - 12))
        if qid not in by_q or score < by_q[qid][0]:
            by_q[qid] = (score, sid)
    best = sorted(by_q.items(), key=lambda kv: kv[1][0])[:k]
    return [{"q": qid, "text": _sentences[qid][sid][0]} for qid, (_, sid) in best]


def reduce_lemma(lemma, occ):
    qids = {o[0] for o in occ}
    pos = Counter(o[2] for o in occ).most_common(1)[0][0]
    levels = Counter(_qmeta[q]["level"] for q in qids)
    sections = Counter(_qmeta[q]["section"] for q in qids)
    return {
        "lemma": lemma,
        "pos": pos,
        "posLabel": POS_LABEL.get(pos, ""),
        "function": pos in FUNCTION_POS or lemma in FUNCTION_WORDS,
        "tf": len(occ),                                   # total occurrences
        "df": len(qids),                                  # questions containing it
        "dfCO": sections.get("CO", 0),
        "dfCE": sections.get("CE", 0),
        "level": min(levels, key=LEVELS.index),           # level of first appearance
        "levels": {l: levels[l] for l in LEVELS if levels[l]},
        "forms": [f for f, _ in Counter(o[3] for o in occ).most_common(6)],
        "examples": pick_examples(occ),
    }


def reduce_bucket(bucket):
    return [reduce_lemma(lemma, occ) for lemma, occ in bucket.items()]


# ---------------------------------------------------------------- driver

def main():
    data = json.loads((ROOT / "data/questions.json").read_text())
    questions = [q for q in data["questions"] if not q.get("duplicateOf")]
    qmeta = {q["id"]: {"level": q["level"], "section": q["section"]} for q in questions}

    with Pool(initializer=_init_worker) as pool:
        chunks = [questions[i:i + 40] for i in range(0, len(questions), 40)]
        mapped = [r for part in pool.map(map_chunk, chunks) for r in part]

    # shuffle: partition by lemma hash, group values per lemma
    sentences = {qid: sents for qid, _, sents in mapped}
    buckets = [defaultdict(list) for _ in range(N_REDUCERS)]
    n_tokens = 0
    for _, pairs, _ in mapped:
        for lemma, value in pairs:
            buckets[zlib.crc32(lemma.encode()) % N_REDUCERS][lemma].append(value)
            n_tokens += 1

    with Pool(N_REDUCERS, initializer=_init_reducer, initargs=(qmeta, sentences)) as pool:
        vocab = [e for part in pool.map(reduce_bucket, buckets) for e in part]

    # words the dictionary does not know and that occur in a single question are mostly
    # OCR slips or names; keep them but flag them so the word list can hide them
    forms = load_forms()
    for e in vocab:
        e["verified"] = e["df"] > 1 or is_valid(e["lemma"], forms)

    # global statistics: probability, rank, coverage-based frequency band
    n_q = len(questions)
    n_sec = Counter(q["section"] for q in questions)
    vocab.sort(key=lambda e: (-e["df"], -e["tf"], e["lemma"]))
    content_tokens = sum(e["tf"] for e in vocab if not e["function"])
    cum = 0
    for rank, e in enumerate(vocab, 1):
        e["rank"] = rank
        e["p"] = round(e["df"] / n_q, 4)                  # P(a random question contains the word)
        e["pCO"] = round(e["dfCO"] / max(1, n_sec["CO"]), 4)  # max: a bank with one section only (demo)
        e["pCE"] = round(e["dfCE"] / max(1, n_sec["CE"]), 4)
    for e in sorted((e for e in vocab if not e["function"]), key=lambda e: -e["tf"]):
        cum += e["tf"]
        share = cum / content_tokens
        e["band"] = "high" if share <= 0.80 else "mid" if share <= 0.95 else "low"
    for e in vocab:
        if e["function"]:
            e["band"] = "function"
        if e["df"] == 1:
            e["band"] = "rare" if e["band"] == "low" else e["band"]

    out = {"meta": {"questions": n_q, "questionsCO": n_sec["CO"], "questionsCE": n_sec["CE"],
                    "tokens": n_tokens, "lemmas": len(vocab), "contentTokens": content_tokens},
           "words": vocab}
    (ROOT / "data/vocab.json").write_text(json.dumps(out, ensure_ascii=False))
    # per-question lemma lists, used by the site for "search by base form"
    q_lemmas = {qid: sorted({lemma for lemma, _ in pairs}) for qid, pairs, _ in mapped}
    (ROOT / "data/question_lemmas.json").write_text(json.dumps(q_lemmas, ensure_ascii=False))
    write_report(out)
    print(json.dumps(out["meta"], ensure_ascii=False))


def write_report(out):
    words, meta = out["words"], out["meta"]
    content = [w for w in words if not w["function"] and w["verified"]]
    bands = Counter(w["band"] for w in words)
    lv = Counter(w["level"] for w in content)
    by_tf = sorted(content, key=lambda w: -w["tf"])
    cov, cum, marks = {}, 0, [0.5, 0.8, 0.9, 0.95, 0.98]
    for i, w in enumerate(by_tf, 1):
        cum += w["tf"]
        for m in marks:
            if m not in cov and cum / meta["contentTokens"] >= m:
                cov[m] = i

    def table(ws, n=40, sec=""):
        rows = ["| # | 词 | 词性 | 出现题数 | 出现概率 | 总次数 | 首现等级 |", "|---|---|---|---|---|---|---|"]
        for i, w in enumerate(ws[:n], 1):
            rows.append(f"| {i} | {w['lemma']} | {w['posLabel']} | {w['df' + sec]} | {w['p' + sec]:.1%} "
                        f"| {w['tf']} | {w['level']} |")
        return "\n".join(rows)

    L = [f"# TCF 题库词频报告\n",
         f"- 题目：{meta['questions']}（听力 {meta['questionsCO']}，阅读 {meta['questionsCE']}，已去重）",
         f"- 词次：{meta['tokens']}；不同词元：{meta['lemmas']}（实义词 {len(content)}）\n",
         "## 覆盖率（实义词，按总次数排序）\n",
         *[f"- 掌握前 **{cov[m]}** 个实义词 → 覆盖 {int(m * 100)}% 的实义词出现" for m in marks if m in cov],
         "\n## 频段\n",
         f"- 高频（覆盖前 80%）：{bands['high']} 词",
         f"- 中频（80–95%）：{bands['mid']} 词",
         f"- 低频（95% 之后，出现 ≥2 题）：{bands['low']} 词",
         f"- 罕见（只在 1 道题出现）：{bands['rare']} 词",
         f"- 功能词（冠词/代词/介词/连词等）：{bands['function']} 词",
         f"- 待核实（词典查不到且只出现 1 次，多为 OCR 错字/人名）：{sum(1 for w in words if not w['verified'])} 词\n",
         "## 实义词按首现等级\n",
         *[f"- {l}：{lv[l]} 词" for l in LEVELS],
         "\n## 出现概率最高的实义词（全部）\n", table(content),
         "\n## 听力最常见实义词（题数/概率为听力题内）\n", table(sorted(content, key=lambda w: -w["dfCO"]), 25, "CO"),
         "\n## 阅读最常见实义词（题数/概率为阅读题内）\n", table(sorted(content, key=lambda w: -w["dfCE"]), 25, "CE")]
    for l in LEVELS:
        L += [f"\n## {l} 首现词 Top 15\n", table([w for w in content if w["level"] == l], 15)]
    (ROOT / "data/vocab_report.md").write_text("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
