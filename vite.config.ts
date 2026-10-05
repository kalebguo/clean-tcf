import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { port: 5173 },
  // iOS app (SPEC-IOS §5.1): public/media links to the whole Anki media folder, so
  // scripts/ios/stage_media.py copies public/ itself, with only the media the bank uses
  build: mode === "ios" ? { outDir: "dist-ios", copyPublicDir: false } : undefined,
  test: { environment: "node" },
}));
