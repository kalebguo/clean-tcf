import { App } from "@capacitor/app";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { liveQuery } from "dexie";
import { exportAll, importAll, validateBackup, type Backup } from "../db/backup";
import { db, USER_TABLES } from "../db/schema";
import { isNativeApp } from "./index";

/**
 * Data snapshots in the iOS app (SPEC-IOS §6.1). iOS may clear a web view's IndexedDB
 * when the phone runs low on space, so the app also keeps the backup file that the
 * data page exports in Documents/backups/ (visible in the Files app, part of the
 * phone's iCloud backup): one file a day, the last 7 days. A snapshot is written when
 * the app goes to the background, after a session is submitted or a flashcard rated,
 * and at launch when the newest one is more than a day old. At launch, an empty
 * database with a snapshot on disk offers to restore it.
 */

const DIR = "backups";
const KEEP = 7;
const DAY = 24 * 60 * 60 * 1000;
const NAME = /^tcf-backup-\d{4}-\d{2}-\d{2}\.json$/;

const fileName = (t = new Date()) =>
  `tcf-backup-${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}.json`;

/** Snapshot file names, newest first. */
async function snapshots(): Promise<{ name: string; mtime: number }[]> {
  try {
    const { files } = await Filesystem.readdir({ path: DIR, directory: Directory.Documents });
    return files.filter((f) => NAME.test(f.name)).map((f) => ({ name: f.name, mtime: f.mtime })).sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return []; // no folder yet
  }
}

/** Rows of learner data; settings in kv alone do not count. */
const rows = (b: Backup) => Object.entries(b.tables).reduce((n, [t, r]) => n + (t === "kv" ? 0 : (r as unknown[]).length), 0);

/** The same count for the database, without exporting it. */
async function dbRows(): Promise<number> {
  let n = 0;
  for (const t of USER_TABLES) if (t !== "kv") n += await db.table(t).count();
  return n;
}

let writing: Promise<void> | null = null;

export function writeSnapshot(): Promise<void> {
  writing ??= (async () => {
    try {
      const data = await exportAll();
      // never let an emptied database overwrite today's good snapshot
      if (rows(data) === 0) return;
      await Filesystem.writeFile({ path: `${DIR}/${fileName()}`, data: JSON.stringify(data), directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
      for (const old of (await snapshots()).slice(KEEP)) await Filesystem.deleteFile({ path: `${DIR}/${old.name}`, directory: Directory.Documents });
    } catch (e) {
      console.warn("snapshot failed", e);
    } finally {
      writing = null;
    }
  })();
  return writing;
}

async function offerRestore(): Promise<void> {
  if ((await dbRows()) > 0) return;
  const [newest] = await snapshots();
  if (!newest) return;
  const { data } = await Filesystem.readFile({ path: `${DIR}/${newest.name}`, directory: Directory.Documents, encoding: Encoding.UTF8 });
  const backup = JSON.parse(data as string) as Backup;
  if (validateBackup(backup) || rows(backup) === 0) return;
  const when = new Date(backup.exportedAt).toLocaleString("zh-CN");
  const n = backup.tables.attempts?.length ?? 0;
  // a native dialog asked for before the page has painted is dropped without showing
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 1000)));
  if (window.confirm(`做题数据是空的，但找到了 ${when} 的自动备份（${n} 条作答记录）。恢复吗？`)) {
    await importAll(backup, "replace");
    window.location.reload();
    return;
  }
  // declined: keep that file out of the rotation, so today's new snapshot cannot overwrite it
  await Filesystem.rename({
    from: `${DIR}/${newest.name}`,
    to: `${DIR}/${newest.name.replace(".json", "-kept.json")}`,
    directory: Directory.Documents,
    toDirectory: Directory.Documents,
  });
}

/** Starts the snapshots; does nothing on the website. */
export function startSnapshots(): void {
  if (!isNativeApp()) return;
  void (async () => {
    await offerRestore();
    const [newest] = await snapshots();
    if (!newest || Date.now() - newest.mtime > DAY) await writeSnapshot();
  })();
  void App.addListener("appStateChange", ({ isActive }) => {
    if (!isActive) void writeSnapshot();
  });
  // submitted sessions (practice, exams) and flashcard ratings
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last: string | undefined;
  liveQuery(async () => `${await db.sessions.where("status").equals("submitted").count()}|${await db.reviewlog.count()}`).subscribe((key) => {
    if (last !== undefined && key !== last) {
      clearTimeout(timer);
      timer = setTimeout(() => void writeSnapshot(), 5000);
    }
    last = key;
  });
}
