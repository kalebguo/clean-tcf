import { Dexie } from "dexie";
import { useSyncExternalStore } from "react";
import { db, USER_TABLES } from "../db/schema";
import { decodeSnapshot, encodeSnapshot, getMeta, hasLocalData, localSnapshot, mergeSnapshot, setMeta, type Snapshot } from "../db/sync";

/*
 * Cloud sync and offline use of the web build (SPEC §K). Only the build made by
 * scripts/deploy/web.mjs (vite mode "web") has a server; the dev server and the iOS app run without it.
 *
 * One sync: GET the cloud snapshot (If-None-Match: the last version seen) → merge it into
 * this device → PUT the merged state if this device holds something the cloud lacks
 * (If-Match: the version merged; 412 = another device wrote first, so start again).
 * A sync runs at start, a few seconds after a change, when the page comes back or goes
 * away, when the network returns, and every 5 minutes.
 */

export const CLOUD = import.meta.env.MODE === "web";

export type CloudState =
  | "off" // no server (dev server, iOS app)
  | "idle"
  | "syncing"
  | "offline"
  | "login" // the Access login expired
  | "account" // this device holds another person's data
  | "error";

export interface CloudStatus {
  state: CloudState;
  /** the person signed in */
  email?: string;
  /** "account": the person the data on this device belongs to */
  owner?: string;
  lastSyncAt?: number;
  error?: string;
  /** a new version of the site is ready (service worker waiting) */
  update?: boolean;
  /** a short notice, e.g. audio not downloaded while offline */
  notice?: string;
}

let status: CloudStatus = { state: CLOUD ? "idle" : "off" };
const listeners = new Set<() => void>();

function set(patch: Partial<CloudStatus>): void {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );
}

// ---------------------------------------------------------------- one sync

class LoginNeeded extends Error {}

async function api(method: "GET" | "PUT", headers: Record<string, string>, body?: Uint8Array): Promise<Response> {
  // an expired Access login answers with a redirect to the login page
  const res = await fetch("/api/sync", { method, headers, body: body as BodyInit | undefined, redirect: "manual", cache: "no-store" });
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) throw new LoginNeeded();
  return res;
}

async function hashOf(s: Snapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...s, exportedAt: 0 }));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** "retry": another device wrote between the GET and the PUT. */
async function syncOnce(): Promise<"ok" | "retry" | "account"> {
  const known = await getMeta<string | null>("etag", null);
  const res = await api("GET", known ? { "If-None-Match": known } : {});
  const email = res.headers.get("X-User-Email")?.toLowerCase();
  const owner = await getMeta<string | null>("email", null);
  if (email && owner && email !== owner) {
    set({ email, owner });
    return "account";
  }
  if (email) {
    if (!owner) await setMeta("email", email);
    set({ email });
  }

  let base: string | null; // the cloud version the upload replaces
  if (res.status === 204) {
    base = null;
    if (!(await hasLocalData())) return "ok";
  } else if (res.status === 304) {
    base = known;
    if ((await hashOf(await localSnapshot())) === (await getMeta("hash", ""))) return "ok";
  } else if (res.ok) {
    base = res.headers.get("ETag");
    const { localAhead } = await mergeSnapshot(await decodeSnapshot(await res.arrayBuffer()));
    if (!localAhead) {
      await setMeta("etag", base);
      await setMeta("hash", await hashOf(await localSnapshot()));
      return "ok";
    }
  } else {
    throw new Error(`下载失败（HTTP ${res.status}）`);
  }

  const snap = await localSnapshot();
  const put = await api("PUT", { "Content-Type": "application/octet-stream", ...(base ? { "If-Match": base } : {}) }, await encodeSnapshot(snap));
  if (put.status === 412) return "retry";
  if (put.status === 413) throw new Error("数据压缩后超过 1.9 MB，云端存不下");
  if (!put.ok) throw new Error(`上传失败（HTTP ${put.status}）`);
  await setMeta("etag", put.headers.get("ETag"));
  await setMeta("hash", await hashOf(snap));
  return "ok";
}

async function runSync(): Promise<void> {
  if (!navigator.onLine) return set({ state: "offline" });
  set({ state: "syncing" });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await syncOnce();
      if (r === "account") return set({ state: "account" });
      if (r === "ok") {
        const now = Date.now();
        await setMeta("lastSyncAt", now);
        return set({ state: "idle", lastSyncAt: now, error: undefined });
      }
    }
    throw new Error("另一台设备一直在写入，稍后再试");
  } catch (e) {
    if (e instanceof LoginNeeded) set({ state: "login" });
    else if (e instanceof TypeError) set({ state: "offline" }); // the network failed
    else set({ state: "error", error: e instanceof Error ? e.message : String(e) });
  }
}

