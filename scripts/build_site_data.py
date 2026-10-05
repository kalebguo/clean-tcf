"""Build the static data the website reads.

Input   data/questions.json, data/question_lemmas.json
Output  public/data/listening.json, public/data/reading.json, public/data/search-lemmas.json
        public/media -> Anki collection.media (symlink, dev only)
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANKI_MEDIA = Path.home() / "Library/Application Support/Anki2/User 1/collection.media"
OUT = ROOT / "public/data"
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
FILES = {"CO": "listening.json", "CE": "reading.json"}


def set_sort_key(test):
    if test.isdigit():
        return (0, int(test), "")
    if test.startswith("GR"):
        return (1, int(re.sub(r"\D", "", test) or 0), "")
    return (2, int(re.sub(r"\D", "", test) or 0), test)


def main():
    data = json.loads((ROOT / "data/questions.json").read_text())
    lemmas = json.loads((ROOT / "data/question_lemmas.json").read_text())
    by_id = {q["id"]: q for q in data["questions"]}

    def canonical(qid):
        while by_id[qid].get("duplicateOf"):
            qid = by_id[qid]["duplicateOf"]
        return qid

    appearances = {}
    for q in sorted(data["questions"], key=lambda q: (set_sort_key(q["set"]), q["num"])):
        a = {"set": q["set"], "num": q["num"]}
        if q["series"] and q["series"] != q["set"] and q["series"] != "GR":
            a["series"] = q["series"]
        appearances.setdefault(canonical(q["id"]), []).append(a)

    OUT.mkdir(parents=True, exist_ok=True)
    referenced = set()
    for section, fname in FILES.items():
        qs = [q for q in data["questions"] if q["section"] == section and not q.get("duplicateOf")]
        qs.sort(key=lambda q: (LEVELS.index(q["level"]), not q["set"].isdigit(), set_sort_key(q["set"]), q["num"]))
        counters = {}
        out_q = []
        for q in qs:
            counters[q["level"]] = counters.get(q["level"], 0) + 1
            item = {
                "id": q["id"],
                "section": section,
                "level": q["level"],
                "points": q["points"],
                "source": "main" if q["set"].isdigit() else "extra",
                "bankNo": counters[q["level"]],
                "appearances": appearances[q["id"]],
                "options": q["options"],
                "answer": q["answer"],
            }
            for key in ("analysis", "audio", "image", "transcript", "question", "passage"):
                if q.get(key):
                    item[key] = q[key]
            if q.get("disputed"):
                item["disputed"] = True
            for key in ("audio", "image"):
                if q.get(key):
                    referenced.add(q[key])
            out_q.append(item)

        sets = []
        for s in data["sets"]:
            if s["section"] != section:
                continue
            members = sorted((q for q in data["questions"] if q["section"] == section and q["set"] == s["id"]),
                             key=lambda q: q["num"])
            sets.append({"section": section, "id": s["id"], "label": s["label"], "series": s["series"],
                         "complete": s["complete"],
                         "questionIds": [canonical(q["id"]) for q in members]})
        (OUT / fname).write_text(json.dumps({"sets": sets, "questions": out_q}, ensure_ascii=False,
                                            separators=(",", ":")))
        per_level = {l: counters.get(l, 0) for l in LEVELS}
        print(f"{fname}: {len(out_q)} questions, {len(sets)} sets, per level {per_level}")

    canon_ids = {q["id"] for q in data["questions"] if not q.get("duplicateOf")}
    (OUT / "search-lemmas.json").write_text(json.dumps({k: v for k, v in lemmas.items() if k in canon_ids},
                                                       ensure_ascii=False, separators=(",", ":")))

    media = ROOT / "public/media"
    if not media.exists():
        media.symlink_to(ANKI_MEDIA, target_is_directory=True)
        print(f"linked public/media -> {ANKI_MEDIA}")
    missing = sorted(f for f in referenced if not (media / f).exists())
    if missing:
        print(f"missing media files ({len(missing)}): {missing[:10]}")
        sys.exit(1)
    print(f"media ok: {len(referenced)} files referenced")


if __name__ == "__main__":
    main()
