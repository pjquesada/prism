import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e/**"],
    env: {
      SESSION_SIGNING_SECRET: "vitest-session-signing-secret-min-32b",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
