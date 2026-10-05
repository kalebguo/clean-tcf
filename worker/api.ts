import { createRemoteJWKSet, jwtVerify } from "jose";

/*
 * Cloud sync API (SPEC §K): one snapshot of the learner's data per person, in D1.
 * The whole site sits behind Cloudflare Access, so a request only arrives after the email
 * login; who is asking comes from the JWT that Access adds, verified here (the header alone
 * proves nothing). GET returns the snapshot, PUT replaces it if nobody wrote in between.
 */

export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  DB: D1Database;
  /** "<team>.cloudflareaccess.com" */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application */
  ACCESS_AUD?: string;
  /** local development only (wrangler dev on localhost): the email to act as */
  DEV_EMAIL?: string;
}

/** The parts of the D1 binding used here. */
export interface D1Database {
  prepare(sql: string): D1Statement;
}
interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

/** A D1 row holds 2 MB; the snapshot is gzip JSON, about a tenth of the raw size. */
export const MAX_BYTES = 1_900_000;

const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function whoIs(req: Request, env: Env): Promise<string | null> {
  const host = new URL(req.url).hostname;
  if ((host === "localhost" || host === "127.0.0.1") && env.DEV_EMAIL) return env.DEV_EMAIL.toLowerCase();
  const token = req.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let keys = jwks.get(issuer);
  if (!keys) jwks.set(issuer, (keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))));
  try {
    const { payload } = await jwtVerify(token, keys, { issuer, audience: env.ACCESS_AUD });
    return typeof payload.email === "string" ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

const etag = (version: number) => `"v${version}"`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  const email = await whoIs(req, env);
  if (!email) return json({ error: "not signed in" }, 401);
  if (pathname === "/api/me") return json({ email });
  // a top-level visit after the login expired: Access has just signed the person in again
  if (pathname === "/api/login") return Response.redirect(new URL("/", req.url).toString(), 302);
  if (pathname !== "/api/sync") return json({ error: "not found" }, 404);
  if (req.method === "GET") return getSnapshot(email, req, env);
  if (req.method === "PUT") return putSnapshot(email, req, env);
  return json({ error: "method not allowed" }, 405);
}

async function getSnapshot(email: string, req: Request, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT version, data FROM snapshots WHERE email = ?").bind(email).first<{ version: number; data: ArrayBuffer | number[] }>();
  const head = { "X-User-Email": email, "Cache-Control": "no-store" };
  if (!row) return new Response(null, { status: 204, headers: head });
  const tag = etag(row.version);
  if (req.headers.get("If-None-Match") === tag) return new Response(null, { status: 304, headers: { ...head, ETag: tag } });
  // D1 may hand a BLOB back as an array of byte values
  const body = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data).buffer;
  return new Response(body, { headers: { ...head, ETag: tag, "Content-Type": "application/octet-stream" } });
}

/** If-Match: "v<n>" replaces version n; no If-Match creates the first snapshot. 412 when someone wrote first. */
async function putSnapshot(email: string, req: Request, env: Env): Promise<Response> {
  const body = await req.arrayBuffer();
  if (!body.byteLength) return json({ error: "empty body" }, 400);
  if (body.byteLength > MAX_BYTES) return json({ error: "snapshot too large", bytes: body.byteLength }, 413);
  const now = Date.now();
  const match = req.headers.get("If-Match");
  if (match) {
    const m = /^"v(\d+)"$/.exec(match);
    if (!m) return json({ error: "bad If-Match" }, 400);
    const from = Number(m[1]);
    const res = await env.DB.prepare("UPDATE snapshots SET version = version + 1, data = ?, bytes = ?, updated_at = ? WHERE email = ? AND version = ?")
      .bind(body, body.byteLength, now, email, from)
      .run();
    if (!res.meta.changes) return json({ error: "changed elsewhere" }, 412);
    return json({ ok: true }, 200, { ETag: etag(from + 1) });
  }
  const res = await env.DB.prepare("INSERT INTO snapshots (email, version, data, bytes, updated_at) VALUES (?, 1, ?, ?, ?) ON CONFLICT(email) DO NOTHING")
    .bind(email, body, body.byteLength, now)
    .run();
  if (!res.meta.changes) return json({ error: "changed elsewhere" }, 412);
  return json({ ok: true }, 200, { ETag: etag(1) });
}
