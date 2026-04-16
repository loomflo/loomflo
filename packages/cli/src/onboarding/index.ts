import os from "node:os";
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
      : flags.nonInteractive
        ? 0  // use safe default
        : await askBudget(prompt);

  const defaultDelay =
    flags.defaultDelay !== undefined
      ? flags.defaultDelay
      : flags.nonInteractive
        ? preset.defaultDelay
        : await askDelay(prompt, "time between nodes", preset.defaultDelay);

  const retryDelay =
    flags.retryDelay !== undefined
      ? flags.retryDelay
      : flags.nonInteractive
        ? preset.retryDelay
        : await askDelay(prompt, "time between retries", preset.retryDelay);

  const advancedFlagOn = flags.advanced || level === "custom";
  const advancedPrompted = advancedFlagOn
    ? true
    : (flags.nonInteractive || flags.yes)
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
  const sp = theme.spinner("validating profile\u2026");
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

function defaultBaseUrl(type: "openai" | "moonshot" | "nvidia"): string {
  if (type === "openai") return "https://api.openai.com/v1";
  if (type === "moonshot") return "https://api.moonshot.ai/v1";
  return "https://integrate.api.nvidia.com/v1";
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
      { name: "1 \u2014 fast / cheap", value: "1" },
      { name: "2 \u2014 balanced (default)", value: "2" },
      { name: "3 \u2014 deep", value: "3" },
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
  return `${os.homedir()}/.loomflo/credentials.json`;
}
