"""Short Chinese meaning line for every dictionary word (SPEC §E.2), like bontcf's 「是，在，存在」.

Usage:
  llama-server -m ../models/HY-MT1.5-7B-Q4_K_M.gguf --port 8089 -c 8192 -np 4 --jinja
  .venv/bin/python scripts/p2/dict_brief.py translate [WORD ...]   # model requests (cached), then build
  .venv/bin/python scripts/p2/dict_brief.py build                  # choose the lines again, no model
  .venv/bin/python scripts/p2/dict_brief.py show WORD ...          # print the sources and the line
  .venv/bin/python scripts/p2/dict_brief.py phrases                # the same for the bank phrases (SPEC §E.8)
  .venv/bin/python scripts/p2/dict_brief.py doubt                  # list the doubtful ones for Opus
  .venv/bin/python scripts/p2/dict_brief.py opus FILE ...          # keep Opus's answers ({key: [...]})

translate: for every word of data/p2/dict/entries.json the local HY-MT model gives two
translations, both with the word and its part of speech as context:
  d  the first three English senses (faithful to the senses, but an ambiguous English word
     can go wrong: "tense" -> 紧张)
  w  the French word itself, with the English senses as context (natural, but it can
     confuse look-alikes: loyer -> 租户, car -> 汽车)
Words without English senses get only w, with the French definition or a sentence of the
bank as context. Raw outputs are cached in data/p2/dict/brief-mt.json, keyed by a hash of
the input, so the run can be stopped and started again.

build: each source is cut into short items, items that mean the same thing (equal, or one
contains the other) are grouped, and the line keeps the groups that two of the three
sources (d, w and the Chinese Wiktionary) agree on, in the order of the English senses.
When fewer than two agree, the first English senses fill the line. Output:
data/p2/dict/brief.json {lemma: {"brief": [...], "mt": true?}}; "mt" means the Chinese
Wiktionary confirms none of the items. build_p2.py merges it into the site dictionary.

phrases: the same for the bank phrases of the words ("compte rendu", "se rendre compte"),
with their own Wiktionary entries: d translates the English meanings, or the French
definition when there is no English one. The Wiktionary meanings are read from
build/dict-raw once and kept in the cache, data/p2/dict/phrases-mt.json. Output:
data/p2/dict/phrases.json {phrase: {"zh": "报告，汇报", "mt": true?}}.

doubt / opus: where no two sources agree on any meaning, the local model is not enough to
choose. doubt writes those words and phrases, with all their sources and a bank sentence, to
build/brief-doubt.json; Opus (in a Claude Code session) answers {key: [meanings]}, and opus
checks the answers and keeps them in data/p2/dict/brief-opus.json and phrases-opus.json,
which build then uses instead of the sources. They are still marked "mt".
"""
import hashlib
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_mt import PARAMS, SERVER  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
ENTRIES = ROOT / "data/p2/dict/entries.json"
VOCAB = ROOT / "data/vocab.json"
CACHE = ROOT / "data/p2/dict/brief-mt.json"
OUT = ROOT / "data/p2/dict/brief.json"
PHRASE_CACHE = ROOT / "data/p2/dict/phrases-mt.json"
PHRASE_OUT = ROOT / "data/p2/dict/phrases.json"
# Opus's meanings for the doubtful ones ({key: [...]}, see doubt), used instead of the sources
OPUS = ROOT / "data/p2/dict/brief-opus.json"
PHRASE_OPUS = ROOT / "data/p2/dict/phrases-opus.json"
DOUBT = ROOT / "build/brief-doubt.json"

POS_ZH = {"NOUN": "名词", "VERB": "动词", "AUX": "动词", "ADJ": "形容词", "ADV": "副词", "ADP": "介词",
          "PRON": "代词", "CCONJ": "连词", "SCONJ": "连词", "DET": "限定词", "NUM": "数词", "INTJ": "感叹词",
          "PROPN": "专有名词"}
