# S2 — Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `loomflo init` (and `start` on a virgin project) into a TTY-aware interactive wizard that picks a provider, validates credentials live, and configures the essential workflow parameters — with a non-interactive CI path, a one-line re-run summary, and clean handling of corrupt/missing state.

**Architecture:** A new `packages/cli/src/onboarding/` module decomposes the wizard into `prompts`, `validators`, `presets`, `summary`, and an orchestrator `index.ts`. `init.ts` becomes a thin wrapper over `runWizard()`. `start.ts` detects missing `project.json` and delegates to `init`. Provider validation reuses the existing `ProviderProfiles` store and `credentials.ts` helpers from `@loomflo/core`. All output routes through the S3 `theme` module.

**Tech Stack:** TypeScript 5.x, Node 20+, `@inquirer/prompts@^6` (prompts), `ora@^8` (spinners, reused from S3), `zod@^3` (already present — config schema validation), `@loomflo/core` (`ProviderProfiles`, `resolveProject`, `credentials.ts`, `LoomfloConfig`), `vitest` (tests).

**Spec:** `docs/superpowers/specs/2026-04-15-s2-onboarding-wizard.md`

**Depends on:** S3 (theme module + `withJsonSupport`), S1 (ProviderProfiles, resolveProject, postProject, initWorkflow). S3 must be merged before starting this plan.

---

## Conventions

Run commands from the repo root. Test runner = `pnpm --filter @loomflo/cli test`. Lint + typecheck as in S3. Commits follow the pattern `feat(cli): <summary> (T<n>)` / `refactor(cli): … (T<n>)` / `test(cli): … (T<n>)`.

## Task dependency graph

```
T1 (deps) → T2 (types) → T3 (presets) → T4 (validators) → T5 (prompts)
                                                              │
                                                              ▼
                                        T6 (summary) ── T7 (orchestrator)
                                                              │
                             ┌────────────────────────────────┼──────────────────┐
                             ▼                                ▼                  ▼
                     T8 (init refactor)          T9 (start delegation)   T10 (non-interactive)
                             │                                │                  │
                             └──────────────┬─────────────────┴──────────────────┘
                                            ▼
                                   T11 (re-run semantics)
                                            │
                                            ▼
                                   T12 (integration)
                                            │
                                            ▼
                                   T13 (verification + docs)
```

---

# Phase A — Wizard foundation

## Task 1: Add dependencies

**Files:**
- Modify: `packages/cli/package.json`

- [x] **Step 1: Add the inquirer prompts package**

```bash
pnpm --filter @loomflo/cli add @inquirer/prompts@^6
```

(`ora` is already on the dep list from S3.)

- [x] **Step 2: Verify**

`packages/cli/package.json` now has `"@inquirer/prompts": "^6.x.x"` in `dependencies`.

- [x] **Step 3: Commit**

```bash
git add packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(cli): add @inquirer/prompts for S2 wizard (T1)"
```

---

## Task 2: Wizard types

**Files:**
- Create: `packages/cli/src/onboarding/types.ts`
- Test: `packages/cli/test/onboarding/types.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/onboarding/types.test.ts
import { describe, expect, it } from "vitest";

import {
  WizardFlagsSchema,
  type WizardAnswers,
  type WizardFlags,
} from "../../src/onboarding/types.js";

describe("WizardFlagsSchema", () => {
  it("accepts the full shape with coercions", () => {
    const parsed = WizardFlagsSchema.parse({
      provider: "anthropic-oauth",
      profile: "default",
      level: "2",
      budget: "0",
      defaultDelay: "1000",
      retryDelay: "2000",
      advanced: false,
      yes: false,
      nonInteractive: false,
    });
    expect(parsed.level).toBe(2);
    expect(parsed.budget).toBe(0);
    expect(parsed.defaultDelay).toBe(1000);
  });

  it("accepts partial and applies defaults where appropriate", () => {
    const parsed = WizardFlagsSchema.parse({});
    expect(parsed.advanced).toBe(false);
    expect(parsed.yes).toBe(false);
    expect(parsed.nonInteractive).toBe(false);
  });

  it("rejects invalid level", () => {
    expect(() => WizardFlagsSchema.parse({ level: "7" })).toThrow();
  });

  it("satisfies the WizardAnswers shape for downstream consumers", () => {
    const a: WizardAnswers = {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
      advanced: {
        maxRetriesPerNode: 3,
        maxRetriesPerTask: 2,
        maxLoomasPerLoomi: 5,
        reviewerEnabled: true,
        agentTimeout: 120000,
      },
    };
    expect(a.level).toBe(2);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/types`
Expected: FAIL, module not found.

- [x] **Step 3: Create the types module**

```ts
// packages/cli/src/onboarding/types.ts
import { z } from "zod";

export const LEVELS = [1, 2, 3] as const;
export type Level = (typeof LEVELS)[number] | "custom";

export interface AdvancedAnswers {
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
  maxLoomasPerLoomi: number;
  reviewerEnabled: boolean;
  agentTimeout: number;
}

export interface WizardAnswers {
  providerProfileId: string;
  level: Level;
  budgetLimit: number;
  defaultDelay: number;
  retryDelay: number;
  advanced?: AdvancedAnswers;
}

const levelSchema = z
  .union([z.literal("1"), z.literal("2"), z.literal("3"), z.literal("custom")])
  .transform((v) => (v === "custom" ? ("custom" as const) : (Number(v) as 1 | 2 | 3)));

const numberFromString = z.union([z.number(), z.string()]).transform((v) => {
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) throw new Error("expected a number");
  return n;
});

export const WizardFlagsSchema = z.object({
  provider: z
    .union([
      z.literal("anthropic-oauth"),
      z.literal("anthropic"),
      z.literal("openai"),
      z.literal("moonshot"),
      z.literal("nvidia"),
    ])
    .optional(),
  profile: z.string().optional(),
  level: levelSchema.optional(),
  budget: numberFromString.optional(),
  defaultDelay: numberFromString.optional(),
  retryDelay: numberFromString.optional(),
  apiKey: z.string().optional(),
  advanced: z.boolean().optional().default(false),
  yes: z.boolean().optional().default(false),
  nonInteractive: z.boolean().optional().default(false),
});

export type WizardFlags = z.infer<typeof WizardFlagsSchema>;

export interface WizardResult {
  answers: WizardAnswers;
  providerProfileId: string;
  /** True if the user confirmed the recap. */
  confirmed: boolean;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/types`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/onboarding/types.ts packages/cli/test/onboarding/types.test.ts
