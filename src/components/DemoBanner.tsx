/** The demo build (`--mode demo`: `npm run demo`, scripts/deploy/demo.mjs) says its questions are invented. */
export const DEMO = import.meta.env.MODE === "demo";

const HOSTED = "https://github.com/kalebguo/clean-tcf#托管版本免费";

export function DemoBanner() {
  if (!DEMO) return null;
  return (
    <div className="relative z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b bg-primary/10 px-4 py-2 text-center text-sm text-primary">
      <span>示例版：题目全部是本项目自编的，不是真题。作答记录只存在这个浏览器里。</span>
      <a className="font-medium underline underline-offset-2" href={HOSTED} target="_blank" rel="noreferrer">
        完整题库：托管版本（免费）
      </a>
    </div>
  );
}
