import { CloudAlert, CloudCheck, CloudOff, Download, LogIn, LogOut, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SECTION_NAME, type Level, type Section } from "../data/types";
import { applyUpdate, CLOUD, LOGOUT_URL, MEDIA_CACHE, relogin, switchAccount, syncNow, useCloudStatus, type CloudStatus } from "./cloud";

/* Cloud sync and offline UI of the web build (SPEC §K). Each part renders nothing without a server. */

function ago(t?: number): string {
  if (!t) return "还没有同步过";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "刚刚同步";
  if (s < 3600) return `${Math.round(s / 60)} 分钟前同步`;
  if (s < 86400) return `${Math.round(s / 3600)} 小时前同步`;
  return `${new Date(t).toLocaleDateString()} 同步`;
}

function describe(s: CloudStatus): string {
  switch (s.state) {
    case "syncing": return "正在同步…";
    case "offline": return `离线。数据先存在本机，联网后自动同步。（${ago(s.lastSyncAt)}）`;
    case "login": return "登录已过期，同步暂停";
    case "account": return `这台设备上是 ${s.owner} 的数据，现在登录的是 ${s.email}`;
    case "error": return `同步失败：${s.error}`;
    default: return ago(s.lastSyncAt);
  }
}

/** Status icon in the top bars; opens the data page. */
export function CloudButton() {
  const s = useCloudStatus();
  const navigate = useNavigate();
  if (s.state === "off") return null;
  const bad = s.state === "login" || s.state === "account" || s.state === "error";
  const Icon = s.state === "syncing" ? RefreshCw : s.state === "offline" ? CloudOff : bad ? CloudAlert : CloudCheck;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="云同步" onClick={() => navigate("/data")} className={cn(bad && "text-wrong hover:text-wrong", s.state === "offline" && "text-muted-foreground")}>
          <Icon className={cn(s.state === "syncing" && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{describe(s)}</TooltipContent>
    </Tooltip>
  );
}

// in the page flow above the top bar, so it never covers the navigation
const BAR = "relative z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b px-4 py-2 text-center text-sm";

/** New version, expired login, another person's data, short notices. */
export function CloudBanners() {
  const s = useCloudStatus();
  if (s.state === "off") return null;
  if (s.update)
    return (
      <div className={cn(BAR, "bg-primary/10 text-primary")}>
        网站有新版本。
        <Button size="sm" onClick={applyUpdate}>更新并刷新</Button>
      </div>
    );
  if (s.state === "login")
    return (
      <div className={cn(BAR, "bg-wrong/10 text-wrong")}>
        登录已过期，同步暂停。数据还在本机。
        <Button size="sm" onClick={relogin}><LogIn /> 重新登录</Button>
      </div>
    );
  if (s.state === "account")
    return (
      <div className={cn(BAR, "bg-wrong/10 text-wrong")}>
        {describe(s)}。同步已暂停，到「数据」页处理。
      </div>
    );
  if (s.notice)
    return <div className="fixed inset-x-0 bottom-20 z-[100] mx-auto w-fit max-w-[90vw] rounded-xl border bg-popover px-4 py-2.5 text-sm shadow-lg md:bottom-6">{s.notice}</div>;
  return null;
}

/** Data page: who is signed in, last sync, sync now, sign out. */
export function CloudPanel() {
  const s = useCloudStatus();
  const [confirm, setConfirm] = useState(false);
  if (!CLOUD) return null;
  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <h2 className="mb-1 font-bold">云同步</h2>
      <p className="text-sm text-muted-foreground">
        {s.email ? <>账号 <b className="text-foreground">{s.email}</b>。</> : null}
        记录保存在本机，并自动同步到云端。其他设备用同一个邮箱登录，记录会合并。
      </p>
      <p className={cn("mt-2 text-sm", (s.state === "error" || s.state === "login" || s.state === "account") && "text-wrong")}>{describe(s)}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {s.state === "login" ? (
          <Button onClick={relogin}><LogIn /> 重新登录</Button>
        ) : s.state === "account" ? (
          confirm ? (
            <Button variant="destructive" onClick={() => void switchAccount()}>
              <Trash2 /> 确认：删除本机记录，下载 {s.email} 的记录
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setConfirm(true)}>换成 {s.email} 的记录</Button>
          )
        ) : (
          <Button variant="outline" disabled={s.state === "syncing" || s.state === "offline"} onClick={() => void syncNow()}>
            <RefreshCw className={cn(s.state === "syncing" && "animate-spin")} /> 立即同步
          </Button>
        )}
        <Button variant="ghost" asChild>
          <a href={LOGOUT_URL}><LogOut /> 退出登录</a>
        </Button>
      </div>
      {s.state === "account" && <p className="mt-2 text-xs text-muted-foreground">要保留 {s.owner} 的记录，先用上面的「导出备份」存一份。</p>}
    </section>
  );
}

