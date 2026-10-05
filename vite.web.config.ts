import { mergeConfig, type Plugin } from "vite";
import { defineConfig } from "vitest/config";
import base from "./vite.config";

/*
 * The web build behind Cloudflare Access (SPEC §K): `vite build --config vite.web.config.ts --mode web`,
 * run by scripts/deploy/web.mjs, which then stages data and media, the manifest and the service worker.
 * public/ is left out: public/media links to the whole Anki media folder.
 */

// The manifest is fetched with the Access cookie only when asked to (use-credentials).
const HEAD = `
    <link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials" />
    <link rel="icon" type="image/png" href="/icons/favicon-32.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="theme-color" content="#2f6fe5" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="TCF" />
    <meta name="robots" content="noindex" />
`;

const webHead: Plugin = {
  name: "web-head",
  transformIndexHtml: (html) => html.replace("</head>", `${HEAD}  </head>`),
};

export default defineConfig((env) =>
  mergeConfig(typeof base === "function" ? base(env) : base, {
    plugins: [webHead],
    build: { outDir: "dist-web", emptyOutDir: true, copyPublicDir: false },
  }),
);
