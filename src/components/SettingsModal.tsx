import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { RATES, useSettings, type Settings } from "../db/settings";
import { Pick } from "./controls";
import { Modal } from "./Modal";

const SHORTCUTS: [string, string][] = [
  ["Space", "播放 / 暂停"],
  ["S", "从头重播"],
  ["- / +", "后退 / 前进 3 秒"],
  ["A–D / 1–4", "选择选项"],
  ["Enter / →", "下一题"],
  ["Backspace / ←", "上一题"],
  ["T", "显示答案"],
  ["R", "答案解析"],
  ["F", "收藏"],
  ["N", "题目笔记"],
  ["H", "高亮选中文字"],
  ["Q / W / E", "原文 / 中文 / 英文（有译文的题）"],
  ["右键选项", "选中并跳到下一题"],
  ["/ 或 ⌘K", "搜索"],
];

type Update = (p: Partial<Settings>) => void;

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </label>
  );
}

function Toggle({ label, desc, k, s, set }: { label: string; desc?: string; k: keyof Settings; s: Settings; set: Update }) {
  return (
    <Row label={label} desc={desc}>
      <Switch checked={Boolean(s[k])} onCheckedChange={(v) => set({ [k]: v } as Partial<Settings>)} />
    </Row>
  );
}

function Choice<K extends keyof Settings>({ label, desc, k, s, set, options }: { label: string; desc?: string; k: K; s: Settings; set: Update; options: [Settings[K], string][] }) {
  return (
    <Row label={label} desc={desc}>
      <Pick
        label={label}
        value={String(s[k])}
        onChange={(v) => set({ [k]: options.find(([o]) => String(o) === v)![0] } as Partial<Settings>)}
        options={options.map(([v, text]) => [String(v), text])}
        className="min-w-24"
      />
    </Row>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold tracking-wider text-muted-foreground">{title}</h3>
      <div className="mb-4">{children}</div>
    </section>
  );
}

export function SettingsModal({ onClose }: { onClose(): void }) {
  const [s, set] = useSettings();
  return (
    <Modal title="设置" onClose={onClose} wide>
      <div className="grid gap-x-8 md:grid-cols-[1fr_1.3fr]">
        <div>
          <Group title="键盘">
            <Toggle label="键盘快捷键" k="shortcuts" s={s} set={set} />
            <table className="mt-2 w-full text-[13px]">
              <tbody>
                {SHORTCUTS.map(([k, v]) => (
                  <tr key={k} className="border-b border-dashed last:border-b-0">
                    <td className="py-1.5 pr-3">
                      <Kbd>{k}</Kbd>
                    </td>
                    <td className="py-1.5 text-muted-foreground">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Group>
        </div>
        <div>
          <Group title="播放与节奏">
            <Toggle label="自动播放" desc="切换题目后自动播放本题音频" k="autoplay" s={s} set={set} />
            <Row label="自动播放延迟">
              <span className="flex items-center gap-1.5 text-sm">
                <Input
                  type="number"
                  min={0}
                  max={10}
                  className="h-8 w-16"
                  value={s.autoplayDelay}
                  onChange={(e) => set({ autoplayDelay: Math.max(0, Number(e.target.value)) })}
                />
                秒
              </span>
            </Row>
            <Choice label="默认倍速" k="rate" s={s} set={set} options={RATES.map((r) => [r, `${r}×`])} />
            <Toggle label="答题卡即时判对错" desc="选完立刻显示对错（不显示正确答案）" k="instantJudge" s={s} set={set} />
            <Toggle label="答对自动跳转下一题" desc="需开启即时判对错" k="autoNext" s={s} set={set} />
          </Group>
          <Group title="显示">
            <Toggle label="打乱选项顺序" desc="听力 1–4 题保持原顺序；解析时标出原题字母" k="shuffle" s={s} set={set} />
            <Toggle label="常显原文" desc="听力原文不再默认模糊" k="alwaysShowTranscript" s={s} set={set} />
            <Toggle label="跟读高亮" desc="有时间轴的听力题：播放时标出正在读的词，单击原文里的词从这里播放，[ / ] 跳到上一句 / 下一句" k="followAudio" s={s} set={set} />
            <Toggle label="隐藏高亮笔记" desc="只是不显示，数据仍保留" k="hideHighlights" s={s} set={set} />
            <Choice label="主题" k="theme" s={s} set={set} options={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} />
          </Group>
          <Group title="翻译与解析（只对已有 AI 译文和解析的题生效）">
            <Choice label="原文语言" desc="也可以在原文上方切换，或按 Q / W / E" k="p2Lang" s={s} set={set} options={[["fr", "原文"], ["zh", "中文"], ["en", "英文"]]} />
            <Choice label="悬停对照翻译" desc="鼠标停在原文的句子上，显示这句的译文" k="hoverTranslate" s={s} set={set} options={[["off", "关"], ["zh", "中文"], ["en", "英文"]]} />
            <Choice label="选项译文" k="optionTranslation" s={s} set={set} options={[["after", "显示答案后"], ["always", "一直显示"], ["hidden", "隐藏"]]} />
            <Toggle label="答案出处高亮" desc="显示答案后，在原文里标出依据和陷阱" k="showEvidence" s={s} set={set} />
          </Group>
        </div>
      </div>
    </Modal>
  );
}
