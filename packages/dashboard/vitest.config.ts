import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    passWithNoTests: true,
    setupFiles: ["./test/setup.ts"],
    // Heavy page renders push the default thread pool past its memory budget;
    // forks + a low max keeps the suite stable on small machines.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/App.tsx",
        "src/lib/types.ts",
        "src/**/*.d.ts",
        "src/**/*.css",
      ],
      thresholds: {
        // Pragmatic targets — see migration spec C.1.2. The pages contain
        // dense view code (1000+ LOC) covered by smoke tests, so the lib +
        // hooks + context layers carry the bulk of branch coverage.
        lines: 60,
        statements: 60,
        functions: 55,
        branches: 65,
      },
    },
  },
});
