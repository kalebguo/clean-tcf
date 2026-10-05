import { describe, expect, it } from "vitest";
import { handleApi, MAX_BYTES, type D1Database, type Env } from "../../worker/api";

/** In-memory stand-in for the three statements the API runs on D1. */
function fakeD1(): D1Database {
  const rows = new Map<string, { version: number; data: ArrayBuffer }>();
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind: (...v: unknown[]) => ((args = v), stmt),
        async first<T>() {
          const r = rows.get(args[0] as string);
          return (r ? { version: r.version, data: [...new Uint8Array(r.data)] } : null) as T | null;
        },
        async run() {
          if (sql.startsWith("UPDATE")) {
            const [data, , , email, from] = args as [ArrayBuffer, number, number, string, number];
            const r = rows.get(email);
            if (!r || r.version !== from) return { meta: { changes: 0 } };
            rows.set(email, { version: from + 1, data });
            return { meta: { changes: 1 } };
          }
          const [email, data] = args as [string, ArrayBuffer];
          if (rows.has(email)) return { meta: { changes: 0 } };
          rows.set(email, { version: 1, data });
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

const env = (over: Partial<Env> = {}): Env => ({ ASSETS: { fetch: async () => new Response() }, DB: fakeD1(), DEV_EMAIL: "Me@Example.com", ...over });
const call = (e: Env, method: string, headers: Record<string, string> = {}, body?: Uint8Array, host = "localhost:8787") =>
  handleApi(new Request(`http://${host}/api/sync`, { method, headers, body: body as BodyInit | undefined }), e);

describe("sync API", () => {
  it("refuses a request without a verified login", async () => {
    expect((await call(env(), "GET", {}, undefined, "tcf-site.example.workers.dev")).status).toBe(401);
    const forged = { "Cf-Access-Jwt-Assertion": "x.y.z" };
    expect((await call(env({ ACCESS_TEAM_DOMAIN: "t.cloudflareaccess.com", ACCESS_AUD: "aud" }), "GET", forged, undefined, "tcf-site.example.workers.dev")).status).toBe(401);
  });

  it("stores one snapshot per person and refuses a stale write", async () => {
    const e = env();
    expect((await call(e, "GET")).status).toBe(204);
    const first = await call(e, "PUT", {}, new Uint8Array([1, 2, 3]));
    expect(first.headers.get("ETag")).toBe('"v1"');
    expect((await call(e, "PUT", {}, new Uint8Array([9]))).status).toBe(412); // a second "first" write

    const got = await call(e, "GET");
    expect(got.headers.get("ETag")).toBe('"v1"');
    expect(got.headers.get("X-User-Email")).toBe("me@example.com");
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await call(e, "GET", { "If-None-Match": '"v1"' })).status).toBe(304);

    expect((await call(e, "PUT", { "If-Match": '"v1"' }, new Uint8Array([4]))).headers.get("ETag")).toBe('"v2"');
    expect((await call(e, "PUT", { "If-Match": '"v1"' }, new Uint8Array([5]))).status).toBe(412);
    expect([...new Uint8Array(await (await call(e, "GET")).arrayBuffer())]).toEqual([4]);
  });

  it("refuses empty and oversized snapshots", async () => {
    expect((await call(env(), "PUT", {}, new Uint8Array())).status).toBe(400);
    expect((await call(env(), "PUT", {}, new Uint8Array(MAX_BYTES + 1))).status).toBe(413);
  });
});