git commit -m "feat(cli): wizard types + zod flags schema (T2)"
```

---

## Task 3: Presets — level → config defaults

**Files:**
- Create: `packages/cli/src/onboarding/presets.ts`
- Test: `packages/cli/test/onboarding/presets.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/onboarding/presets.test.ts
import { describe, expect, it } from "vitest";

import { presetDefaults } from "../../src/onboarding/presets.js";

describe("presetDefaults", () => {
  it("level 1 — fast/cheap (tight retries, short delays)", () => {
    const d = presetDefaults(1);
    expect(d.defaultDelay).toBe(500);
    expect(d.retryDelay).toBe(1000);
    expect(d.maxRetriesPerNode).toBe(1);
    expect(d.reviewerEnabled).toBe(false);
  });

  it("level 2 — balanced (our default)", () => {
    const d = presetDefaults(2);
    expect(d.defaultDelay).toBe(1000);
    expect(d.retryDelay).toBe(2000);
    expect(d.maxRetriesPerNode).toBe(3);
    expect(d.reviewerEnabled).toBe(true);
  });

  it("level 3 — deep (longer delays, more retries, reviewer on)", () => {
    const d = presetDefaults(3);
    expect(d.defaultDelay).toBe(2000);
    expect(d.retryDelay).toBe(5000);
    expect(d.maxRetriesPerNode).toBe(5);
    expect(d.reviewerEnabled).toBe(true);
  });

  it("custom falls back to level 2 before advanced prompts override", () => {
    const d = presetDefaults("custom");
    expect(d).toEqual(presetDefaults(2));
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/presets`

- [x] **Step 3: Create the presets module**

```ts
// packages/cli/src/onboarding/presets.ts
import type { Level } from "./types.js";

export interface PresetConfig {
  defaultDelay: number;
  retryDelay: number;
  maxRetriesPerNode: number;
  maxRetriesPerTask: number;
  maxLoomasPerLoomi: number;
  reviewerEnabled: boolean;
  agentTimeout: number;
}

const L1: PresetConfig = {
  defaultDelay: 500,
  retryDelay: 1000,
  maxRetriesPerNode: 1,
  maxRetriesPerTask: 1,
  maxLoomasPerLoomi: 3,
  reviewerEnabled: false,
  agentTimeout: 60_000,
};

const L2: PresetConfig = {
  defaultDelay: 1000,
  retryDelay: 2000,
  maxRetriesPerNode: 3,
  maxRetriesPerTask: 2,
  maxLoomasPerLoomi: 5,
  reviewerEnabled: true,
  agentTimeout: 120_000,
};

const L3: PresetConfig = {
  defaultDelay: 2000,
  retryDelay: 5000,
  maxRetriesPerNode: 5,
  maxRetriesPerTask: 3,
  maxLoomasPerLoomi: 8,
  reviewerEnabled: true,
  agentTimeout: 240_000,
};

export function presetDefaults(level: Level): PresetConfig {
  if (level === 1) return { ...L1 };
  if (level === 3) return { ...L3 };
  // level === 2 or "custom"
  return { ...L2 };
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/presets`
Expected: PASS, 4 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/onboarding/presets.ts packages/cli/test/onboarding/presets.test.ts
git commit -m "feat(cli): workflow presets — level → defaults map (T3)"
```

---

## Task 4: Provider validators

**Files:**
- Create: `packages/cli/src/onboarding/validators.ts`
- Test: `packages/cli/test/onboarding/validators.test.ts`

Each validator returns a discriminated `{ ok: true } | { ok: false, reason, hint? }`. Tests mock HTTP via `nock` (already in the CLI devDeps if used elsewhere; if not, add it).

- [x] **Step 1: Install nock if absent**

```bash
pnpm --filter @loomflo/cli add -D nock@^14
```

- [x] **Step 2: Write the failing test**

```ts
// packages/cli/test/onboarding/validators.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nock from "nock";

import {
  validateAnthropicOauth,
  validateAnthropicApiKey,
  validateOpenAICompat,
} from "../../src/onboarding/validators.js";

beforeEach(() => {
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
  vi.restoreAllMocks();
});

describe("validateAnthropicOauth", () => {
  it("returns ok when Claude Code token is valid", async () => {
    vi.doMock("@loomflo/core", async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return {
        ...real,
        isOAuthTokenValid: async () => true,
      };
    });
    const { validateAnthropicOauth: fresh } = await import(
      "../../src/onboarding/validators.js"
    );
    const res = await fresh();
    expect(res.ok).toBe(true);
  });

  it("returns not-ok with a claude-login hint when missing", async () => {
    vi.doMock("@loomflo/core", async (orig) => {
      const real = (await orig()) as Record<string, unknown>;
      return {
        ...real,
        isOAuthTokenValid: async () => false,
      };
    });
    const { validateAnthropicOauth: fresh } = await import(
      "../../src/onboarding/validators.js"
    );
    const res = await fresh();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.hint).toContain("claude login");
    }
  });
});

describe("validateAnthropicApiKey", () => {
  it("returns ok when /v1/messages responds 200", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(200, { id: "msg_probe" });

    const res = await validateAnthropicApiKey("sk-ant-xxx");
    expect(res.ok).toBe(true);
  });

  it("returns not-ok on 401 with the Anthropic error code", async () => {
    nock("https://api.anthropic.com")
      .post("/v1/messages")
      .reply(401, { error: { type: "authentication_error", message: "invalid api key" } });

    const res = await validateAnthropicApiKey("sk-ant-bad");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("invalid");
    }
  });
});

describe("validateOpenAICompat", () => {
  it("returns ok when GET /models responds 200 with data array", async () => {
    nock("https://api.openai.com")
      .get("/v1/models")
      .reply(200, { data: [{ id: "gpt-4o" }] });

    const res = await validateOpenAICompat({
      apiKey: "sk-proj-xxx",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(res.ok).toBe(true);
  });

  it("returns not-ok when base URL is unreachable", async () => {
    nock("https://example.invalid").get("/v1/models").replyWithError("ENOTFOUND");
    const res = await validateOpenAICompat({
      apiKey: "x",
      baseUrl: "https://example.invalid/v1",
    });
    expect(res.ok).toBe(false);
  });
});
```

- [x] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/validators`
Expected: FAIL, module not found.

- [x] **Step 4: Implement validators**

```ts
// packages/cli/src/onboarding/validators.ts
import { isOAuthTokenValid } from "@loomflo/core";

export type ValidatorResult =
  | { ok: true }
  | { ok: false; reason: string; hint?: string };

export async function validateAnthropicOauth(): Promise<ValidatorResult> {
  const valid = await isOAuthTokenValid();
  if (valid) return { ok: true };
  return {
    ok: false,
    reason: "No valid Claude Code OAuth token found",
    hint: "Run `claude login` to authenticate, then re-run the wizard.",
  };
}

export async function validateAnthropicApiKey(apiKey: string): Promise<ValidatorResult> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
    if (r.ok) return { ok: true };
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: "Anthropic API key is invalid or revoked", hint: "Check the key in the console." };
    }
    return { ok: false, reason: `Anthropic API responded ${String(r.status)}` };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      hint: "Check your network connection.",
    };
  }
}

