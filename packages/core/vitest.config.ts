import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // NOTE: With the v8 provider and ESM modules, the statements and lines
      // metrics are unreliable (reported as 0% due to source-map instrumentation
      // limitations in the v8 coverage provider). Only branches and functions
      // thresholds are enforced here.
      // Current branch + function coverage: ~60%. Threshold raised from 50 → 60
      // to reflect actual coverage added in Phase 12 tests (T146–T152).
      // Target: raise to 75+ once agents/, tools/, and spec-engine coverage gaps
      // are addressed with integration test updates.
      thresholds: {
        branches: 60,
        functions: 60,
      },
    },
  },
});
