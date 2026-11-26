import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./src/test/setup-test-database.ts",
    // Integration tests share one database and truncate it, so files must not run in parallel.
    fileParallelism: false,
  },
});
