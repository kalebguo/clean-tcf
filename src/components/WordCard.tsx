import { Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { formLabel, formsOf, IMP_PERSONS, PERSONS, TENSE_LABEL, TENSE_ORDER, tenseForms, useConj } from "../data/conj";
import { BAND_LABEL, normalizeWord, playWord, type DictEntry } from "../data/dict";

const GENDER: Record<string, string> = { m: "阳性", f: "阴性", "m/f": "阴阳同形" };

const SUB = "mr-2 text-xs text-muted-foreground";
const LINK = "text-[13px] font-medium text-primary hover:underline";

export function MtTag({ title }: { title?: string }) {
  return (
    <span title={title} className="ml-1.5 inline-block rounded border border-dashed px-1 align-[1px] text-[11px] font-normal text-muted-foreground">
      机器翻译
    </span>
  );
}

/** "allons：现在时 nous · 命令式 nous" when the word looked up is a conjugated form of the verb. */
export function ConjHint({ e, word }: { e: DictEntry; word: string }) {
  const conj = useConj(e.pos === "VERB");
  const [all, setAll] = useState(false);
  if (!conj || normalizeWord(word) === e.lemma) return null;
  const hits = formsOf(conj.index, e.lemma, word).filter((h) => h.tense !== "inf");
  if (!hits.length) return null;
  const shown = all ? hits : hits.slice(0, 2);
  return (
    <div className="my-1 text-[13px] text-primary">
      <b>{normalizeWord(word)}</b>：{shown.map(formLabel).join(" · ")}
      {hits.length > shown.length && (
        <button type="button" className="ml-1.5 font-medium hover:underline" onClick={() => setAll(true)}>
          +{hits.length - shown.length}
        </button>
      )}
    </div>
  );
}

/** Conjugation table of a verb: tenses as columns, persons as rows (scrolls sideways on a phone). */
export function ConjTable({ e }: { e: DictEntry }) {
  const conj = useConj();
  if (conj === undefined) return <div className="text-xs text-muted-foreground">加载变位表…</div>;
  const c = conj?.table[e.lemma];
  if (!c) return <div className="text-xs text-muted-foreground">词典里没有这个动词的变位表。</div>;
  const tenses = TENSE_ORDER.filter((k) => k !== "imp" && tenseForms(c, k)?.some(Boolean));
  const imp = c.t.imp?.some(Boolean) ? c.t.imp : undefined;
  return (
    <div className="mt-1.5 grid gap-1.5">
      <div className="text-xs text-muted-foreground">
        助动词 {c.refl ? "être（代词式）" : (c.aux ?? "avoir")}
        {c.pp && ` · 过去分词 ${c.pp}`}
        {c.ppr && ` · 现在分词 ${c.ppr}`}
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full border-collapse text-[13px] whitespace-nowrap">
          <thead>
            <tr className="border-b bg-muted/50">
              <th />
              {tenses.map((k) => (
                <th key={k} className="px-2.5 py-1 text-left text-xs font-medium text-muted-foreground">
                  {TENSE_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-serif">
            {PERSONS.map((p, i) => (
              <tr key={p} className="even:bg-muted/40">
                <th className="px-2.5 py-1 text-left font-normal text-muted-foreground italic">{c.refl ? "" : p}</th>
                {tenses.map((k) => (
                  <td key={k} className="px-2.5 py-1">
                    {tenseForms(c, k)?.[i] ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {imp && (
        <div className="text-[13px]">
          <span className={SUB}>{TENSE_LABEL.imp}</span>
          {imp.map(
            (f, i) =>
              f && (
                <span key={i} className="mr-3 font-serif">
                  {f}
                  <span className="text-muted-foreground">（{IMP_PERSONS[i]}）</span>
                </span>
              ),
          )}
        </div>
      )}
    </div>
  );
}

/** Headword line: lemma, part of speech, gender, IPA, pronunciation button. */
export function WordHead({ e, children, className }: { e: DictEntry; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-2 gap-y-0.5", className)}>
      <b className="font-serif text-lg">{e.lemma}</b>
      <span className="text-xs text-muted-foreground">
        {e.posLabel}
        {e.gender && ` ${GENDER[e.gender]}`}
      </span>
      {e.ipa && <span className="font-serif text-muted-foreground">{e.ipa}</span>}
      {e.audio && (
        <button
          type="button"
          title="发音（维基词典真人录音）"
          className="grid size-6 place-items-center self-center rounded-full text-primary hover:bg-primary/10"
          onClick={(ev) => {
            ev.stopPropagation();
            playWord(e);
          }}
        >
          <Play className="size-3 fill-current" />
        </button>
      )}
      {children}
    </div>
  );
}

/** The short meaning line under the headword (SPEC §E.2). */
export function WordBrief({ e }: { e: DictEntry }) {
  if (!e.brief?.length) return null;
  return (
    <div className="mt-1 mb-0.5 text-[15px] font-medium">
      {e.brief.join("，")}
      {e.briefMt && <MtTag title="维基词典没有对应的中文释义，由本地模型从英文释义翻译" />}
    </div>
  );
}

function Lang({ tag, children, serif }: { tag: string; children: React.ReactNode; serif?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="shrink-0 rounded border px-1 text-[11px] text-muted-foreground">{tag}</span>
      <span className={cn("min-w-0 [overflow-wrap:anywhere]", serif && "font-serif")}>{children}</span>
    </div>
  );
}

/** Meanings in the three languages. compact (bubble dictionary): first items only, and the
 * Chinese Wiktionary list only when there is no brief line above it. */
export function WordMeanings({ e, compact }: { e: DictEntry; compact?: boolean }) {
  const n = compact ? 3 : 99;
  return (
    <div className="my-1.5 grid gap-1 text-sm leading-relaxed">
      {e.zh.length > 0 && !(compact && e.brief?.length) && <Lang tag="中">{e.zh.slice(0, n).join("；")}</Lang>}
      {e.en && e.en.length > 0 && <Lang tag="英">{e.en.slice(0, compact ? 2 : 99).join("; ")}</Lang>}
      {e.fr && e.fr.length > 0 && (
        <Lang tag="法" serif>
          {e.fr.slice(0, compact ? 1 : 99).join(" ‖ ")}
        </Lang>
      )}
      {!e.zh.length && !e.en?.length && !e.fr?.length && <div className="text-xs text-muted-foreground">词典里没有这个词的释义</div>}
    </div>
  );
}

/** Bank phrases with their Chinese (SPEC §E.8). Most of it is machine translation, so the
 * tag goes on the heading when all of it is, and on each phrase otherwise. */
function WordPhrases({ phrases }: { phrases: NonNullable<DictEntry["phrases"]> }) {
  const withZh = phrases.filter((p) => p.zh);
  const allMt = withZh.length > 0 && withZh.every((p) => p.mt);
  return (
    <div className="grid gap-0.5">
      <span className={SUB}>
        题库里的短语
        {allMt && <MtTag title="维基词典没有这些短语的中文，由本地模型翻译" />}
      </span>
      {phrases.map((p) => (
        <div key={p.fr} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
          <span className="font-medium">{p.fr}</span>
          {p.zh && <span className="text-muted-foreground">{p.zh}</span>}
          {p.mt && !allMt && <MtTag />}
        </div>
      ))}
    </div>
  );
}

/** Everything else, for the expanded row of the word list. */
export function WordDetails({ e, className }: { e: DictEntry; className?: string }) {
  const practice = (qid?: string) => `/search/practice?q=${encodeURIComponent(e.lemma)}${qid ? `&start=${qid}` : ""}`;
  const [showConj, setShowConj] = useState(false);
  return (
    <div className={cn("grid gap-2.5", className)}>
      <WordMeanings e={e} />
      <div className="text-xs text-muted-foreground">
        {e.level} 首次出现 · {BAND_LABEL[e.band]} · 共出现 {e.tf} 次，{e.df} 道题
        {e.forms.length > 1 && ` · 形式：${e.forms.join("、")}`}
      </div>
      {e.phrases && e.phrases.length > 0 && <WordPhrases phrases={e.phrases} />}
      {e.synonyms && e.synonyms.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={SUB}>近义词</span>
          {e.synonyms.map((s) => (
            <span key={s} className="rounded-full border bg-muted/50 px-2 text-xs">
              {s}
            </span>
          ))}
        </div>
      )}
      {e.pos === "VERB" && (
        <div>
          <button type="button" className={LINK} onClick={() => setShowConj((v) => !v)}>
            {showConj ? "收起变位表" : "变位表 ›"}
          </button>
          {showConj && <ConjTable e={e} />}
        </div>
      )}
      {e.examples.length > 0 && (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={SUB}>题库例句 · 出现在 {e.df} 道题</span>
            <Link className={LINK} to={practice()}>
              练习这 {e.df} 道题 ›
            </Link>
          </div>
          {e.examples.map((x) => (
            <Link key={x.qid + x.fr} to={practice(x.qid)} className="grid gap-px border-l-2 py-1 pl-2.5 font-serif hover:border-primary">
              <span>{x.fr}</span>
              {x.zh && <span className="font-sans text-xs text-muted-foreground">{x.zh}</span>}
              <span className="font-sans text-xs text-muted-foreground">{x.qid}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
