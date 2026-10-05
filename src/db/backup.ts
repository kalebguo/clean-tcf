import { db, USER_TABLES, type UserTable } from "./schema";

export const BACKUP_APP = "tcf-site";
export const BACKUP_SCHEMA = 3;
/** Older backups lack the tables added since (schema 1: vocab, p2flags; schema 2: cards, reviewlog); they import fine. */
const IMPORTABLE_SCHEMAS = [1, 2, 3];

export interface Backup {
  app: string;
  schema: number;
  exportedAt: number;
  tables: Record<UserTable, unknown[]>;
}

export async function exportAll(): Promise<Backup> {
  const tables = {} as Backup["tables"];
  for (const t of USER_TABLES) tables[t] = await db.table(t).toArray();
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: Date.now(), tables };
}

/** Returns an error message, or null if the object looks like a backup we can import. */
export function validateBackup(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return "不是有效的备份文件";
  const b = obj as Partial<Backup>;
  if (b.app !== BACKUP_APP) return "这不是本网站导出的备份";
  if (!IMPORTABLE_SCHEMAS.includes(b.schema as number)) return `备份版本 ${b.schema} 与当前版本 ${BACKUP_SCHEMA} 不兼容`;
  if (!b.tables || typeof b.tables !== "object") return "备份缺少数据表";
  for (const t of USER_TABLES) {
    const rows = (b.tables as Record<string, unknown>)[t];
    if (rows !== undefined && !Array.isArray(rows)) return `数据表 ${t} 格式错误`;
  }
  const keyed: [UserTable, string][] = [["qstate", "qid"], ["favorites", "qid"], ["notes", "qid"], ["highlights", "id"], ["sessions", "id"], ["kv", "key"], ["vocab", "lemma"], ["cards", "id"]];
  for (const [t, k] of keyed) {
    for (const row of (b.tables[t] ?? []) as Record<string, unknown>[]) {
      if (!row || typeof row[k] !== "string") return `数据表 ${t} 中有缺少 ${k} 的记录`;
    }
  }
  return null;
}

export type Row = Record<string, unknown>;
export const stamp = (r: Row) => Number(r.updatedAt ?? r.lastAt ?? r.addedAt ?? r.createdAt ?? 0);

/** Only the reports on AI content, for handing to a later fixing session. */
export async function exportFlags(): Promise<Backup> {
  const tables = Object.fromEntries(USER_TABLES.map((t) => [t, []])) as unknown as Backup["tables"];
  tables.p2flags = await db.p2flags.toArray();
  return { app: BACKUP_APP, schema: BACKUP_SCHEMA, exportedAt: Date.now(), tables };
}

/** Auto-increment tables: rows are appended, skipping ones already present (same identity). */
export const APPENDED: Partial<Record<UserTable, (r: Row) => string>> = {
  attempts: (a) => `${a.qid}|${a.answeredAt}|${a.choice}`,
  p2flags: (f) => `${f.qid}|${f.createdAt}|${f.kind}|${f.note}`,
  reviewlog: (r) => `${r.cardId}|${r.reviewedAt}|${r.rating}`,
};

/**
 * replace: wipe and restore. merge: keep the newer row per key; attempts and
 * reports are de-duplicated by their content so importing twice is harmless.
 */
export async function importAll(backup: Backup, mode: "merge" | "replace"): Promise<void> {
  await db.transaction("rw", [...USER_TABLES.map((t) => db.table(t)), db.tombstones, db.syncmeta], async () => {
    if (mode === "replace") await newEpoch();
    for (const t of USER_TABLES) {
      const rows = (backup.tables[t] ?? []) as Row[];
      const table = db.table(t);
      if (mode === "replace") {
        await table.clear();
        await table.bulkPut(rows);
        continue;
      }
      const identity = APPENDED[t];
      if (identity) {
        const seen = new Set((await table.toArray()).map(identity));
        const fresh = rows.filter((a) => !seen.has(identity(a))).map(({ id: _id, ...rest }) => rest);
        await table.bulkAdd(fresh);
        continue;
      }
      const key = table.schema.primKey.keyPath as string;
      for (const r of rows) {
        const cur = (await table.get(r[key] as string)) as Row | undefined;
        if (!cur || stamp(r) >= stamp(cur)) await table.put(r);
      }
    }
  });
}

export async function resetAll(): Promise<void> {
  await db.transaction("rw", [...USER_TABLES.map((t) => db.table(t)), db.tombstones, db.syncmeta], async () => {
    await newEpoch();
    for (const t of USER_TABLES) await db.table(t).clear();
  });
}

/**
 * All data was wiped or replaced: start a new sync epoch (SPEC §K), so other devices take
 * this state as a whole instead of merging the old rows back. Scope must include tombstones and syncmeta.
 */
async function newEpoch(now = Date.now()): Promise<void> {
  await db.tombstones.clear();
  await db.syncmeta.put({ key: "epoch", value: now });
}
