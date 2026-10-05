import { useLiveQuery } from "dexie-react-hooks";
import { Download, Flag, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, PageShell } from "../components/AppShell";
import { Modal, ModalActions } from "../components/Modal";
import { CLOUD } from "../cloud/cloud";
import { CloudPanel, OfflinePanel } from "../cloud/CloudUI";
import { exportAll, exportFlags, importAll, resetAll, validateBackup, type Backup } from "../db/backup";
import { db } from "../db/schema";
import { isNativeApp, saveFile } from "../platform";

export function DataPage() {
  const counts = useLiveQuery(async () => ({
    attempts: await db.attempts.count(),
    wrong: await db.qstate.filter((s) => s.wrong === "open").count(),
    favorites: await db.favorites.count(),
    notes: await db.notes.count(),
    highlights: await db.highlights.count(),
    vocab: await db.vocab.count(),
    flags: await db.p2flags.count(),
  }));
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [msg, setMsg] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  useEffect(() => {
    document.title = `${CLOUD ? "数据与同步" : "数据备份"} · TCF`;
  }, []);

  const download = async (flagsOnly = false) => {
    const data = flagsOnly ? await exportFlags() : await exportAll();
    const name = `tcf-${flagsOnly ? "flags" : "backup"}-${new Date().toISOString().slice(0, 10)}.json`;
    if (!(await saveFile(name, JSON.stringify(data), "application/json"))) return;
    setMsg(flagsOnly ? "已导出报错记录" : isNativeApp() ? "已导出（自动备份在「文件 › 我的 iPhone › TCF 练习 › backups」）" : "已导出");
  };

  const pick = async (file: File) => {
    try {
      const obj = JSON.parse(await file.text());
      const err = validateBackup(obj);
      if (err) return setMsg(`导入失败：${err}`);
      setPendingImport(obj as Backup);
    } catch {
      setMsg("导入失败：文件不是 JSON");
    }
  };

  const items: [string, number | undefined][] = [
    ["作答记录", counts?.attempts],
    ["未订正错题", counts?.wrong],
    ["收藏", counts?.favorites],
    ["题目笔记", counts?.notes],
    ["高亮", counts?.highlights],
    ["生词", counts?.vocab],
    ["AI 内容报错", counts?.flags],
  ];

  return (
    <PageShell className="max-w-3xl">
      <PageHeader
        title={CLOUD ? "数据与同步" : "数据备份"}
        description={CLOUD ? "记录存在本机，并自动同步到云端。" : "所有记录只保存在这个浏览器里。换电脑或清理浏览器之前，先导出备份。"}
      />
      <CloudPanel />
      <OfflinePanel />
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 font-bold">当前数据</h2>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map(([label, n]) => (
            <div key={label} className="rounded-xl bg-muted/60 px-3 py-2.5">
              <div className="text-xl font-extrabold tabular-nums">{n ?? "—"}</div>
              <div className="text-[11px] text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => void download()}>
            <Download /> 导出备份
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload /> 导入备份
              <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
            </label>
          </Button>
          <Button variant="outline" disabled={!counts?.flags} onClick={() => void download(true)} title="只导出你对 AI 译文和解析的报错，方便集中修正">
            <Flag /> 只导出报错记录
          </Button>
          <span className="flex-1" />
          <Button variant="destructive" onClick={() => setResetOpen(true)}>
            <Trash2 /> 清空数据
          </Button>
        </div>
        {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
      </section>

      {pendingImport && (
        <Modal
          title="导入方式"
          description={`备份时间：${new Date(pendingImport.exportedAt).toLocaleString()}`}
          onClose={() => setPendingImport(null)}
        >
          <p className="text-sm text-muted-foreground">合并：保留两边较新的记录。覆盖：先清空当前数据，再恢复备份。</p>
          <ModalActions>
            {(["replace", "merge"] as const).map((m) => (
              <Button
                key={m}
                variant={m === "merge" ? "default" : "outline"}
                onClick={async () => {
                  await importAll(pendingImport, m);
                  setPendingImport(null);
                  setMsg(m === "merge" ? "已合并导入" : "已覆盖导入");
                }}
              >
                {m === "merge" ? "合并" : "覆盖"}
              </Button>
            ))}
          </ModalActions>
        </Modal>
      )}

      {resetOpen && (
        <Modal title="清空数据" description={`清空所有作答记录、错题、收藏、笔记和设置${CLOUD ? "，云端和你其他设备上的也一起清空" : ""}。这一步不能撤销。`} onClose={() => setResetOpen(false)}>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="输入「清空」确认" />
          <ModalActions>
            <Button
              variant="destructive"
              disabled={confirm !== "清空"}
              onClick={async () => {
                await resetAll();
                setResetOpen(false);
                setConfirm("");
                setMsg("已清空");
              }}
            >
              清空
            </Button>
          </ModalActions>
        </Modal>
      )}
    </PageShell>
  );
}