# items: meanings in a line; chars: whole line, without separators; item: a longer item is an
# explanation, not a meaning; sense: a model output longer than this is a definition, and only
# its first part is a meaning
# lead: the source whose order the line follows (see choose)
WORD = {"items": 3, "chars": 12, "item": 6, "sense": 14, "lead": "d"}
PHRASE = {"items": 2, "chars": 14, "item": 8, "sense": 16, "lead": "w"}

CJK = re.compile(r"[一-鿿]")
LATIN = re.compile(r"[A-Za-z]")
TEMPLATE = re.compile(r":?Template:\S+\s*")
BRACKETS = re.compile(r"[（(][^）)]*[）)]|［[^］]*］|\[[^\]]*\]|〈[^〉]*〉|<[^>]*>")
LATIN_WORDS = re.compile(r"[A-Za-z][A-Za-z'’ .-]*")
LATIN_HEAD = re.compile(r"^[A-Za-z][A-Za-z.\s]*(?=[一-鿿])")  # "m.工地", "adj. 自己的"
SENSES = re.compile(r"[；;。！!？?\n]")
SPLIT = re.compile(r"[，,、/：:*]")
# the model talking about the text, or a Wiktionary note translated ("see usage notes")
META = re.compile(r"英语|英文|法语|释义|意思|单词|翻译|指的是|也就是说|详见|参见|使用说明|用法说明")
# "a problem" -> 一个问题, "表示比较级"
LEAD = re.compile(r"^(?:一个|一种|一份|一位|一项|一件|一名|一次|表示|用于|用来|即|尤其指|特指)(?=..)")