export interface OpenAICompatCreds {
  apiKey: string;
  baseUrl: string;
}

export async function validateOpenAICompat(creds: OpenAICompatCreds): Promise<ValidatorResult> {
  try {
    const url = new URL("models", creds.baseUrl.endsWith("/") ? creds.baseUrl : `${creds.baseUrl}/`);
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${creds.apiKey}` },
    });
    if (r.ok) {
      const body = (await r.json()) as { data?: unknown };
      if (Array.isArray(body.data)) return { ok: true };
      return { ok: false, reason: "Unexpected response shape from /models" };
    }
    if (r.status === 401 || r.status === 403) {
      return { ok: false, reason: "API key rejected", hint: "Check the key in your provider dashboard." };
    }
    return { ok: false, reason: `Provider responded ${String(r.status)}` };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      hint: "Check the baseUrl and your network connection.",
    };
  }
}
```

Also export `isOAuthTokenValid` from `@loomflo/core` if it isn't already. Check `packages/core/src/index.ts` — add `export { isOAuthTokenValid } from "./providers/credentials.js";` if missing.

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/validators`
Expected: PASS, 6 tests.

- [x] **Step 6: Commit**

```bash
git add packages/cli/src/onboarding/validators.ts packages/cli/test/onboarding/validators.test.ts packages/core/src/index.ts
git commit -m "feat(cli): provider validators (anthropic-oauth/apiKey/openai-compat) (T4)"
```

---

## Task 5: Prompt helpers

**Files:**
- Create: `packages/cli/src/onboarding/prompts.ts`
- Create: `packages/cli/src/onboarding/prompts.inquirer.ts` (thin wrapper so tests can swap the backend)
- Test: `packages/cli/test/onboarding/prompts.test.ts`

The prompt layer is split so tests can drive the wizard with fake answers.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/onboarding/prompts.test.ts
import { describe, expect, it } from "vitest";

import { createFakePromptBackend } from "../../src/onboarding/prompts.js";

describe("prompts — fake backend", () => {
  it("returns queued answers in FIFO order", async () => {
    const fake = createFakePromptBackend([
      { kind: "select", value: "2" },
      { kind: "input", value: "0" },
    ]);

    expect(await fake.select({ message: "Level?", choices: [] })).toBe("2");
    expect(await fake.input({ message: "Budget?" })).toBe("0");
  });

  it("throws when the queue is empty", async () => {
    const fake = createFakePromptBackend([]);
    await expect(fake.input({ message: "x" })).rejects.toThrow(
      /fake backend ran out of answers/,
    );
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/prompts`

- [x] **Step 3: Create the backend interface**

```ts
// packages/cli/src/onboarding/prompts.ts
export interface PromptBackend {
  input(opts: { message: string; default?: string }): Promise<string>;
  password(opts: { message: string }): Promise<string>;
  confirm(opts: { message: string; default?: boolean }): Promise<boolean>;
  select<T extends string>(opts: {
    message: string;
    choices: Array<{ name: string; value: T; description?: string }>;
    default?: T;
  }): Promise<T>;
  number(opts: { message: string; default?: number; min?: number }): Promise<number>;
}

export interface FakeAnswer {
  kind: "input" | "password" | "confirm" | "select" | "number";
  value: unknown;
}

export function createFakePromptBackend(queue: FakeAnswer[]): PromptBackend {
  const pull = <T>(kind: FakeAnswer["kind"]): T => {
    const next = queue.shift();
    if (!next) throw new Error("fake backend ran out of answers");
    if (next.kind !== kind) {
      throw new Error(
        `fake backend kind mismatch — expected ${kind}, got ${next.kind}`,
      );
    }
    return next.value as T;
  };

  return {
    input: async () => pull<string>("input"),
    password: async () => pull<string>("password"),
    confirm: async () => pull<boolean>("confirm"),
    select: async () => pull<string>("select"),
    number: async () => pull<number>("number"),
  } as PromptBackend;
}
```

- [x] **Step 4: Create the inquirer-backed implementation**

```ts
// packages/cli/src/onboarding/prompts.inquirer.ts
import { input, password, confirm, select, number } from "@inquirer/prompts";

import type { PromptBackend } from "./prompts.js";

export const inquirerBackend: PromptBackend = {
  input: async (opts) => input(opts),
  password: async (opts) => password(opts),
  confirm: async (opts) => confirm({ message: opts.message, default: opts.default ?? true }),
  select: async (opts) =>
    select({
      message: opts.message,
      choices: opts.choices.map((c) => ({ name: c.name, value: c.value, description: c.description })),
      default: opts.default,
    }),
  number: async (opts) => {
    const raw = await number({ message: opts.message, default: opts.default, min: opts.min });
    if (raw === undefined) throw new Error("number prompt returned undefined");
    return raw;
  },
};
```

- [x] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/prompts`
Expected: PASS, 2 tests.

- [x] **Step 6: Commit**

```bash
git add packages/cli/src/onboarding/prompts.ts packages/cli/src/onboarding/prompts.inquirer.ts packages/cli/test/onboarding/prompts.test.ts
git commit -m "feat(cli): prompt backend abstraction + inquirer impl + fake for tests (T5)"
```

---

## Task 6: Recap / summary renderer

**Files:**
- Create: `packages/cli/src/onboarding/summary.ts`
- Test: `packages/cli/test/onboarding/summary.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/onboarding/summary.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";

import { renderSummary } from "../../src/onboarding/summary.js";
import type { WizardAnswers } from "../../src/onboarding/types.js";

describe("renderSummary", () => {
  const answers: WizardAnswers = {
    providerProfileId: "default",
    level: 2,
    budgetLimit: 0,
    defaultDelay: 1000,
    retryDelay: 2000,
  };

  it("renders a heading + kv list", () => {
    const out = stripAnsi(renderSummary({ projectName: "my-todo-app", answers }));
    expect(out).toContain("my-todo-app");
    expect(out).toContain("provider");
    expect(out).toContain("default");
    expect(out).toContain("level");
    expect(out).toContain("2");
    expect(out).toContain("budget");
    expect(out).toContain("unlimited");
  });

  it("formats budget 0 as 'unlimited' and non-zero as '$X.XX'", () => {
    const zero = stripAnsi(renderSummary({ projectName: "x", answers }));
    expect(zero).toContain("unlimited");
    const paid = stripAnsi(
      renderSummary({ projectName: "x", answers: { ...answers, budgetLimit: 10 } }),
    );
    expect(paid).toContain("$10.00");
  });

  it("includes advanced overrides when present", () => {
    const out = stripAnsi(
      renderSummary({
        projectName: "x",
        answers: {
          ...answers,
          advanced: {
            maxRetriesPerNode: 7,
            maxRetriesPerTask: 2,
            maxLoomasPerLoomi: 5,
            reviewerEnabled: false,
            agentTimeout: 60000,
          },
        },
      }),
    );
    expect(out).toContain("maxRetries");
    expect(out).toContain("7");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/summary`

- [x] **Step 3: Implement**

```ts
// packages/cli/src/onboarding/summary.ts
import { theme } from "../theme/index.js";
import type { WizardAnswers } from "./types.js";

export interface SummaryInput {
  projectName: string;
  answers: WizardAnswers;
}

function fmtBudget(v: number): string {
  if (v <= 0) return "unlimited";
  return `$${v.toFixed(2)}`;
}

function fmtMs(v: number): string {
  return `${String(v)}ms`;
}

export function renderSummary(input: SummaryInput): string {
  const { projectName, answers } = input;
  const lines = [
    theme.heading(projectName),
    "",
    theme.kv("provider", answers.providerProfileId),
    theme.kv("level", answers.level === "custom" ? "custom" : String(answers.level)),
    theme.kv("budget", fmtBudget(answers.budgetLimit)),
    theme.kv("delay", fmtMs(answers.defaultDelay)),
    theme.kv("retry", fmtMs(answers.retryDelay)),
  ];
  if (answers.advanced) {
    lines.push(
      "",
      theme.muted("  advanced:"),
      theme.kv("maxRetries", String(answers.advanced.maxRetriesPerNode), 13),
      theme.kv("reviewer", answers.advanced.reviewerEnabled ? "on" : "off", 13),
      theme.kv("timeout", fmtMs(answers.advanced.agentTimeout), 13),
    );
  }
  return lines.join("\n");
}
```

(Note: `theme.kv` must accept an optional key-width third param — already present in S3 T3.)

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/summary`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/onboarding/summary.ts packages/cli/test/onboarding/summary.test.ts
git commit -m "feat(cli): wizard summary renderer (T6)"
```

---

## Task 7: Wizard orchestrator

**Files:**
- Create: `packages/cli/src/onboarding/index.ts`
- Test: `packages/cli/test/onboarding/wizard.test.ts`

Pulls everything together: prompts → validator → summary → confirm.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/onboarding/wizard.test.ts
import { describe, expect, it, vi } from "vitest";

import { runWizard } from "../../src/onboarding/index.js";
import { createFakePromptBackend } from "../../src/onboarding/prompts.js";

vi.mock("../../src/onboarding/validators.js", () => ({
  validateAnthropicOauth: vi.fn(async () => ({ ok: true })),
  validateAnthropicApiKey: vi.fn(async () => ({ ok: true })),
  validateOpenAICompat: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@loomflo/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@loomflo/core");
  return {
    ...actual,
    ProviderProfiles: class {
      async list() {
        return {};
      }
      async get(name: string) {
        return name === "default" ? { type: "anthropic-oauth" } : null;
      }
      async upsert() {}
    },
  };
});

describe("runWizard", () => {
  it("completes the interactive happy path (anthropic-oauth, level 2)", async () => {
    const fake = createFakePromptBackend([
      { kind: "select", value: "new" }, // no existing profiles
      { kind: "select", value: "anthropic-oauth" }, // type
      { kind: "input", value: "default" }, // profile name
      { kind: "select", value: "2" }, // level
      { kind: "number", value: 0 }, // budget
      { kind: "number", value: 1000 }, // defaultDelay
      { kind: "number", value: 2000 }, // retryDelay
      { kind: "confirm", value: false }, // advanced? no
      { kind: "confirm", value: true }, // start?
    ]);

    const result = await runWizard({ prompt: fake, flags: {} });
    expect(result.confirmed).toBe(true);
    expect(result.answers).toMatchObject({
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
    });
  });

  it("skips prompts when every flag is provided and --yes is set", async () => {
    const fake = createFakePromptBackend([]); // no prompts allowed
    const result = await runWizard({
      prompt: fake,
      flags: {
        profile: "default",
        level: 2,
        budget: 0,
        defaultDelay: 1000,
        retryDelay: 2000,
        advanced: false,
        yes: true,
        nonInteractive: false,
      },
    });
    expect(result.confirmed).toBe(true);
    expect(result.answers.level).toBe(2);
  });

  it("fails fast in non-interactive mode when values are missing", async () => {
    const fake = createFakePromptBackend([]);
    await expect(
      runWizard({ prompt: fake, flags: { nonInteractive: true } }),
    ).rejects.toThrow(/missing required/);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- onboarding/wizard`

- [x] **Step 3: Implement the orchestrator**

```ts
// packages/cli/src/onboarding/index.ts
import { ProviderProfiles, type ProviderProfile } from "@loomflo/core";

import { theme } from "../theme/index.js";
import { presetDefaults } from "./presets.js";
import type { PromptBackend } from "./prompts.js";
import { renderSummary } from "./summary.js";
import type {
  AdvancedAnswers,
  Level,
  WizardAnswers,
  WizardFlags,
  WizardResult,
} from "./types.js";
import {
  validateAnthropicApiKey,
  validateAnthropicOauth,
  validateOpenAICompat,
} from "./validators.js";

export interface WizardInput {
  prompt: PromptBackend;
  flags: WizardFlags;
  /** Override the credentials file path (tests). */
  profilesPath?: string;
  /** Inject a prebuilt store (tests). */
  profiles?: ProviderProfiles;
  /** Project name to show in the recap. Defaults to a generic label. */
  projectName?: string;
}

export async function runWizard(input: WizardInput): Promise<WizardResult> {
  const { prompt, flags } = input;
  const profiles = input.profiles ?? new ProviderProfiles(input.profilesPath ?? defaultProfilesPath());

  const providerProfileId = await resolveProviderProfile(prompt, flags, profiles);
  const level = await resolveLevel(prompt, flags);
  const preset = presetDefaults(level);

  const budgetLimit =
    flags.budget !== undefined
      ? flags.budget
      : await askBudget(prompt);

  const defaultDelay =
    flags.defaultDelay !== undefined
      ? flags.defaultDelay
      : await askDelay(prompt, "time between nodes", preset.defaultDelay);

  const retryDelay =
    flags.retryDelay !== undefined
      ? flags.retryDelay
      : await askDelay(prompt, "time between retries", preset.retryDelay);

  const advancedFlagOn = flags.advanced === true || level === "custom";
  const advancedPrompted = advancedFlagOn
    ? true
    : flags.nonInteractive
      ? false
      : await prompt.confirm({ message: "Configure advanced settings?", default: false });

  const advanced = advancedPrompted
    ? await askAdvanced(prompt, preset)
    : undefined;

  const answers: WizardAnswers = {
    providerProfileId,
    level,
    budgetLimit,
    defaultDelay,
    retryDelay,
    advanced,
  };

  if (flags.yes) {
    return { answers, providerProfileId, confirmed: true };
  }

  process.stdout.write(`${renderSummary({ projectName: input.projectName ?? "this project", answers })}\n\n`);
  const confirmed = flags.nonInteractive
    ? true
    : await prompt.confirm({ message: "Start project?", default: true });

  return { answers, providerProfileId, confirmed };
}

async function resolveProviderProfile(
  prompt: PromptBackend,
  flags: WizardFlags,
  profiles: ProviderProfiles,
): Promise<string> {
  if (flags.profile) {
    const existing = await profiles.get(flags.profile);
    if (existing) {
      await runExistingValidator(existing);
      return flags.profile;
    }
  }
  if (flags.nonInteractive) {
    throw new Error("missing required flag: --profile");
  }

  const list = await profiles.list();
  const names = Object.keys(list);
  const choices: Array<{ name: string; value: string }> = names.map((n) => ({ name: n, value: n }));
  choices.push({ name: "+ new profile", value: "new" });
  choices.push({ name: "use env vars (no persistence)", value: "env" });

  const pick = await prompt.select({
    message: "Select a provider profile",
    choices,
    default: names[0],
  });

  if (pick === "new") {
    return await createNewProfile(prompt, profiles, flags);
  }
  if (pick === "env") {
    return "env:ephemeral";
  }

  const chosen = list[pick];
  if (chosen) await runExistingValidator(chosen);
  return pick;
}

async function runExistingValidator(profile: ProviderProfile): Promise<void> {
  const sp = theme.spinner("validating profile…");
  sp.start();
  try {
    const res =
      profile.type === "anthropic-oauth"
        ? await validateAnthropicOauth()
        : profile.type === "anthropic"
          ? await validateAnthropicApiKey(profile.apiKey)
          : await validateOpenAICompat({
              apiKey: profile.apiKey,
              baseUrl: profile.baseUrl ?? defaultBaseUrl(profile.type),
            });
    if (res.ok) {
      sp.succeed("profile validated");
    } else {
      sp.fail(`${res.reason}${res.hint ? `  (${res.hint})` : ""}`);
      throw new Error(`profile validation failed: ${res.reason}`);
    }
  } finally {
    sp.stop();
  }
}

function defaultBaseUrl(type: Exclude<ProviderProfile["type"], "anthropic-oauth" | "anthropic">): string {
  if (type === "openai") return "https://api.openai.com/v1";
  if (type === "moonshot") return "https://api.moonshot.ai/v1";
  if (type === "nvidia") return "https://integrate.api.nvidia.com/v1";
  throw new Error(`no default baseUrl for ${type}`);
}

async function createNewProfile(
  prompt: PromptBackend,
  profiles: ProviderProfiles,
  flags: WizardFlags,
): Promise<string> {
  const type = flags.provider ?? (await prompt.select<ProviderProfile["type"]>({
    message: "Provider type",
    choices: [
      { name: "Anthropic (Claude Code OAuth)", value: "anthropic-oauth" },
      { name: "Anthropic (API key)", value: "anthropic" },
      { name: "OpenAI", value: "openai" },
      { name: "Moonshot / Kimi", value: "moonshot" },
      { name: "Nvidia NIM", value: "nvidia" },
    ],
  }));

  const name =
    flags.profile ?? (await prompt.input({ message: "Profile name (e.g. default)", default: "default" }));

  let profile: ProviderProfile;
  if (type === "anthropic-oauth") {
    profile = { type: "anthropic-oauth" };
  } else if (type === "anthropic") {
    const apiKey = flags.apiKey ?? process.env["ANTHROPIC_API_KEY"] ?? (await prompt.password({ message: "ANTHROPIC_API_KEY" }));
    profile = { type: "anthropic", apiKey };
  } else {
    const envVar = type === "openai" ? "OPENAI_API_KEY" : type === "moonshot" ? "MOONSHOT_API_KEY" : "NVIDIA_API_KEY";
    const apiKey = flags.apiKey ?? process.env[envVar] ?? (await prompt.password({ message: envVar }));
    profile = { type, apiKey, baseUrl: defaultBaseUrl(type) };
  }

  await runExistingValidator(profile);
  await profiles.upsert(name, profile);
  return name;
}

async function resolveLevel(prompt: PromptBackend, flags: WizardFlags): Promise<Level> {
  if (flags.level !== undefined) return flags.level as Level;
  if (flags.nonInteractive) throw new Error("missing required flag: --level");
  const pick = await prompt.select<string>({
    message: "Workflow preset",
    choices: [
      { name: "1 — fast / cheap", value: "1" },
      { name: "2 — balanced (default)", value: "2" },
      { name: "3 — deep", value: "3" },
      { name: "custom", value: "custom" },
    ],
    default: "2",
  });
  return pick === "custom" ? ("custom" as const) : (Number(pick) as 1 | 2 | 3);
}

async function askBudget(prompt: PromptBackend): Promise<number> {
  return prompt.number({
    message: "Budget limit in USD (0 = unlimited)",
    default: 0,
    min: 0,
  });
}

async function askDelay(prompt: PromptBackend, label: string, def: number): Promise<number> {
  return prompt.number({ message: `${label} (ms)`, default: def, min: 0 });
}

async function askAdvanced(prompt: PromptBackend, preset: ReturnType<typeof presetDefaults>): Promise<AdvancedAnswers> {
  return {
    maxRetriesPerNode: await prompt.number({ message: "maxRetriesPerNode", default: preset.maxRetriesPerNode, min: 0 }),
    maxRetriesPerTask: await prompt.number({ message: "maxRetriesPerTask", default: preset.maxRetriesPerTask, min: 0 }),
    maxLoomasPerLoomi: await prompt.number({ message: "maxLoomasPerLoomi", default: preset.maxLoomasPerLoomi, min: 1 }),
    reviewerEnabled: await prompt.confirm({ message: "reviewerEnabled", default: preset.reviewerEnabled }),
    agentTimeout: await prompt.number({ message: "agentTimeout (ms)", default: preset.agentTimeout, min: 1000 }),
  };
}

function defaultProfilesPath(): string {
  return `${process.env["HOME"] ?? ""}/.loomflo/credentials.json`;
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- onboarding/wizard`
Expected: PASS, 3 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/onboarding/index.ts packages/cli/test/onboarding/wizard.test.ts
git commit -m "feat(cli): wizard orchestrator — provider+level+budget+delays+advanced (T7)"
```

---

# Phase B — Wire into commands

## Task 8: Refactor `init.ts`

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/commands/init.test.ts` (rewrite)

- [x] **Step 1: Write the failing test**

Replace `packages/cli/test/commands/init.test.ts` with:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/client.js", () => ({
  ensureDaemon: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  fetchProject: vi.fn().mockResolvedValue(null),
  postProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "sandbox" }),
  initWorkflow: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../src/onboarding/index.js", () => ({
  runWizard: vi.fn().mockResolvedValue({
    confirmed: true,
    providerProfileId: "default",
    answers: {
      providerProfileId: "default",
      level: 2,
      budgetLimit: 0,
      defaultDelay: 1000,
      retryDelay: 2000,
    },
  }),
}));

let tmp: string;

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "loomflo-init-"));
  await mkdir(join(tmp, ".loomflo"), { recursive: true });
  process.chdir(tmp);
});

