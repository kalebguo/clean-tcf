import { handleApi, type Env } from "./api";

/*
 * The deployed site (SPEC §K): static files from dist-web, served by Cloudflare without
 * running this code; only /api/* reaches the Worker (wrangler.jsonc run_worker_first).
 */
export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return new URL(req.url).pathname.startsWith("/api/") ? handleApi(req, env) : env.ASSETS.fetch(req);
  },
};
