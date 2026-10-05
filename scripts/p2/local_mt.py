"""Translate question text with a local model served by llama.cpp (HY-MT1.5).

Usage:
  llama-server -m ../models/HY-MT1.5-1.8B-Q4_K_M.gguf --port 8089 -c 16384 -np 4 --jinja
  .venv/bin/python scripts/p2/local_mt.py --tag 1.8b compare        # 50 questions that already have Sonnet translations
  .venv/bin/python scripts/p2/local_mt.py --tag 7b ID [ID ...]
  .venv/bin/python scripts/p2/local_mt.py --tag 7b all              # every question without a Sonnet file

--tag names the model that llama-server is running (1.8b or 7b).

compare / IDs: sentences are taken from data/p2/gen/<id>.json, so the local translation
lines up one-to-one with the Sonnet one. Output: data/p2/localmt/<tag>/<id>.json
{id, model, seconds, retried, segments[{field,fr,zh,en}], options[{zh,en}|null]}

all: sentences come from segment.py (rules, no model). Output: data/p2/mt/<id>.json
{id, model, segments, options}, checked with validate_gen.py --mt. Questions that already
have a valid file are skipped, so the run can be stopped and started again.

Each field (and the four options) is translated in one request with every sentence
wrapped in <sN></sN>, using the model's "formatted translation" prompt, so the model sees
the whole passage as context. A sentence whose tag goes missing is retried on its own
with the plain prompt.
"""
import hashlib
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from functools import cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from segment import split_field  # noqa: E402
from validate_gen import fields_of, load_bank, validate  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
GEN = ROOT / "data/p2/gen"
OUT = ROOT / "data/p2/localmt"  # + /<tag>, set in main
MT = ROOT / "data/p2/mt"
SERVER = "http://localhost:8089/v1/chat/completions"
MODELS = {"1.8b": "HY-MT1.5-1.8B-Q4_K_M", "7b": "HY-MT1.5-7B-Q4_K_M"}
MODEL = None  # set in main
LANG = {"zh": "中文", "en": "英文"}
# recommended sampling settings from the model card; fixed seed for repeatability
PARAMS = {"temperature": 0.7, "top_k": 20, "top_p": 0.6, "repeat_penalty": 1.05, "seed": 1, "max_tokens": 4000}