let running: Promise<void> | null = null;
let again = false;

/** Sync now; a call during a sync runs one more sync after it. */
export function syncNow(): Promise<void> {
  if (!CLOUD || status.state === "account") return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await runSync();
    } while (again);
  })().finally(() => (running = null));
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;
let firstChangeAt = 0;

/** Sync 4 s after the last change, and at most 30 s after the first one. */
function scheduleSync(): void {
  const now = Date.now();
  if (!timer) firstChangeAt = now;
  clearTimeout(timer);
  const wait = Math.max(0, Math.min(4000, firstChangeAt + 30_000 - now));
  timer = setTimeout(() => {
    timer = undefined;
    void syncNow();
  }, wait);
}

/**
 * This device holds another person's data (someone else signed in on it). Keep nothing of it:
 * empty the learner data and the sync state, then take the signed-in person's cloud copy.
 */
export async function switchAccount(): Promise<void> {
  await db.transaction("rw", [...USER_TABLES.map((t) => db.table(t)), db.tombstones, db.syncmeta], async () => {
    for (const t of USER_TABLES) await db.table(t).clear();
    await db.tombstones.clear();
    await db.syncmeta.clear();
  });
  set({ state: "idle", owner: undefined, lastSyncAt: undefined });
  await syncNow();
}

/** A top-level visit to /api/login passes the Access login, then comes back to the site. */
export function relogin(): void {
  window.location.href = "/api/login";
}

export const LOGOUT_URL = "/cdn-cgi/access/logout";

// ---------------------------------------------------------------- offline: service worker and media

let registration: ServiceWorkerRegistration | undefined;
let reloading = false;

async function registerServiceWorker(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  registration = await navigator.serviceWorker.register("/sw.js");
  const reg = registration;
  const check = () => reg.waiting && navigator.serviceWorker.controller && set({ update: true });
  reg.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => w.state === "installed" && check());
  });
  check();
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) window.location.reload();
  });
  setInterval(() => void reg.update().catch(() => {}), 60 * 60 * 1000);
}

/** Take the new version of the site: the waiting service worker takes over, then the page reloads. */
export function applyUpdate(): void {
  reloading = true;
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
}

export const MEDIA_CACHE = "media";

/**
 * Keep a played audio file for offline use. The audio element asks for byte ranges, and a
 * partial response cannot be cached, so the whole file is fetched once here.
 */
async function keepMedia(src: string): Promise<void> {
  const url = new URL(src, window.location.href);
  if (url.origin !== window.location.origin || !/^\/media(-tts)?\//.test(url.pathname)) return;
  const cache = await caches.open(MEDIA_CACHE);
  if (!(await cache.match(url.pathname))) await cache.add(url.pathname);
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function showNotice(text: string): void {
  clearTimeout(noticeTimer);
  set({ notice: text });
  noticeTimer = setTimeout(() => set({ notice: undefined }), 6000);
}

// ---------------------------------------------------------------- start

const WATCHED = new Set<string>([...USER_TABLES, "tombstones"]);

export function startCloud(): void {
  if (!CLOUD) return;
  void navigator.storage?.persist?.().catch(() => {});
  void registerServiceWorker().catch(() => {});
  void getMeta<number | undefined>("lastSyncAt", undefined).then((lastSyncAt) => set({ lastSyncAt }));

  // a change to learner data (in this tab or another one) → sync soon; the sync state itself is not watched
  Dexie.on("storagemutated", (parts) => {
    if (Object.keys(parts).some((k) => k.startsWith(`idb://${db.name}/`) && WATCHED.has(k.split("/")[3]))) scheduleSync();
  });
  window.addEventListener("online", () => void syncNow());
  window.addEventListener("offline", () => set({ state: "offline" }));
  document.addEventListener("visibilitychange", () => void syncNow());
  setInterval(() => document.visibilityState === "visible" && void syncNow(), 5 * 60 * 1000);
  void syncNow();

  if ("caches" in window) {
    document.addEventListener("play", (e) => {
      const src = (e.target as HTMLMediaElement).currentSrc;
      if (src) void keepMedia(src).catch(() => {});
    }, true);
  }
  document.addEventListener("error", (e) => {
    if (e.target instanceof HTMLAudioElement && (!navigator.onLine || status.state === "offline")) showNotice("这段音频还没下载到本机。联网后在「数据」页下载这个等级。");
  }, true);
}
