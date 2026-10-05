import { APPENDED, exportAll, stamp, type Backup, type Row } from "./backup";
import { db, USER_TABLES, type Tombstone } from "./schema";

/*
 * Cloud sync, the data side (SPEC §K). A snapshot is the backup file plus the deletions
 * (tombstones) and the epoch. Merging a snapshot from the cloud into this device:
 * - keyed rows: the newer one wins (same `stamp` as importing a backup);
 * - log rows (attempts, reviews, reports): rows not seen yet are added;
 * - deletions: a row is removed when its deletion is newer than its last change, and a
 *   cloud row deleted here is not brought back;
 * - epoch: wiping or replacing all data starts a new epoch; a newer epoch is taken as a
 *   whole, an older one is ignored.
 * The cloud copy is then replaced by the merged state (the network side is src/cloud/cloud.ts).
 */

export interface Snapshot extends Backup {
  epoch: number;
  tombstones: Tombstone[];
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.syncmeta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.syncmeta.put({ key, value });
}

export async function localSnapshot(): Promise<Snapshot> {
  const [backup, epoch, tombstones] = await Promise.all([exportAll(), getMeta("epoch", 0), db.tombstones.toArray()]);
  return { ...backup, epoch, tombstones };
}

/** Is there anything worth uploading (first sync of this device)? */
export async function hasLocalData(): Promise<boolean> {
  for (const t of USER_TABLES) if ((await db.table(t).count()) > 0) return true;
  return (await db.tombstones.count()) > 0;
}

/**
 * Merge a cloud snapshot into this device. `localAhead`: this device holds something the
 * snapshot lacks (rows, newer rows, deletions or a newer epoch), so the cloud copy must be replaced.
 */
export async function mergeSnapshot(remote: Snapshot): Promise<{ localAhead: boolean }> {
  const scope = [...USER_TABLES.map((t) => db.table(t)), db.tombstones, db.syncmeta];
  return db.transaction("rw", scope, async () => {
    const epoch = await getMeta("epoch", 0);
    const remoteEpoch = remote.epoch ?? 0;
    if (remoteEpoch < epoch) return { localAhead: true };
    if (remoteEpoch > epoch) {
      for (const t of USER_TABLES) {
        await db.table(t).clear();
        await db.table(t).bulkPut((remote.tables[t] ?? []) as Row[]);
      }
      await db.tombstones.clear();
      await db.tombstones.bulkPut(remote.tombstones ?? []);
      await setMeta("epoch", remoteEpoch);
      return { localAhead: false };
    }

    let ahead = false;
    const mine = new Map((await db.tombstones.toArray()).map((t) => [t.id, t]));
    const theirs = new Map((remote.tombstones ?? []).map((t) => [t.id, t]));
    for (const t of theirs.values()) {
      const m = mine.get(t.id);
      if (!m || m.at < t.at) {
        await db.tombstones.put(t);
        mine.set(t.id, t);
      }
      const table = db.table(t.table);
      const cur = (await table.get(t.key)) as Row | undefined;
      if (cur && stamp(cur) <= t.at) await table.delete(t.key);
    }
    for (const t of mine.values()) if ((theirs.get(t.id)?.at ?? -1) < t.at) ahead = true;

    for (const t of USER_TABLES) {
      const rows = (remote.tables[t] ?? []) as Row[];
      const table = db.table(t);
      const local = (await table.toArray()) as Row[];
      const identity = APPENDED[t];
      if (identity) {
        const seen = new Set(local.map(identity));
        const fresh = rows.filter((r) => !seen.has(identity(r))).map(({ id: _id, ...rest }) => rest);
        if (fresh.length) await table.bulkAdd(fresh);
        const there = new Set(rows.map(identity));
        if (local.some((r) => !there.has(identity(r)))) ahead = true;
        continue;
      }
      const key = table.schema.primKey.keyPath as string;
      const byKey = new Map(local.map((r) => [r[key] as string, r]));
      const there = new Set<string>();
      const puts: Row[] = [];
      for (const r of rows) {
        const k = r[key] as string;
        there.add(k);
        const gone = mine.get(`${t}|${k}`);
        if (gone && gone.at >= stamp(r)) {
          ahead = true; // deleted here after its last change there
          continue;
        }
        const cur = byKey.get(k);
        if (!cur || stamp(r) > stamp(cur)) puts.push(r);
        else if (stamp(cur) > stamp(r)) ahead = true;
      }
      if (puts.length) await table.bulkPut(puts);
      for (const k of byKey.keys()) if (!there.has(k)) ahead = true;
    }
    return { localAhead: ahead };
  });
}

// ---------------------------------------------------------------- wire format: gzip JSON

export async function encodeSnapshot(s: Snapshot): Promise<Uint8Array> {
  const stream = new Blob([JSON.stringify(s)]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function decodeSnapshot(bytes: ArrayBuffer | Uint8Array): Promise<Snapshot> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as Snapshot;
}