def chat(prompt):
    body = json.dumps({"messages": [{"role": "user", "content": prompt}], **PARAMS}).encode()
    req = urllib.request.Request(SERVER, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


def plain(text, lang):
    if lang == "zh":
        return chat(f"将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n{text}")
    return chat(f"Translate the following segment into English, without additional explanation.\n{text}")


def tagged(texts, lang):
    """Translate a list of sentences in one request; returns (translations, retried count)."""
    src = "".join(f"<s{i + 1}>{t}</s{i + 1}>" for i, t in enumerate(texts))
    out = chat(
        f"将以下<source></source>之间的文本翻译为{LANG[lang]}，注意只需要输出翻译后的结果，不要额外解释，"
        "原文中的<sn></sn>标签表示标签内文本包含格式信息，需要在译文中相应的位置尽量保留该标签。"
        f"输出格式为：<target>str</target>\n<source>{src}</source>"
    )
    result = []
    for i in range(len(texts)):
        m = re.search(rf"<s{i + 1}>(.*?)</s{i + 1}>", out, re.S)
        result.append(m.group(1).strip() if m else "")
    # a tag can drift onto another sentence's content; catch it by length and by duplicates
    seen = {}
    for i, got in enumerate(result):
        seen.setdefault(got, []).append(i)
    retried = 0
    for i, (t, got) in enumerate(zip(texts, result)):
        if not got or "<s" in got or suspicious_length(t, got, lang) or (len(seen[got]) > 1 and len(set(texts[j] for j in seen[got])) > 1):
            result[i] = plain(t, lang)
            retried += 1
    return result, retried


def suspicious_length(src, tr, lang):
    """Translation far longer or shorter than the source can be (French chars → Chinese / English chars)."""
    n, m = len(src.strip()), len(tr.strip())
    if lang == "zh":
        return m > 1.5 * n + 10 or m < 0.1 * n
    return m > 2 * n + 20 or m < 0.3 * n


@cache
def bank():
    return load_bank()


def source_segments(qid):
    """[{field, fr}] in reading order: Sonnet's sentences when there is a gen file, else segment.py's."""
    if OUT != MT:
        return [dict(field=s["field"], fr=s["fr"]) for s in json.loads((GEN / f"{qid}.json").read_text())["segments"]]
    return [dict(field=f, fr=fr) for f, blocks in fields_of(bank()[qid]) for fr in split_field(blocks)]


CHOICE = re.compile(r"^([A-D])\.\s+")


def translate_question(qid):
    t0 = time.time()
    retried = 0
    segs = source_segments(qid)
    # picture items: "B. Bonne idée." — the model garbles the letter ("B>"), so translate without it
    prefix = [m.group(1) + ". " if (m := CHOICE.match(s["fr"])) else "" for s in segs]
    text = [s["fr"][len(m.group(0)):] if (m := CHOICE.match(s["fr"])) else s["fr"] for s in segs]
    fields = []
    for s in segs:
        if s["field"] not in fields:
            fields.append(s["field"])
    for lang in ("zh", "en"):
        for f in fields:
            idx = [i for i, s in enumerate(segs) if s["field"] == f]
            tr, r = tagged([text[i] for i in idx], lang)
            retried += r
            for i, t in zip(idx, tr):
                segs[i][lang] = prefix[i] + t
    # options: the source option texts are in the bank; gen keeps null for empty ones
    src_opts = bank()[qid]["options"]
    options = [None] * 4
    filled = [i for i, o in enumerate(src_opts) if o]
    if filled:
        per_lang = {}
        for lang in ("zh", "en"):
            per_lang[lang], r = tagged([src_opts[i] for i in filled], lang)
            retried += r
        for k, i in enumerate(filled):
            options[i] = {"zh": per_lang["zh"][k], "en": per_lang["en"][k]}
    secs = round(time.time() - t0, 1)
    if OUT == MT:
        out = {"id": qid, "model": MODEL, "segments": segs, "options": options}
    else:
        out = {"id": qid, "model": MODEL, "seconds": secs, "retried": retried, "segments": segs, "options": options}
    tmp = OUT / f".{qid}.json.tmp"  # write then rename, so a stopped run never leaves half a file
    tmp.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    tmp.replace(OUT / f"{qid}.json")
    return qid, secs, retried


def todo_all():
    """Questions without a valid Sonnet file and without a valid local translation yet, in id order."""
    def valid(path, q, translation_only):
        try:
            return path.exists() and not validate(json.loads(path.read_text()), q, translation_only)[0]
        except (json.JSONDecodeError, KeyError, TypeError):
            return False
    return [qid for qid, q in sorted(bank().items())
            if not valid(GEN / f"{qid}.json", q, False) and not valid(MT / f"{qid}.json", q, True)]


def compare_set():
    """All 25 reviewed questions plus 25 more, spread over section × level (deterministic)."""
    reviewed = sorted(json.loads((ROOT / "data/p2/reviewed.json").read_text()))
    bank = {q["id"]: q for n in ("listening", "reading") for q in json.loads((ROOT / f"public/data/{n}.json").read_text())["questions"]}
    rest = sorted((p.stem for p in GEN.glob("*.json") if p.stem not in reviewed), key=lambda i: hashlib.md5(i.encode()).hexdigest())
    picked, seen = [], {}
    for qid in rest:  # round-robin over section × level so every cell gets some
        key = (bank[qid]["section"], bank[qid]["level"])
        if seen.get(key, 0) < 3 and len(picked) < 25:
            picked.append(qid)
            seen[key] = seen.get(key, 0) + 1
    return reviewed + picked


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    global OUT, MODEL
    if argv[:1] != ["--tag"] or len(argv) < 3 or argv[1] not in MODELS:
        print(__doc__)
        return 2
    OUT, MODEL = OUT / argv[1], MODELS[argv[1]]
    argv = argv[2:]
    if argv == ["all"]:
        OUT = MT
        ids = todo_all()
    else:
        ids = compare_set() if argv == ["compare"] else argv
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"{len(ids)} questions → {OUT.relative_to(ROOT)}", flush=True)
    t0 = time.time()

    def run(qid):
        try:
            return translate_question(qid)
        except Exception as e:  # noqa: BLE001  (server hiccup: skip it, the next run picks it up)
            return qid, None, repr(e)

    failed = 0
    with ThreadPoolExecutor(4) as pool:  # matches llama-server -np 4
        for n, (qid, secs, retried) in enumerate(pool.map(run, ids), 1):
            if secs is None:
                failed += 1
                print(f"{n}/{len(ids)} {qid} FAILED {retried}", flush=True)
                continue
            left = (time.time() - t0) / n * (len(ids) - n)
            print(f"{n}/{len(ids)} {qid} {secs}s" + (f" retried {retried}" if retried else "")
                  + f" · {left / 60:.0f} min left", flush=True)
    print(f"done in {time.time() - t0:.0f}s, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
