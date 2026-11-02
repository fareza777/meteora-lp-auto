import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = fileURLToPath(new URL("./src", import.meta.url));
const serverOnlyStub = fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    setupFiles: ["tests/setup.ts"],
    pool: "threads",
  },
  resolve: {
    alias: {
      "@": src,
      "server-only": serverOnlyStub,
    },
  },
});