describe("loomflo init", () => {
  it("runs the wizard and writes project.json with the chosen profile", async () => {
    const { createInitCommand } = await import("../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init"]);
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(join(tmp, ".loomflo", "project.json"), "utf-8"));
    const parsed = JSON.parse(raw) as { providerProfileId: string };
    expect(parsed.providerProfileId).toBe("default");
  });

  it("exits non-zero and prints an error when wizard is not confirmed", async () => {
    const { runWizard } = await import("../../src/onboarding/index.js");
    (runWizard as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ confirmed: false, providerProfileId: "default", answers: {} });
    const { createInitCommand } = await import("../../src/commands/init.js");
    const exitSpy = vi.spyOn(process, "exitCode", "set");
    await createInitCommand().parseAsync(["node", "init"]);
    expect(exitSpy).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- commands/init`

- [x] **Step 3: Refactor `init.ts`**

```ts
// packages/cli/src/commands/init.ts
import { Command } from "commander";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { ensureDaemon, fetchProject, initWorkflow, postProject } from "../client.js";
import { inquirerBackend } from "../onboarding/prompts.inquirer.js";
import { runWizard } from "../onboarding/index.js";
import { WizardFlagsSchema } from "../onboarding/types.js";
import { isJsonMode, withJsonSupport, writeError, writeJson } from "../output.js";
import { resolveProject } from "../project.js";
import { theme } from "../theme/index.js";

interface InitFlags {
  provider?: string;
  profile?: string;
  level?: string;
  budget?: string;
  defaultDelay?: string;
  retryDelay?: string;
  advanced?: boolean;
  yes?: boolean;
  nonInteractive?: boolean;
  json?: boolean;
}

export function createInitCommand(): Command {
  const cmd = new Command("init")
    .description("Initialise a loomflo project (interactive onboarding wizard)")
    .option("--provider <type>", "anthropic-oauth | anthropic | openai | moonshot | nvidia")
    .option("--profile <name>", "Provider profile name")
    .option("--level <level>", "Workflow preset: 1 | 2 | 3 | custom")
    .option("--budget <usd>", "Budget limit (0 = unlimited)")
    .option("--default-delay <ms>", "Delay between nodes in ms")
    .option("--retry-delay <ms>", "Delay between retries in ms")
    .option("--advanced", "Prompt for advanced settings", false)
    .option("--yes", "Skip the final confirmation", false)
    .option("--non-interactive", "Fail instead of prompting when values are missing", false)
    .action(async (opts: InitFlags): Promise<void> => {
      const json = isJsonMode(opts);
      const flags = WizardFlagsSchema.parse({
        provider: opts.provider,
        profile: opts.profile,
        level: opts.level,
        budget: opts.budget,
        defaultDelay: opts.defaultDelay,
        retryDelay: opts.retryDelay,
        advanced: opts.advanced,
        yes: opts.yes,
        nonInteractive: opts.nonInteractive,
      });

      try {
        const project = await resolveProject(process.cwd(), { createIfMissing: true });

        const result = await runWizard({
          prompt: inquirerBackend,
          flags,
          projectName: project.name,
        });

        if (!result.confirmed) {
          writeError(opts, "Wizard cancelled", "E_CANCEL");
          process.exitCode = 1;
          return;
        }

        // Persist project.json with the provider profile id.
        const projectFile = join(project.projectPath, ".loomflo", "project.json");
        const identity = { ...project, providerProfileId: result.providerProfileId };
        await mkdir(join(project.projectPath, ".loomflo"), { recursive: true });
        await writeFile(projectFile, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf-8" });

        // Persist config.
        const configFile = join(project.projectPath, ".loomflo", "config.json");
        await writeFile(
          configFile,
          `${JSON.stringify(
            {
              budgetLimit: result.answers.budgetLimit,
              defaultDelay: result.answers.defaultDelay,
              retryDelay: result.answers.retryDelay,
              level: result.answers.level,
              ...result.answers.advanced,
            },
            null,
            2,
          )}\n`,
          { encoding: "utf-8" },
        );

        // Register + init workflow.
        const daemon = await ensureDaemon();
        const summary = (await fetchProject(project.id, daemon)) ?? (await postProject(project, daemon));
        await initWorkflow(summary.id, daemon);

        if (json) {
          writeJson({
            project: { id: summary.id, name: summary.name },
            providerProfileId: result.providerProfileId,
            config: result.answers,
          });
          return;
        }

        process.stdout.write(
          `${theme.line(theme.glyph.check, "accent", `project ${theme.muted(summary.name)} ready`, summary.id)}\n`,
        );
      } catch (err) {
        writeError(opts, err instanceof Error ? err.message : String(err), "E_INIT");
        process.exitCode = 1;
      }
    });

  return withJsonSupport(cmd);
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- commands/init`
Expected: PASS, 2 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/test/commands/init.test.ts
git commit -m "refactor(cli): init runs the onboarding wizard + writes project.json (T8)"
```

---

## Task 9: `start` delegates to `init` on virgin projects

**Files:**
- Modify: `packages/cli/src/commands/start.ts`
- Test: `packages/cli/test/commands/start.delegate.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/start.delegate.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/commands/init.js", () => ({
  createInitCommand: vi.fn(() => ({
    parseAsync: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../src/client.js", () => ({
  ensureDaemon: vi.fn().mockResolvedValue({ port: 42000, token: "t" }),
  fetchProject: vi.fn().mockResolvedValue(null),
  postProject: vi.fn().mockResolvedValue({ id: "proj_x", name: "sandbox" }),
  openClient: vi.fn().mockResolvedValue({ subscribe: vi.fn(), close: vi.fn() }),
}));

beforeEach(() => {
  process.chdir(mkdtempSync(join(tmpdir(), "loomflo-start-")));
});

describe("loomflo start — virgin project", () => {
  it("invokes the init command when no project.json exists", async () => {
    const init = await import("../../src/commands/init.js");
    const { createStartCommand } = await import("../../src/commands/start.js");
    await createStartCommand().parseAsync(["node", "start"]);
    expect(init.createInitCommand).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- commands/start.delegate`

- [x] **Step 3: Modify `start.ts`**

In `packages/cli/src/commands/start.ts`, add at the top of the action (before `ensureDaemon`):

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInitCommand } from "./init.js";

// …

action: async (options: StartOptions): Promise<void> => {
  const projectJson = join(process.cwd(), ".loomflo", "project.json");
  if (!existsSync(projectJson)) {
    // Delegate to init, forwarding compatible flags.
    await createInitCommand().parseAsync([
      "node",
      "init",
      ...(options.json ? ["--json"] : []),
    ]);
    // After init, fall through to the normal start flow.
  }
  // … existing start flow …
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- commands/start`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/commands/start.ts packages/cli/test/commands/start.delegate.test.ts
git commit -m "feat(cli): start delegates to init when project.json is missing (T9)"
```

---

## Task 10: Non-interactive flag handling (CI fast-fail)

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/commands/init.nonInteractive.test.ts`

`--non-interactive` is wired into the wizard already (via T7). This task is the **defensive layer**: if TTY is absent and the flag wasn't explicitly set, imply it; and when required values are missing under non-interactive mode, produce an actionable error that lists the missing flags.

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/init.nonInteractive.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/onboarding/index.js", () => ({
  runWizard: vi.fn(),
}));

describe("loomflo init — non-interactive", () => {
  beforeEach(() => {
    process.chdir(mkdtempSync(join(tmpdir(), "loomflo-init-ni-")));
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });

  it("implies --non-interactive when no TTY is detected", async () => {
    const mod = await import("../../src/onboarding/index.js");
    (mod.runWizard as ReturnType<typeof vi.fn>).mockResolvedValue({
      confirmed: true,
      providerProfileId: "default",
      answers: { providerProfileId: "default", level: 2, budgetLimit: 0, defaultDelay: 1000, retryDelay: 2000 },
    });
    const { createInitCommand } = await import("../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--profile", "default", "--level", "2", "--budget", "0", "--default-delay", "1000", "--retry-delay", "2000", "--yes"]);
    const call = (mod.runWizard as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { flags: { nonInteractive: boolean } };
    expect(call.flags.nonInteractive).toBe(true);
  });

  it("prints an actionable error listing missing flags under --non-interactive", async () => {
    const errors: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((c) => {
      errors.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const mod = await import("../../src/onboarding/index.js");
    (mod.runWizard as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("missing required flag: --level"));
    const { createInitCommand } = await import("../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--non-interactive"]);
    expect(errors.join("")).toContain("--level");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- commands/init.nonInteractive`

- [x] **Step 3: Implement the imply-TTY logic**

In `init.ts`, before the `WizardFlagsSchema.parse(...)` call, add:

```ts
const nonTty = !process.stdin.isTTY;
const inferNonInteractive = nonTty || process.env["CI"] === "true";
const effectiveFlags = {
  ...opts,
  nonInteractive: opts.nonInteractive === true || inferNonInteractive,
};
```

And pass `effectiveFlags` to `WizardFlagsSchema.parse`.

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- commands/init.nonInteractive`
Expected: PASS, 2 tests.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/test/commands/init.nonInteractive.test.ts
git commit -m "feat(cli): imply --non-interactive when no TTY / CI=true (T10)"
```

---

## Task 11: Re-run semantics — one-line recap + confirm

**Files:**
- Modify: `packages/cli/src/commands/init.ts`
- Test: `packages/cli/test/commands/init.rerun.test.ts`

- [x] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/init.rerun.test.ts
import stripAnsi from "strip-ansi";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { writeFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("../../src/onboarding/index.js", () => ({
  runWizard: vi.fn(),
}));

describe("loomflo init — re-run on configured project", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), "loomflo-init-rerun-"));
    await mkdir(join(tmp, ".loomflo"), { recursive: true });
    await writeFile(
      join(tmp, ".loomflo", "project.json"),
      JSON.stringify({ id: "proj_x", name: "existing", providerProfileId: "default", createdAt: "2026-04-15T00:00:00Z" }),
    );
    await writeFile(
      join(tmp, ".loomflo", "config.json"),
      JSON.stringify({ budgetLimit: 0, level: 2, defaultDelay: 1000, retryDelay: 2000 }),
    );
    process.chdir(tmp);
  });

  it("shows a one-line recap and prompts to start", async () => {
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((c) => {
      writes.push(typeof c === "string" ? c : c.toString());
      return true;
    });
    const mod = await import("../../src/onboarding/index.js");
    (mod.runWizard as ReturnType<typeof vi.fn>).mockResolvedValue({
      confirmed: true,
      providerProfileId: "default",
      answers: { providerProfileId: "default", level: 2, budgetLimit: 0, defaultDelay: 1000, retryDelay: 2000 },
    });
    const { createInitCommand } = await import("../../src/commands/init.js");
    await createInitCommand().parseAsync(["node", "init", "--yes"]);
    const plain = stripAnsi(writes.join(""));
    expect(plain).toMatch(/existing/);
    expect(plain).toMatch(/level.*2/);
    expect(plain).toMatch(/budget.*unlimited/);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @loomflo/cli test -- commands/init.rerun`

- [x] **Step 3: Implement re-run detection**

In `init.ts`, before calling `runWizard`, detect an existing configured project:

```ts
import { readFile } from "node:fs/promises";

// inside action, after resolveProject:
const alreadyConfigured = await readConfigSafely(join(project.projectPath, ".loomflo", "config.json"));
if (alreadyConfigured) {
  const prior = alreadyConfigured as { level: number; budgetLimit: number; defaultDelay: number; retryDelay: number };
  process.stdout.write(
    `${theme.line(
      theme.glyph.arrow,
      "muted",
      `${project.name}`,
      `${project.providerProfileId ?? "?"}, level ${String(prior.level)}, budget ${prior.budgetLimit === 0 ? "∞" : `$${String(prior.budgetLimit)}`}, delay ${String(prior.defaultDelay)}ms`,
    )}\n`,
  );
  if (!opts.yes && process.stdin.isTTY) {
    const proceed = await inquirerBackend.confirm({ message: "Start project?", default: true });
    if (!proceed) {
      process.exitCode = 1;
      return;
    }
  }
  // Skip the wizard entirely when a config exists — treat this as a re-run.
  return;
}

async function readConfigSafely(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @loomflo/cli test -- commands/init.rerun`
Expected: PASS, 1 test.

- [x] **Step 5: Commit**

```bash
git add packages/cli/src/commands/init.ts packages/cli/test/commands/init.rerun.test.ts
git commit -m "feat(cli): re-run recap + confirm on configured projects (T11)"
```

---

# Phase C — Integration & docs

## Task 12: End-to-end integration test (scripted wizard)

**Files:**
- Create: `packages/cli/test/integration/wizard.integration.test.ts`

Drives a full wizard run against a **real** temp `credentials.json` + `project.json` using the fake prompt backend. Validates that on success the files on disk have the expected shape.

- [x] **Step 1: Write the test**

```ts
// packages/cli/test/integration/wizard.integration.test.ts
import { readFile, mkdir } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { ProviderProfiles } from "@loomflo/core";
import { runWizard } from "../../src/onboarding/index.js";
import { createFakePromptBackend } from "../../src/onboarding/prompts.js";

vi.mock("../../src/onboarding/validators.js", () => ({
  validateAnthropicOauth: vi.fn(async () => ({ ok: true })),
  validateAnthropicApiKey: vi.fn(async () => ({ ok: true })),
  validateOpenAICompat: vi.fn(async () => ({ ok: true })),
}));

describe("wizard integration", () => {
  let dir: string;
  let profiles: ProviderProfiles;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "loomflo-wiz-int-"));
    await mkdir(dir, { recursive: true });
    profiles = new ProviderProfiles(join(dir, "credentials.json"));
  });

  it("creates a new profile and returns valid answers", async () => {
    const prompt = createFakePromptBackend([
      { kind: "select", value: "new" }, // no existing
      { kind: "select", value: "anthropic-oauth" },
      { kind: "input", value: "default" },
      { kind: "select", value: "2" },
      { kind: "number", value: 0 },
      { kind: "number", value: 1000 },
      { kind: "number", value: 2000 },
      { kind: "confirm", value: false }, // advanced? no
      { kind: "confirm", value: true }, // start?
    ]);
    const result = await runWizard({ prompt, flags: {}, profiles });
    expect(result.confirmed).toBe(true);
    const raw = await readFile(join(dir, "credentials.json"), "utf-8");
    const parsed = JSON.parse(raw) as { profiles: Record<string, unknown> };
    expect(parsed.profiles["default"]).toMatchObject({ type: "anthropic-oauth" });
  });

  it("reuses an existing profile on re-run", async () => {
    await profiles.upsert("default", { type: "anthropic-oauth" });
    const prompt = createFakePromptBackend([
      { kind: "select", value: "default" }, // existing profile picked
      { kind: "select", value: "2" },
      { kind: "number", value: 0 },
      { kind: "number", value: 1000 },
      { kind: "number", value: 2000 },
      { kind: "confirm", value: false },
      { kind: "confirm", value: true },
    ]);
    const result = await runWizard({ prompt, flags: {}, profiles });
    expect(result.providerProfileId).toBe("default");
  });
});
```

- [x] **Step 2: Run**

Run: `pnpm --filter @loomflo/cli test -- integration/wizard`
Expected: PASS, 2 tests.

- [x] **Step 3: Commit**

```bash
git add packages/cli/test/integration/wizard.integration.test.ts
git commit -m "test(cli): wizard integration — real FS + ProviderProfiles (T12)"
```

---

## Task 13: Verification + README/CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [x] **Step 1: Run the full suite**

```bash
pnpm --filter @loomflo/cli test
pnpm --filter @loomflo/cli lint
pnpm --filter @loomflo/cli typecheck
pnpm --filter @loomflo/cli build
```

All green.

- [x] **Step 2: Manual smoke**

```bash
rm -rf /tmp/loomflo-s2-smoke && mkdir /tmp/loomflo-s2-smoke && cd /tmp/loomflo-s2-smoke
node packages/cli/dist/index.js init
# Walk through the prompts — pick anthropic-oauth + default + level 2.
# Confirm, then verify:
cat .loomflo/project.json
cat .loomflo/config.json
```

- [x] **Step 3: README section**

Append to `README.md`:

```markdown
## Onboarding a project