// ---------------------------------------------------------------- offline downloads

/** Written by scripts/deploy/web.mjs: the media of each section and level. */
interface OfflineGroup {
  section: Section;
  level: Level;
  files: string[];
  bytes: number;
}

const MB = (b: number) => `${Math.round(b / 1e6)} MB`;

async function cachedPaths(): Promise<Set<string>> {
  const cache = await caches.open(MEDIA_CACHE);
  return new Set((await cache.keys()).map((r) => new URL(r.url).pathname));
}

/** Data page: download the audio and images of a level for offline use. */
export function OfflinePanel() {
  const [groups, setGroups] = useState<OfflineGroup[] | null>(null);
  const [have, setHave] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<{ key: string; done: number; total: number } | null>(null);
  const [usage, setUsage] = useState<StorageEstimate | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setHave(await cachedPaths());
    setUsage((await navigator.storage?.estimate?.()) ?? null);
  }, []);

  useEffect(() => {
    if (!CLOUD || !("caches" in window)) return;
    fetch("/data/offline.json")
      .then((r) => r.json() as Promise<{ groups: OfflineGroup[] }>)
      .then((d) => setGroups(d.groups))
      .catch(() => setError("离线清单读取失败"));
    void refresh();
  }, [refresh]);

  if (!CLOUD || !("caches" in window)) return null;

  const download = async (g: OfflineGroup) => {
    const key = g.section + g.level;
    const todo = g.files.filter((f) => !have.has(f));
    const cache = await caches.open(MEDIA_CACHE);
    let done = 0;
    let failed = 0;
    setError("");
    setBusy({ key, done, total: todo.length });
    const queue = [...todo];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          await cache.add(f);
        } catch {
          failed++;
        }
        setBusy({ key, done: ++done, total: todo.length });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    setBusy(null);
    if (failed) setError(`${failed} 个文件下载失败。检查网络后再点一次。`);
    await refresh();
  };

  const remove = async (g: OfflineGroup) => {
    const cache = await caches.open(MEDIA_CACHE);
    await Promise.all(g.files.map((f) => cache.delete(f)));
    await refresh();
  };

  return (
    <section className="mb-4 rounded-2xl border bg-card p-5">
      <h2 className="mb-1 font-bold">离线使用</h2>
      <p className="text-sm text-muted-foreground">
        题目文字、译文和解析已经存在本机，离线可用。音频和图片按等级下载；联网时播放过的音频也会自动保存。
      </p>
      {usage?.usage !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">
          本机已用 {MB(usage.usage)}{usage.quota ? `，浏览器上限约 ${MB(usage.quota)}` : ""}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-wrong">{error}</p>}
      {!groups ? (
        <p className="mt-3 text-sm text-muted-foreground">读取中…</p>
      ) : (
        (["CO", "CE"] as Section[]).map((sec) => (
          <div key={sec} className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">{SECTION_NAME[sec]}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {groups.filter((g) => g.section === sec).map((g) => {
                const key = g.section + g.level;
                const n = g.files.filter((f) => have.has(f)).length;
                const all = n === g.files.length;
                const mine = busy?.key === key;
                return (
                  <div key={key} className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2">
                    <b className="w-7">{g.level}</b>
                    <span className="flex-1 text-xs text-muted-foreground tabular-nums">
                      {mine ? `下载中 ${busy.done}/${busy.total}` : all ? `已下载 · ${MB(g.bytes)}` : n ? `已下载 ${n}/${g.files.length} · 共 ${MB(g.bytes)}` : MB(g.bytes)}
                    </span>
                    {!all && (
                      <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void download(g)}>
                        <Download /> 下载
                      </Button>
                    )}
                    {n > 0 && !mine && (
                      <Button size="sm" variant="ghost" disabled={!!busy} aria-label="删除" onClick={() => void remove(g)}>
                        <Trash2 />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