def context_prompt(context, text):
    """HY-MT's contextual translation template (model card). A meaning line is a few words:
    max_tokens stops the rare output that runs on (an explanation, a repeated phrase)."""
    if context:
        prompt = f"{context}\n参考上面的信息，把下面的文本翻译成中文，注意不需要翻译上文，也不要额外解释：\n{text}"
    else:
        prompt = f"将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\n{text}"
    body = json.dumps({"messages": [{"role": "user", "content": prompt}], **PARAMS, "max_tokens": 80}).encode()
    req = urllib.request.Request(SERVER, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


def requests_for(e, example):
    """The model inputs of a word: {key: (context, text)}."""
    lemma, pos = e["lemma"], POS_ZH.get(e["pos"], "词")
    en = e.get("en") or []
    if en:
        senses = "; ".join(en[:3])
        return {"d": (f"下面是法语单词 {lemma}（{pos}）的英文释义。", senses), "w": (f"{lemma}（{pos}）：{senses}", lemma)}
    if e["zh"]:
        return {}
    if e.get("fr"):
        return {"w": (f"{lemma}（{pos}）：{e['fr'][0]}", lemma)}
    if example:
        return {"w": (example, lemma)}
    return {}


def phrase_requests(phrase, src):
    """The model inputs of a phrase. The French Wiktionary lists many idioms whose words the
    bank only uses literally ("plus souvent !" = certainly not, but the bank has "le plus
    souvent"), so w translates the phrase alone when there is no English meaning."""
    if src["en"]:
        senses = "; ".join(src["en"][:3])
        return {"d": (f"下面是法语短语 {phrase} 的英文释义。", senses), "w": (f"{phrase}：{senses}", phrase)}
    if src["fr"]:
        return {"d": (f"下面是法语短语 {phrase} 的法语释义。", "；".join(src["fr"][:2])), "w": ("", phrase)}
    return {"w": ("", phrase)}


def key_of(reqs):
    return hashlib.sha1(json.dumps(reqs, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:10]


def load(path, default):
    return json.loads(path.read_text()) if path.exists() else default


def save(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=0, sort_keys=True))
    os.replace(tmp, path)


def entries():
    words = {w["lemma"]: w for w in json.loads(VOCAB.read_text())["words"]}
    out = []
    for e in json.loads(ENTRIES.read_text()):
        w = words.get(e["lemma"], {})
        if w.get("verified") is False:
            continue  # OCR errors and names; the site hides them from the list
        example = (w.get("examples") or [{}])[0].get("text")
        out.append((e, w.get("rank", 1e9), example))
    out.sort(key=lambda x: x[1])  # most frequent first, so a stopped run has done the useful part
    return out


def translate(only):
    cache = load(CACHE, {})
    todo = []
    for e, _, example in entries():
        if only and e["lemma"] not in only:
            continue
        reqs = requests_for(e, example)
        if reqs and cache.get(e["lemma"], {}).get("h") != key_of(reqs):
            todo.append((e["lemma"], reqs))
    run_model(todo, cache, CACHE)


def run_model(todo, cache, path):
    """Send each item's requests (4 at a time) and keep the outputs in cache, saved to path."""
    print(f"{len(todo)} to translate", flush=True)

    def run(item):
        lemma, reqs = item
        out = {"h": key_of(reqs)}
        if "src" in cache.get(lemma, {}):
            out["src"] = cache[lemma]["src"]  # a phrase's Wiktionary meanings
        try:
            for k, (context, text) in reqs.items():
                out[k] = context_prompt(context, text).split("\n")[0][:200]
        except OSError as err:  # left out of the cache: the next run tries again
            print(f"{lemma}: {err}", flush=True)
            return lemma, None
        return lemma, out

    t0 = time.time()
    with ThreadPoolExecutor(4) as pool:  # matches llama-server -np 4
        futures = [pool.submit(run, item) for item in todo]
        for i, done in enumerate(as_completed(futures), 1):
            lemma, out = done.result()
            if out:
                cache[lemma] = out
            if i % 200 == 0 or i == len(todo):
                save(path, cache)
                rate = (time.time() - t0) / i
                print(f"{i}/{len(todo)} {lemma} · {rate:.2f}s each · {(len(todo) - i) * rate / 60:.0f} min left", flush=True)


def items(text, model_output=False, lim=WORD):
    """Short meanings in a gloss or a model output, in order."""
    text = TEMPLATE.sub("", text)
    colon = text.find("：")
    if model_output and 0 <= colon < 25:
        text = text[colon + 1:]  # "compte（名词）：账户；计数"
    text = BRACKETS.sub("", text)
    parts = []
    for sense in SENSES.split(text):
        cut = SPLIT.split(sense)
        # "水，一种纯净状态下呈透明、无色、无味的液体" -> 水
        parts += cut[:1] if model_output and len(sense) > lim["sense"] else cut
    out = []
    for a in parts:
        if not model_output:
            a = LATIN_WORDS.sub("", a)  # "谢谢 thank you"
        a = LEAD.sub("", LATIN_HEAD.sub("", a.strip()).strip(" .“”\"'…"))
        if not a or LATIN.search(a) or not CJK.search(a) or len(a.replace("……", "…")) > lim["item"]:
            continue
        if META.search(a) and len(a) > 3:  # 在英语中 (but 英语 is the meaning of anglais)
            continue
        if a not in out:
            out.append(a)
    return out


def same(a, b):
    """Two items mean the same thing: equal, or one contains the other (租金 / 租金额). A single
    character only matches itself: 天 is not 白天, and 日 would chain 日光 to 日子."""
    if len(a) == 1 or len(b) == 1:
        return a == b
    return a in b or b in a


AGENT = re.compile(r".[者人的]$")  # 经过者, 过路人, 前者的: the model read a verb as a noun or an English adjective


def groups_of(e, mt, lim):
    """Items of the three sources (d, w and the Chinese Wiktionary z), grouped by meaning."""
    sources = {"d": items(mt.get("d", ""), True, lim), "w": items(mt.get("w", ""), True, lim),
               "z": [x for z in e["zh"] for x in items(z, False, lim)]}
    if e["pos"] == "VERB":
        for k in ("d", "w"):
            sources[k] = [a for a in sources[k] if not AGENT.search(a)]
    groups = []  # {"at": {source: first position}, "all": [(source, item)], "word": shown item}
    for src in ("d", "w", "z"):
        for i, a in enumerate(sources[src]):
            g = next((g for g in groups if any(same(a, b) for _, b in g["all"])), None)
            if g is None and src == "z" and len(a) == 1:
                # a one-character Wiktionary item (过) confirms the first meaning that contains it
                # (经过), without joining it, so it cannot chain other meanings in
                g = next((g for g in groups if any(a in b for _, b in g["all"])), None)
                if g:
                    g["at"].setdefault("z", i)
                continue
            if g is None:
                groups.append({"at": {src: i}, "all": [(src, a)]})
            else:
                g["at"].setdefault(src, i)
                g["all"].append((src, a))
    for g in groups:
        # the model's wording when it has one (the Wiktionary items are cut at commas, so a
        # short one can be a fragment: 地方 for chez); the shortest, for 比较级 over 表示比较级
        model = [a for src, a in g["all"] if src != "z"]
        g["word"] = min(model, key=len) if model else g["all"][0][1]
    return sources, groups


def doubtful(e, mt, lim=WORD):
    """The model translated it, but no two sources agree on any meaning: Opus decides."""
    sources, groups = groups_of(e, mt, lim)
    return bool(sources["d"] or sources["w"]) and not any(len(g["at"]) >= 2 for g in groups)


def choose(e, mt, lim=WORD, opus=None):
    """The meaning line of a word: (items, confirmed by the Chinese Wiktionary). opus: the
    meanings Opus chose for a doubtful word (see doubt), used instead of the sources."""
    if opus is not None:  # [] when Opus found it is not a real word: no line
        return opus[: lim["items"]], False
    sources, groups = groups_of(e, mt, lim)
    if not sources["d"] and not sources["w"]:
        return sources["z"][: lim["items"]], True  # no model output: the Wiktionary items as they are
    # words follow the English sense order (d), and the word's own translation and the
    # Wiktionary only break ties; phrases follow the phrase's own translation (w), because
    # a translated definition is an explanation, not a meaning
    lead, other = lim["lead"], "w" if lim["lead"] == "d" else "d"
    order = lambda g: min(g["at"].get(lead, 99), g["at"].get(other, 99) + 0.5, g["at"].get("z", 99) + 0.7)  # noqa: E731
    agreed = sorted((g for g in groups if len(g["at"]) >= 2), key=order)
    # an unconfirmed item of the lead source is still the safer one: for a word, an English
    # sense rather than the model's own reading of the word (used only when no English sense
    # gave a usable item: merci, tel)
    alone = lead if sources[lead] else other
    single = sorted((g for g in groups if list(g["at"]) == [alone]), key=order)
    line = []
    for g in agreed + single:
        if len(line) == lim["items"] or (g in single and len(line) >= 2):
            break
        if line and sum(len(x["word"]) for x in line) + len(g["word"]) > lim["chars"]:
            break
        if any(g["word"] in x["word"] or x["word"] in g["word"] for x in line):
            continue  # 跑 then 奔跑, 手 then 手球: says nothing new
        line.append(g)
    return [g["word"] for g in line], any("z" in g["at"] for g in line)


def build():
    cache, opus = load(CACHE, {}), load(OPUS, {})
    out, stats = {}, {"words": 0, "line": 0, "confirmed": 0, "mt": 0}
    for e, _, _ in entries():
        stats["words"] += 1
        line, confirmed = choose(e, cache.get(e["lemma"], {}), opus=opus.get(e["lemma"]))
        if not line:
            continue
        out[e["lemma"]] = {"brief": line} if confirmed else {"brief": line, "mt": True}
        stats["line"] += 1
        stats["confirmed" if confirmed else "mt"] += 1
    save(OUT, out)
    print(f"{stats['line']}/{stats['words']} words have a meaning line "
          f"({stats['confirmed']} confirmed by the Chinese Wiktionary, {stats['mt']} machine translation only) "
          f"-> {OUT.relative_to(ROOT)}")


def phrase_list():
    """Every bank phrase of the dictionary, most frequent head word first."""
    out = []
    for e, _, _ in entries():
        out += [p["fr"] for p in e.get("phrases") or [] if p["fr"] not in out]
    return out


def phrase_sources(phrases):
    """English, French and Chinese Wiktionary meanings of each phrase, from build/dict-raw."""
    import build_dict as bd
    keys = set(phrases)
    print(f"reading the Wiktionary entries of {len(keys)} phrases…", flush=True)
    zh = bd.entries_by_word(bd.RAW / "zh-fr.jsonl.gz", keys, prefilter=True)
    for w, es in bd.entries_by_word(bd.RAW / "zh-fr-2.jsonl.gz", keys, prefilter=True).items():
        zh[w] += es
    en = bd.entries_by_word(bd.RAW / "en-fr.jsonl.gz", keys, prefilter=False)
    fr = bd.entries_by_word(bd.RAW / "fr-fr.jsonl.gz", keys, prefilter=True)
    out = {p: {"en": bd.en_glosses(en.get(p, [])), "fr": bd.fr_definitions(fr.get(p, [])),
               "zh": bd.zh_glosses(zh.get(p, []), fr.get(p, []))} for p in phrases}
    simple = bd.to_simplified(z for s in out.values() for z in s["zh"])
    for s in out.values():
        s["zh"] = list(dict.fromkeys(simple.get(z, z) for z in s["zh"]))
    return out


def translate_phrases():
    cache = load(PHRASE_CACHE, {})
    phrases = phrase_list()
    missing = [p for p in phrases if "src" not in cache.get(p, {})]
    if missing:
        for p, src in phrase_sources(missing).items():
            cache[p] = {"src": src}
        save(PHRASE_CACHE, cache)
    todo = [(p, reqs) for p in phrases if cache[p].get("h") != key_of(reqs := phrase_requests(p, cache[p]["src"]))]
    run_model(todo, cache, PHRASE_CACHE)


def phrase_entry(phrase, mt):
    return {"lemma": phrase, "pos": "PHRASE", "zh": mt["src"]["zh"]}


def phrase_line(phrase, mt, opus=None):
    return choose(phrase_entry(phrase, mt), mt, PHRASE, opus)


def build_phrases():
    cache, opus = load(PHRASE_CACHE, {}), load(PHRASE_OPUS, {})
    out = {}
    for p, mt in cache.items():
        line, confirmed = phrase_line(p, mt, opus.get(p))
        if line:
            out[p] = {"zh": "，".join(line)} if confirmed else {"zh": "，".join(line), "mt": True}
    save(PHRASE_OUT, out)
    mt = sum("mt" in x for x in out.values())
    print(f"{len(out)}/{len(cache)} phrases have Chinese ({len(out) - mt} confirmed by the Chinese Wiktionary, "
          f"{mt} machine translation only) -> {PHRASE_OUT.relative_to(ROOT)}")


def bank_sentences():
    """Every sentence of the bank (passages, transcripts, questions, options), for examples."""
    from validate_gen import fields_of, load_bank
    out = []
    for q in load_bank().values():
        for _, texts in fields_of(q):
            for t in texts:
                out += [x.strip() for x in re.split(r"(?<=[.!?…])\s+", t) if x.strip()]
    return out


def doubt():
    """build/brief-doubt.json: the doubtful words and phrases (no two sources agree), with
    everything known about them, for Opus to choose the meanings (data/p2/dict/*-opus.json)."""
    out = []
    cache, opus = load(CACHE, {}), load(OPUS, {})
    for e, _, example in entries():
        mt = cache.get(e["lemma"], {})
        if e["lemma"] not in opus and doubtful(e, mt):
            out.append({"kind": "word", "key": e["lemma"], "pos": e["pos"], "en": (e.get("en") or [])[:3],
                        "fr": (e.get("fr") or [])[:1], "zh": e["zh"][:3], "mt": [mt.get("d"), mt.get("w")], "example": example})
    sentences = bank_sentences()
    cache, opus = load(PHRASE_CACHE, {}), load(PHRASE_OPUS, {})
    for p, mt in cache.items():
        if p not in opus and doubtful(phrase_entry(p, mt), mt, PHRASE):
            needle = re.compile(rf"(?<!\w){re.escape(p)}(?!\w)", re.I)
            example = next((x for x in sentences if needle.search(x)), None)
            out.append({"kind": "phrase", "key": p, "en": mt["src"]["en"][:3], "fr": mt["src"]["fr"][:1],
                        "zh": mt["src"]["zh"][:3], "mt": [mt.get("d"), mt.get("w")], "example": example})
    DOUBT.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    words = sum(x["kind"] == "word" for x in out)
    print(f"{words} words and {len(out) - words} phrases to decide -> {DOUBT.relative_to(ROOT)}")


def keep_opus(files):
    """Check Opus's answers and add them to the -opus.json files: simplified Chinese items,
    no brackets or Latin letters, short enough; [] (not a real word) is kept as an answer."""
    doubtful = {x["key"]: x["kind"] for x in json.loads(DOUBT.read_text())}
    words, phrases = load(OPUS, {}), load(PHRASE_OPUS, {})
    bad = []
    for f in files:
        for key, line in json.loads(Path(f).read_text()).items():
            kind = doubtful.get(key)
            lim = PHRASE if kind == "phrase" else WORD
            ok = kind and isinstance(line, list) and len(line) <= lim["items"] + 1 and all(
                isinstance(a, str) and CJK.search(a) and not LATIN.search(a) and not BRACKETS.search(a)
                and len(a.replace("……", "…")) <= lim["item"] + 2 for a in line)
            if not ok:
                bad.append((key, line))
                continue
            (phrases if kind == "phrase" else words)[key] = line
    save(OPUS, words)
    save(PHRASE_OPUS, phrases)
    print(f"kept {len(words)} words and {len(phrases)} phrases; {len(bad)} answers rejected")
    for key, line in bad[:30]:
        print(f"   {key}: {line}")


def show(words):
    cache = load(CACHE, {})
    phrases = load(PHRASE_CACHE, {})
    by = {e["lemma"]: e for e, _, _ in entries()}
    for w in words:
        if w in phrases:
            mt = phrases[w]
            line, confirmed = phrase_line(w, mt)
            print(f"{w} -> {'，'.join(line)}{'' if confirmed else '  [机器翻译]'}\n   d: {mt.get('d')}\n   w: {mt.get('w')}\n   src: {mt['src']}")
            continue
        e, mt = by.get(w), cache.get(w, {})
        if not e:
            print(f"{w}: not in the dictionary")
            continue
        line, confirmed = choose(e, mt)
        print(f"{w} -> {'，'.join(line)}{'' if confirmed else '  [机器翻译]'}\n   d: {mt.get('d')}\n   w: {mt.get('w')}\n   zh: {e['zh']}")


def main(argv):
    if not argv or argv[0] not in ("translate", "build", "show", "phrases", "doubt", "opus"):
        sys.exit(__doc__)
    if argv[0] == "translate":
        translate(set(argv[1:]))
        build()
    elif argv[0] == "doubt":
        doubt()
    elif argv[0] == "opus":
        keep_opus(argv[1:])
        build()
        build_phrases()
    elif argv[0] == "phrases":
        translate_phrases()
        build_phrases()
    elif argv[0] == "build":
        build()
        if PHRASE_CACHE.exists():
            build_phrases()
    else:
        show(argv[1:])


if __name__ == "__main__":
    main(sys.argv[1:])
