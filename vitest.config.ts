import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
    // All test files share one Postgres instance and TRUNCATE the same
    // tables in beforeEach — running files in parallel races both DDL
    // (ensureSchema's CREATE TABLE IF NOT EXISTS) and data (one file's
    // TRUNCATE mid-flight in another). Sequential file execution trades
    // wall-clock time for correctness against shared external state.
    fileParallelism: false,
  },
});
