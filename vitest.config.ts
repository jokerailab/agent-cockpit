import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Unit tests cover the pure layers only: session health scoring, pricing and
 * i18n. Anything that imports `electron` (main/index, monitor, store/db) is out
 * of scope — it cannot load outside an Electron runtime, which is exactly why
 * the scoring model was split into main/sessions/health.ts.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
      "@renderer": resolve(__dirname, "src/renderer/src")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