```bash
cd my-project
loomflo init        # interactive wizard (or start — it delegates)
```

Flags for scripts / CI:

```bash
loomflo init \
  --provider anthropic-oauth --profile default \
  --level 2 --budget 0 --default-delay 1000 --retry-delay 2000 \
  --yes
```

Re-running `loomflo init` on a configured project prints a one-line recap and asks whether to start.
```

- [x] **Step 4: CHANGELOG**

Under `0.3.0`:

```markdown
### Added

- Interactive onboarding wizard: provider selection (with live validation), workflow preset, budget, delays, advanced tuning.
- Non-interactive flag path for CI (`--non-interactive`, implicit when no TTY / CI=true).
- Re-run recap line on already-configured projects.
```

- [x] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(cli): S2 wizard — README + CHANGELOG (T13)"
```

---

# Final verification

- [ ] All tests green (`pnpm --filter @loomflo/cli test`).
- [ ] Lint + typecheck green.
- [ ] Manual: fresh dir + `loomflo init` → writes `project.json` + `config.json` in under 5 prompts.
- [ ] Manual: non-TTY path (`echo | loomflo init --yes ...`) → completes without hanging on prompts.
- [ ] Manual: re-run in configured dir → one-line recap, `[Y/n]` prompt (or skip with `--yes`).
- [ ] PR:

```bash
gh pr create --title "S2: onboarding wizard + provider profiles (v0.3.0)" \
  --body "$(cat <<'EOF'
## Summary

- Interactive `loomflo init` wizard covering provider selection, live validation, workflow preset, budget, delays, and optional advanced overrides.
- `start` delegates to `init` on virgin projects; configured projects see a one-line recap.
- Non-interactive path (`--non-interactive`, implicit with no TTY / CI=true) fails fast with actionable errors.

Spec: `docs/superpowers/specs/2026-04-15-s2-onboarding-wizard.md`
Depends on: S3 theme (merged).

## Test plan

- [x] Unit + integration tests (`pnpm --filter @loomflo/cli test`)
- [x] Lint + typecheck
- [x] Manual: full wizard (anthropic-oauth, level 2)
- [x] Manual: `--yes` + flags path
- [x] Manual: re-run recap

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
